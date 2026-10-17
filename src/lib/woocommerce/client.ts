import "server-only";
import type { z } from "zod";
import { wooEnv } from "@/lib/env";

/**
 * Minimal, server-only WooCommerce REST client.
 *
 * - Credentials are sent as HTTP Basic auth over HTTPS and never leave the server.
 * - Every request has a timeout. GETs are retried on network errors/5xx, a busy host (508,
 *   429) once or twice and a timeout not at all; POSTs only when marked `retry`.
 * - Reads (GET) have a priority: "critical" for what a page cannot show without (a product,
 *   a listing, the categories), "background" for what it can do without (related products,
 *   filter choices, photos, shipping amounts, the sitemap). Critical reads go first.
 * - While the host is overloaded, background reads fail at once and critical reads are sent
 *   one at a time (the breaker below), so the shop never adds to its load but a page that
 *   needs a product still gets it as soon as the host answers again.
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

export type ReadPriority = "critical" | "background";

type RequestOptions<T extends z.ZodType> = {
  method?: "GET" | "POST" | "PUT";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  schema: T;
  /** Status codes whose JSON body is a valid, expected result (e.g. 409 conflicts). */
  acceptStatus?: number[];
  timeoutMs?: number;
  /**
   * POSTs: "connection" sends it once more when the connection dropped before any answer. Not
   * after a timeout or a busy host (508, 429): the browser asks again itself, after a pause.
   * Only for endpoints that change nothing (the quote): a retried order POST could create a
   * second order.
   */
  retry?: "connection";
  /** Stops the request and its retries, e.g. when the browser that asked for it has gone. */
  signal?: AbortSignal;
  /**
   * GETs: "critical" (the default) when the page can't do without the answer; "background"
   * when it can (it shows less, or its last good copy). Background reads leave one read slot to
   * critical ones, wait less for a slot, ask a busy host only once more and fail at once while
   * the breaker is open.
   */
  priority?: ReadPriority;
  /**
   * GETs: sent at once, even while the breaker is open or the read slots are taken, and not
   * counted by it. Only for a paying customer's own order, never for catalogue reads.
   */
  ignoreBreaker?: boolean;
};

export type WooResponse<T> = { status: number; data: T; headers: Headers };

/** Waits before the second and third attempt after a dropped connection or a 5xx. */
const RETRY_DELAYS_MS = [250, 750];
/**
 * Waits before asking again after the host said it is overloaded (508, 429): critical reads
 * twice, background reads once. Such an answer costs the host next to nothing (no PHP runs).
 */
const BUSY_RETRY_MS: Record<ReadPriority, number[]> = { critical: [1500, 3000], background: [1500] };

/**
 * At most this many reads (GET) at a time from one server instance. The shop's web host
 * limits concurrent requests and answers HTTP 508 ("Resource Limit Is Reached") beyond it, so
 * a cold instance must not fire dozens of catalogue reads at once. Writes and a paying
 * customer's order are not queued.
 */
const MAX_CONCURRENT_GETS = 4;
/** Slots only critical reads may take: related rows or filters never hold up a product. */
const CRITICAL_ONLY_SLOTS = 1;
/**
 * A read gives up after waiting this long for a free slot: a critical read waits longer (the
 * page needs it; a slow host frees slots every second or two), a background one gives up soon
 * (its page does without it).
 */
const SLOT_WAIT_MS: Record<ReadPriority, number> = { critical: 12_000, background: 3_000 };
let activeGets = 0;
/** Reads waiting for a slot, in order; a freed slot goes to a critical one first. */
const waitingGets: Record<ReadPriority, (() => void)[]> = { critical: [], background: [] };

async function withGetSlot<T>(priority: ReadPriority, run: () => Promise<T>): Promise<T> {
  await takeSlot(priority);
  try {
    return await run();
  } finally {
    activeGets--;
    handOverSlots();
  }
}

function slotFree(priority: ReadPriority): boolean {
  return activeGets < MAX_CONCURRENT_GETS - (priority === "critical" ? 0 : CRITICAL_ONLY_SLOTS);
}

/** A free slot, or a place in the queue. (When a slot is free, nobody of that priority waits: see handOverSlots.) */
function takeSlot(priority: ReadPriority): Promise<void> {
  if (slotFree(priority)) {
    activeGets++;
    return Promise.resolve();
  }
  const queue = waitingGets[priority];
  return new Promise((resolve, reject) => {
    const wake = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      queue.splice(queue.indexOf(wake), 1);
      reject(new WooCommerceError("Too many WooCommerce reads are waiting", 503, "busy"));
    }, SLOT_WAIT_MS[priority]);
    queue.push(wake);
  });
}

