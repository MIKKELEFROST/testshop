import "server-only";
import type { z } from "zod";
import { wooEnv } from "@/lib/env";

/**
 * Minimal, server-only WooCommerce REST client.
 *
 * - Credentials are sent as HTTP Basic auth over HTTPS and never leave the server.
 * - Every request has a timeout; GETs (and POSTs marked `retry`) are retried on network
 *   errors/5xx/429.
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
};

export type WooResponse<T> = { status: number; data: T; headers: Headers };

const RETRY_DELAYS_MS = [250, 750];

/**
 * At most this many reads (GET) at a time from one server instance. The shop's web host
 * limits concurrent requests and answers HTTP 508 ("Resource Limit Is Reached") beyond it, so
 * a cold instance must not fire dozens of catalogue reads at once. Writes are not queued.
 */
const MAX_CONCURRENT_GETS = 4;
let activeGets = 0;
const waitingGets: (() => void)[] = [];

async function withGetSlot<T>(run: () => Promise<T>): Promise<T> {
  while (activeGets >= MAX_CONCURRENT_GETS) await new Promise<void>((resolve) => waitingGets.push(resolve));
  activeGets++;
  try {
    return await run();
  } finally {
    activeGets--;
    waitingGets.shift()?.();
  }
}

/** Wait before retrying: longer when the host says it is overloaded (508, 429). */
function retryDelay(attempt: number, previous: WooCommerceError | undefined): number {
  const overloaded = previous?.status === 508 || previous?.status === 429;
  return overloaded ? 1500 * attempt : RETRY_DELAYS_MS[attempt - 1]!;
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
  const attempts = method === "GET" || options.retry ? RETRY_DELAYS_MS.length + 1 : 1;
  let lastError: WooCommerceError | undefined;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(retryDelay(attempt, lastError));

    let response: Response;
    let json: unknown;
    try {
      const send = async () => {
        const sent = await fetch(url, {
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
        return { sent, body: await sent.json().catch(() => undefined) };
      };
      ({ sent: response, body: json } = method === "GET" ? await withGetSlot(send) : await send());
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      // Keep the low-level error (e.g. "other side closed") so logs show the real cause.
      lastError = new WooCommerceError(
        `${timedOut ? "WooCommerce did not respond in time" : "WooCommerce is unreachable"} (${method} ${path}, attempt ${attempt + 1}/${attempts})`,
        0,
        timedOut ? "timeout" : "network_error",
        undefined,
        { cause: error },
      );
      continue;
    }

    const accepted = response.ok || (options.acceptStatus ?? []).includes(response.status);

    if (!accepted) {
      const code = isRecord(json) && typeof json.code === "string" ? json.code : `http_${response.status}`;
      lastError = new WooCommerceError(`WooCommerce request failed (${method} ${path}: ${response.status} ${code})`, response.status, code, json);
      if (lastError.retryable) continue;
      throw lastError;
    }

    const parsed = options.schema.safeParse(json);
    if (!parsed.success) {
      throw new WooCommerceError(`Unexpected WooCommerce response for ${method} ${path}`, 502, "invalid_response", {
        issues: parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      });
    }

    return { status: response.status, data: parsed.data, headers: response.headers };
  }

  throw lastError ?? new WooCommerceError("WooCommerce request failed", 0, "unknown");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
