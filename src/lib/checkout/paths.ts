/** The order key acts as the access token for the confirmation page (as in WooCommerce's own "order received" page). */
export function confirmationPath(orderId: number, orderKey: string) {
  return `/ordre/bekraeftelse?order=${orderId}&key=${encodeURIComponent(orderKey)}`;
}
