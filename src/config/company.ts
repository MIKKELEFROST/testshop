/**
 * The company behind the shops, shown in the footer and on the information pages
 * (src/content/info-pages.ts). FILL IN BEFORE GOING LIVE: every value in [square brackets] is
 * a placeholder, and is highlighted on the pages until it is replaced.
 *
 * The customer service email is the shop's own (NEXT_PUBLIC_SUPPORT_EMAIL, else the brand's
 * address in src/config/store.ts).
 */
export const company = {
  name: "[Firmanavn ApS]",
  cvr: "[CVR-nr.]",
  address: "[Vejnavn 1, 1234 By]",
  phone: "[Telefonnummer]",
  openingHours: "[Hverdage kl. 9–16]",
  returnAddress: "[Returadresse]",

  // Decisions for the terms (shown in the texts as written here).
  /** Who pays the return shipping. */
  returnShipping: "[Returfragt: du betaler selv returfragten / vi sender dig en gratis returlabel – vælg]",
  /** Unclaimed parcels that come back to us. */
  unclaimedParcels: "[Uafhentede pakker: vi trækker returfragten (__ kr.) fra beløbet / du får hele beløbet tilbage – vælg]",
  /** Days after a purchase the price match applies, e.g. "14". */
  priceMatchDays: "[X]",
  /** How fast emails are answered, e.g. "inden for 1 hverdag". */
  answerTime: "[inden for 1 hverdag]",
};

/** Whether a value is still a placeholder ("[…]"). */
export function isPlaceholder(value: string): boolean {
  return /^\[[^\]]*\]$/.test(value.trim());
}
