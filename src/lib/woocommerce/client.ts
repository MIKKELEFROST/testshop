import "server-only";
import type { z } from "zod";
import { wooEnv } from "@/lib/env";

/**
 * Minimal, server-only WooCommerce REST client.
 *
 * - Credentials are sent as HTTP Basic auth over HTTPS and never leave the server.
 * - Every request has a timeout; GETs (and POSTs marked `retry`) are retried on network
 *   errors/5xx, a busy host (508, 429) only once and a timeout not at all.
 * - While the host is down or overloaded, GETs fail at once instead of adding to its load
 *   (the breaker below).
 * - Responses are validated with Zod, so unexpected payloads fail loudly instead of
 *   leaking into pricing logic.
 * - Errors never include credentials, request bodies or customer data.
 */

export class WooCommerceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly body?: unknown,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "WooCommerceError";
  }

  /** Network errors, timeouts, 5xx, 429 and lock contention are worth retrying. */
  get retryable(): boolean {
    return this.status === 0 || this.status >= 500 || this.status === 429 || this.code === "busy";
  }
}

type RequestOptions<T extends z.ZodType> = {
  method?: "GET" | "POST" | "PUT";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  schema: T;
  /** Status codes whose JSON body is a valid, expected result (e.g. 409 conflicts). */
  acceptStatus?: number[];
  timeoutMs?: number;
  /**
   * Retry a POST like a GET. Only for endpoints that change nothing (the quote): a retried
   * order POST could create a second order.
   */
  retry?: boolean;
  /**
   * GETs: sent even while the breaker is open, and not counted by it. Only for a paying
   * customer's own order, never for catalogue reads.
   */
  ignoreBreaker?: boolean;
};

export type WooResponse<T> = { status: number; data: T; headers: Headers };

/** Waits before the second and third attempt after a dropped connection or a 5xx. */
const RETRY_DELAYS_MS = [250, 750];
/** Wait before the one retry after the host said it is overloaded (508, 429). */
const OVERLOADED_RETRY_MS = 1500;

/**
 * At most this many reads (GET) at a time from one server instance. The shop's web host
 * limits concurrent requests and answers HTTP 508 ("Resource Limit Is Reached") beyond it, so
 * a cold instance must not fire dozens of catalogue reads at once. Writes are not queued.
 */
const MAX_CONCURRENT_GETS = 4;
/** A read gives up after waiting this long for a free slot, so no page queues for a minute. */
const MAX_SLOT_WAIT_MS = 5000;
let activeGets = 0;
const waitingGets: (() => void)[] = [];

async function withGetSlot<T>(run: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + MAX_SLOT_WAIT_MS;
  while (activeGets >= MAX_CONCURRENT_GETS) await waitForSlot(deadline);
  activeGets++;
  try {
    return await run();
  } finally {
    activeGets--;
    waitingGets.shift()?.();
  }
}

function waitForSlot(deadline: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const wake = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      waitingGets.splice(waitingGets.indexOf(wake), 1);
      reject(new WooCommerceError("Too many WooCommerce reads are waiting", 503, "busy"));
    }, Math.max(0, deadline - Date.now()));
    waitingGets.push(wake);
  });
}

/**
 * The breaker for reads (GET), per server instance. Failed reads are not cached (see
 * cache.ts), so during an outage every page view would ask WooCommerce again. When a GET ends
 * with the host overloaded (508, 429), not answering in time or unreachable, GETs fail at once
 * for 30 s, doubling up to 2 minutes while the host stays down; cached pages keep their last
 * good data meanwhile. Then one GET is let through as a probe: a good answer closes the
 * breaker, another such failure opens it again. Writes (the quote, orders) are never held back.
 */
const BREAKER_MIN_MS = 30_000;
const BREAKER_MAX_MS = 120_000;
const breaker = { tripped: false, openUntil: 0, nextOpenMs: BREAKER_MIN_MS, probing: false };

/** Lets a GET through (as the probe once the breaker has waited), or throws while it is open. */
function admitRead(path: string): { probe: boolean } {
  if (!breaker.tripped) return { probe: false };
  if (breaker.probing || Date.now() < breaker.openUntil) throw breakerOpen(path);
  breaker.probing = true;
  return { probe: true };
}

function breakerOpen(path: string) {
  return new WooCommerceError(`WooCommerce was not asked (GET ${path}): it failed moments ago`, 503, "circuit_open");
}

