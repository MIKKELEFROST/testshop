/**
 * When a quote is asked for again, and by whom. There is one retry layer per cause, so a busy
 * host gets at most two quote calculations per cart or address:
 * - The server sends the quote once more only when the connection to WooCommerce dropped
 *   before any answer (see fetchQuote).
 * - The browser asks once more by itself after a pause (Retry-After, plus some jitter) when it
 *   had no connection, or WooCommerce was too busy to start (HTTP 508 at peak).
 * - Anything else, a timeout included (the host is still working on it), waits for the
 *   customer's "Prøv igen".
 */

/** A failed /api/checkout/quote request: HTTP status (0 = no connection), the route's error code and Retry-After. */
export type QuoteFailure = { status: number; code: string | null; retryAfterMs?: number | null };

/** The wait before the automatic retry when the route does not say (Retry-After). */
export const QUOTE_RETRY_DELAY_MS = 2000;

/** Retry-After of the route's 503 answers, in seconds. */
export const QUOTE_RETRY_AFTER_S = 2;

/**
 * How /api/checkout/quote reports a WooCommerce failure (its status and code): busy (508, 429
 * or 503) and other failures as 503 with Retry-After, a timeout as 504.
 */
export function quoteFailureResponse(error: { status: number; code: string }): {
  status: number;
  code: "backend_busy" | "backend_timeout" | "backend_unavailable";
  retryAfter: number | null;
} {
  if (error.status === 508 || error.status === 429 || error.status === 503) {
    return { status: 503, code: "backend_busy", retryAfter: QUOTE_RETRY_AFTER_S };
  }
  if (error.code === "timeout" || error.status === 504) return { status: 504, code: "backend_timeout", retryAfter: null };
  return { status: 503, code: "backend_unavailable", retryAfter: QUOTE_RETRY_AFTER_S };
}

/**
 * Whether the failure is temporary (no connection, WooCommerce busy or down) rather than about
 * the cart. Then the checkout can still be opened: it asks WooCommerce again, and the server
 * checks everything before payment.
 */
export function isTemporaryQuoteFailure(failure: QuoteFailure): boolean {
  return (failure.status === 0 || failure.status >= 500) && failure.code !== "not_configured";
}

/**
 * Milliseconds to wait after failed attempt number `attempt` (0 = the first) before the browser
 * asks again by itself, or null to leave it to the customer ("Prøv igen"). Only once, and only
 * when no connection was made or WooCommerce was too busy to start on it.
 */
export function quoteRetryDelay(failure: QuoteFailure, attempt: number, random: () => number = Math.random): number | null {
  if (attempt > 0 || !(failure.status === 0 || failure.code === "backend_busy")) return null;
  // Up to 50 % longer, so carts that failed together do not all ask again at the same moment.
  return Math.round((failure.retryAfterMs ?? QUOTE_RETRY_DELAY_MS) * (1 + random() * 0.5));
}

/** A Retry-After header in seconds as milliseconds (at most 30 s), or null. */
export function retryAfterMs(header: string | null): number | null {
  const value = header?.trim() ?? "";
  return /^\d+$/.test(value) ? Math.min(Number(value), 30) * 1000 : null;
}
