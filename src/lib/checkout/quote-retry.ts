/**
 * When the browser asks for a quote again by itself. The server already retries WooCommerce a
 * few times; these retries cover a host that stays busy a little longer (HTTP 508 at peak) and
 * dropped connections on phones.
 */

/** A failed /api/checkout/quote request: HTTP status (0 = no connection) and the route's error code. */
export type QuoteFailure = { status: number; code: string | null };

/** Waits before the automatic second and third attempt. */
export const QUOTE_RETRY_DELAYS_MS = [1500, 4000];

/**
 * Whether the failure is temporary (no connection, WooCommerce busy or down) rather than about
 * the cart. Then the checkout can still be opened: it asks WooCommerce again, and the server
 * checks everything before payment.
 */
export function isTemporaryQuoteFailure(failure: QuoteFailure): boolean {
  return (failure.status === 0 || failure.status >= 500) && failure.code !== "not_configured";
}

/** Milliseconds to wait after failed attempt number `attempt` (0 = the first), or null to stop and let the customer retry. */
export function quoteRetryDelay(failure: QuoteFailure, attempt: number): number | null {
  if (!isTemporaryQuoteFailure(failure)) return null;
  return QUOTE_RETRY_DELAYS_MS[attempt] ?? null;
}