/** How a counted GET ended: answered (closes the breaker), down (opens it) or neither. */
function settleRead(probe: boolean, outcome: "answered" | "down" | "other") {
  if (probe) breaker.probing = false;
  if (outcome === "answered") {
    breaker.tripped = false;
    breaker.nextOpenMs = BREAKER_MIN_MS;
  } else if (outcome === "down" && (!breaker.tripped || probe)) {
    // Once per period: reads already under way when it opened do not make it longer.
    breaker.tripped = true;
    breaker.openUntil = Date.now() + breaker.nextOpenMs;
    breaker.nextOpenMs = Math.min(breaker.nextOpenMs * 2, BREAKER_MAX_MS);
  }
}

/** The host is overloaded, too slow or unreachable (rather than answering with an error). */
function isDown(error: unknown): boolean {
  return (
    error instanceof WooCommerceError &&
    (error.status === 508 || error.status === 429 || error.code === "timeout" || error.code === "network_error")
  );
}

/**
 * Milliseconds to wait before trying again after failed attempt number `attempt` (1 = the
 * first), or null to give up. A busy host (508, 429) gets one more try after a pause, a timeout
 * none: the host is still working on the abandoned request, and another would add to its load.
 */
function retryDelay(error: WooCommerceError, attempt: number): number | null {
  if (error.code === "timeout") return null;
  if (error.status === 508 || error.status === 429) return attempt === 1 ? jitter(OVERLOADED_RETRY_MS) : null;
  const delay = error.retryable ? RETRY_DELAYS_MS[attempt - 1] : undefined;
  return delay === undefined ? null : jitter(delay);
}

/** ±25 %, so instances that failed together do not all ask again at the same moment. */
function jitter(ms: number): number {
  return Math.round(ms * (0.75 + Math.random() * 0.5));
}

export async function wooRequest<T extends z.ZodType>(
  path: string,
  options: RequestOptions<T>,
): Promise<WooResponse<z.infer<T>>> {
  const env = wooEnv();
  const method = options.method ?? "GET";
  const url = new URL(`${env.WOOCOMMERCE_URL}/wp-json/${path.replace(/^\/+/, "")}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const auth = Buffer.from(`${env.WOOCOMMERCE_CONSUMER_KEY}:${env.WOOCOMMERCE_CONSUMER_SECRET}`).toString("base64");
  const counted = method === "GET" && !options.ignoreBreaker;
  const { probe } = counted ? admitRead(path) : { probe: false };
  // The probe asks once. Other reads stop retrying as soon as any read has opened the breaker.
  const retries = (method === "GET" || options.retry) && !probe;
  const send = async () => {
    if (counted && !probe && breaker.tripped) throw breakerOpen(path);
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(options.timeoutMs ?? env.WOOCOMMERCE_TIMEOUT_MS),
      cache: "no-store",
    });
    return { response, json: await response.json().catch(() => undefined) };
  };

  let outcome: "answered" | "down" | "other" = "other";
  try {
    for (let attempt = 1; ; attempt++) {
      let error: WooCommerceError;
      try {
        const { response, json } = method === "GET" ? await withGetSlot(send) : await send();
        if (response.ok || (options.acceptStatus ?? []).includes(response.status)) {
          outcome = "answered";
          const parsed = options.schema.safeParse(json);
          if (!parsed.success) {
            throw new WooCommerceError(`Unexpected WooCommerce response for ${method} ${path}`, 502, "invalid_response", {
              issues: parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".")}: ${issue.message}`),
            });
          }
          return { status: response.status, data: parsed.data, headers: response.headers };
        }
        const code = isRecord(json) && typeof json.code === "string" ? json.code : `http_${response.status}`;
        error = new WooCommerceError(`WooCommerce request failed (${method} ${path}: ${response.status} ${code})`, response.status, code, json);
      } catch (thrown) {
        // An invalid answer, or not sent at all (the breaker opened, no read slot came free).
        if (thrown instanceof WooCommerceError) throw thrown;
        const timedOut = thrown instanceof Error && (thrown.name === "TimeoutError" || thrown.name === "AbortError");
        // Keep the low-level error (e.g. "other side closed") so logs show the real cause.
        error = new WooCommerceError(
          `${timedOut ? "WooCommerce did not respond in time" : "WooCommerce is unreachable"} (${method} ${path}, attempt ${attempt})`,
          0,
          timedOut ? "timeout" : "network_error",
          undefined,
          { cause: thrown },
        );
      }

      const delay = retries ? retryDelay(error, attempt) : null;
      if (delay === null) {
        outcome = isDown(error) ? "down" : "other";
        throw error;
      }
      await sleep(delay);
    }
  } finally {
    if (counted) settleRead(probe, outcome);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
