/**
 * When a page that could not read WooCommerce asks the server again by itself (see
 * components/ui/catalog-retry.tsx). A failed read is never cached, so asking again after a
 * pause usually finds the products; the pauses double, and all of them together (about three
 * minutes) last longer than the read breaker stays open (lib/woocommerce/client.ts).
 */
export const CATALOG_RETRY_SECONDS = [3, 6, 12, 24, 48, 96];

/** Milliseconds to wait before attempt number `attempt` (0 = the first), or null when the page should stop and show "Prøv igen". */
export function catalogRetryDelay(attempt: number): number | null {
  const seconds = CATALOG_RETRY_SECONDS[attempt];
  return seconds === undefined ? null : seconds * 1000;
}