/** Gives free slots to waiting reads, critical ones first; the slot is taken on their behalf. */
function handOverSlots() {
  for (;;) {
    const queue =
      waitingGets.critical.length > 0 && slotFree("critical")
        ? waitingGets.critical
        : waitingGets.background.length > 0 && slotFree("background")
          ? waitingGets.background
          : null;
    if (!queue) return;
    activeGets++;
    queue.shift()!();
  }
}

/**
 * The breaker for reads (GET), per server instance. Failed reads are not cached (see
 * cache.ts), so while the host is overloaded every page view could ask it again. When
 * BREAKER_DOWNS reads within BREAKER_WINDOW_MS ended with the host overloaded (508, 429), not
 * answering in time or unreachable, the breaker opens:
 *
 * - Background reads fail at once; their pages keep their last good data or do without. They
 *   are never the trial: a slow one (e.g. a listing's facets) would hold up the products.
 * - Critical reads are sent one at a time, as trials: one at most TRIAL_SPACING_MS after the
 *   last one ended, each once (no retry) and with the read's usual timeout (a host that
 *   answers in 6 s must be able to close it). A critical read waits up to BREAKER_WAIT_MS
 *   for its turn, and for as long as a trial is under way (its answer may close the breaker);
 *   one that gets no turn fails (its page then retries by itself, see
 *   components/ui/catalog-retry.tsx).
 * - A trial's answer closes the breaker, and every waiting read goes on. Only a trial closes
 *   it: until a critical read comes, background reads keep failing at once.
 *
 * Reads under way when it opened are not sent again: a background read fails, a critical one
 * waits for its turn. Writes (the quote, orders) are never held back.
 */
const BREAKER_DOWNS = 3;
const BREAKER_WINDOW_MS = 10_000;
const TRIAL_SPACING_MS = 2_000;
const BREAKER_WAIT_MS = 4_000;
/**
 * How long a read waiting for the trial under way sleeps before it looks again. Only a safety
 * net: the trial's end wakes it, and a trial ends within its slot wait plus its timeout.
 */
const TRIAL_WATCH_MS = 60_000;

const breaker = {
  open: false,
  /** When the last trial ended (or the breaker opened): the next trial comes TRIAL_SPACING_MS later. */
  lastTrialEnd: 0,
  /** A trial is under way. */
  trial: false,
  /** When recent reads (while it was closed) found the host down. */
  downs: [] as number[],
};
/** Critical reads waiting for their turn while the breaker is open. */
const breakerWaiters = new Set<() => void>();

type Outcome = "answered" | "down" | "other";

/**
 * Whether a GET may be sent now, and whether as the trial. Closed: at once. Open: a background
 * read fails at once; a critical read waits until the breaker closes or it may be the trial,
 * for up to BREAKER_WAIT_MS and for as long as a trial is under way, else fails.
 */
async function admitRead(path: string, priority: ReadPriority): Promise<{ trial: boolean }> {
  const deadline = Date.now() + BREAKER_WAIT_MS;
  for (;;) {
    if (!breaker.open) return { trial: false };
    if (priority === "background") throw breakerOpen(path);
    const now = Date.now();
    const nextTrial = breaker.lastTrialEnd + TRIAL_SPACING_MS;
    if (!breaker.trial && now >= nextTrial) {
      breaker.trial = true;
      return { trial: true };
    }
    // Never give up while a trial is under way: its answer may close the breaker a moment later.
    if (!breaker.trial && now >= deadline) throw breakerOpen(path);
    await breakerChange(breaker.trial ? TRIAL_WATCH_MS : Math.min(deadline, nextTrial) - now);
  }
}

/** Resolves after `ms`, or sooner when a trial ends. */
function breakerChange(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      breakerWaiters.delete(done);
      resolve();
    };
    const timer = setTimeout(done, Math.max(0, ms));
    breakerWaiters.add(done);
  });
}

function breakerOpen(path: string) {
  return new WooCommerceError(`WooCommerce was not asked (GET ${path}): it is overloaded or down`, 503, "circuit_open");
}

/**
 * How a counted GET ended: answered (a trial's answer closes the breaker), down (counts towards
 * opening it; after a trial, the next one comes TRIAL_SPACING_MS later) or neither.
 */
function settleRead(trial: boolean, outcome: Outcome) {
  const now = Date.now();
  if (trial) {
    breaker.trial = false;
    breaker.lastTrialEnd = now;
    if (outcome === "answered") {
      breaker.open = false;
      breaker.downs = [];
    }
    for (const wake of [...breakerWaiters]) wake();
    return;
  }
  // A read that ends while the breaker is open was sent before it opened: at its entry-process
  // limit, the host still finishes requests it has already admitted while new ones get 508.
  if (outcome !== "down" || breaker.open) return;
  breaker.downs = breaker.downs.filter((time) => time > now - BREAKER_WINDOW_MS);
  breaker.downs.push(now);
  if (breaker.downs.length >= BREAKER_DOWNS) {
    breaker.open = true;
    breaker.downs = [];
    breaker.lastTrialEnd = now;
  }
}

