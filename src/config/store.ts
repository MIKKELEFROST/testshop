/**
 * Store (brand) configuration.
 *
 * Everything that differs between future shops sharing one WooCommerce backend
 * (piece.dk, nuttetbaby.dk, …) lives here, so a new storefront is a new deployment
 * with different environment variables — not a code fork.
 */
export type StoreConfig = {
  /** Stable identifier written to WooCommerce orders and Stripe metadata. */
  id: string;
  name: string;
  tagline: string;
  description: string;
  locale: string;
  currency: string;
  /** ISO country codes the checkout accepts (must also be allowed in WooCommerce). */
  countries: { code: string; name: string }[];
  defaultCountry: string;
  /** Title shown as payment method on the WooCommerce order. */
  paymentMethodTitle: string;
  supportEmail: string;
};

export const storeConfig: StoreConfig = {
  id: process.env.NEXT_PUBLIC_STORE_ID || "piece-dk",
  name: process.env.NEXT_PUBLIC_STORE_NAME || "Hverdag",
  tagline: "Gode ting til hverdagen",
  description:
    "Tidløst tøj, accessories og ting til hjemmet – udvalgt med omtanke og lavet til at holde.",
  locale: "da-DK",
  currency: "DKK",
  countries: [{ code: "DK", name: "Danmark" }],
  defaultCountry: "DK",
  paymentMethodTitle: "Betalingskort (Stripe)",
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "kundeservice@example.com",
};