/**
 * Milliseconds to wait before trying again after failed attempt number `attempt` (1 = the
 * first), or null to give up. A busy host (508, 429) gets one or two more tries after a pause
 * (BUSY_RETRY_MS), a timeout none: the host is still working on the abandoned request, and
 * another would add to its load. `connection`: only a dropped connection, once.
 */
function retryDelay(error: WooCommerceError, attempt: number, policy: ReadPriority | "connection"): number | null {
  if (policy === "connection") return error.code === "network_error" && attempt === 1 ? jitter(RETRY_DELAYS_MS[0]!) : null;
  if (error.code === "timeout") return null;
  const delays = error.status === 508 || error.status === 429 ? BUSY_RETRY_MS[policy] : error.retryable ? RETRY_DELAYS_MS : [];
  const delay = delays[attempt - 1];
  return delay === undefined ? null : jitter(delay);
}

/** ±25 %, so instances that failed together do not all ask again at the same moment. */
function jitter(ms: number): number {
  return Math.round(ms * (0.75 + Math.random() * 0.5));
}

/** A read let through before the breaker opened, whose turn for a slot came after: it asks the breaker again. */
class Readmit extends Error {}

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
  const priority = options.priority ?? "critical";
  const policy = method === "GET" ? priority : (options.retry ?? null);
  const timeoutMs = options.timeoutMs ?? env.WOOCOMMERCE_TIMEOUT_MS;
  const send = async () => {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: withTimeout(options.signal, timeoutMs),
      cache: "no-store",
    });
    return { response, json: await response.json().catch(() => undefined) };
  };
  const sendCounted = (trial: boolean) =>
    withGetSlot(priority, () => {
      if (!trial && breaker.open) throw new Readmit();
      return send();
    });

  for (let attempt = 1; ; attempt++) {
    // Each attempt asks the breaker, so retries stop (or wait their turn) once it has opened.
    const { trial } = counted ? await admitRead(path, priority) : { trial: false };
    let outcome: Outcome = "other";
    let error: WooCommerceError;
    try {
      const { response, json } = counted ? await sendCounted(trial) : await send();
      outcome = response.status === 508 || response.status === 429 ? "down" : "answered";
      if (response.ok || (options.acceptStatus ?? []).includes(response.status)) {
        const parsed = options.schema.safeParse(json);
        if (!parsed.success) {
          throw new WooCommerceError(`Unexpected WooCommerce response for ${method} ${path}`, 502, "invalid_response", {
            issues: parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".")}: ${issue.message}`),
          });
        }
        if (counted) settleRead(trial, outcome);
        return { status: response.status, data: parsed.data, headers: response.headers };
      }
      const code = isRecord(json) && typeof json.code === "string" ? json.code : `http_${response.status}`;
      error = new WooCommerceError(`WooCommerce request failed (${method} ${path}: ${response.status} ${code})`, response.status, code, json);
    } catch (thrown) {
      if (thrown instanceof Readmit) {
        attempt--;
        continue;
      }
      // An invalid answer, or not sent at all (no read slot came free).
      if (thrown instanceof WooCommerceError) {
        if (counted) settleRead(trial, outcome);
        throw thrown;
      }
      if (options.signal?.aborted) {
        if (counted) settleRead(trial, "other");
        throw cancelled(method, path, thrown);
      }
      const timedOut = thrown instanceof Error && (thrown.name === "TimeoutError" || thrown.name === "AbortError");
      outcome = "down";
      // Keep the low-level error (e.g. "other side closed") so logs show the real cause.
      error = new WooCommerceError(
        `${timedOut ? "WooCommerce did not respond in time" : "WooCommerce is unreachable"} (${method} ${path}, attempt ${attempt})`,
        0,
        timedOut ? "timeout" : "network_error",
        undefined,
        { cause: thrown },
      );
    }

    // A trial asks once.
    const delay = policy && !trial ? retryDelay(error, attempt, policy) : null;
    if (delay === null) {
      if (counted) settleRead(trial, outcome);
      throw error;
    }
    await sleep(delay);
    if (options.signal?.aborted) throw cancelled(method, path, options.signal.reason);
  }
}

/** The request's timeout, and the caller's signal when it has one. */
function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** The caller stopped the request (not WooCommerce's fault, so neither retried nor counted). */
function cancelled(method: string, path: string, cause: unknown) {
  return new WooCommerceError(`WooCommerce request cancelled (${method} ${path})`, 0, "cancelled", undefined, { cause });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
