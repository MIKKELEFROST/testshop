/**
 * Store (brand) configuration.
 *
 * Several storefronts share one WooCommerce backend (piece.dk, halloween-kostumer.dk, …).
 * Each one is its own deployment of this code with its own NEXT_PUBLIC_STORE_ID, which
 * - picks the brand below (texts and colours),
 * - is the webshop in WooCommerce (Products → Webshops) whose products this storefront sells,
 * - is written to every WooCommerce order and Stripe payment from this storefront.
 */

/** Colour tokens a brand can override (see @theme in app/globals.css). */
export type StoreTheme = Partial<
  Record<
    | "paper"
    | "accent"
    | "accent-soft"
    | "action"
    | "action-hover"
    | "line"
    | "line-strong"
    | "tint"
    | "tint-strong"
    | "hero"
    | "hero-blob"
    | "sale",
    string
  >
>;

export type StoreBrand = {
  name: string;
  tagline: string;
  description: string;
  /** Small line above the headline on the front page. */
  heroEyebrow: string;
  theme: StoreTheme;
};

export type StoreConfig = StoreBrand & {
  /** Stable identifier: the WooCommerce webshop, and written to orders and Stripe metadata. */
  id: string;
  locale: string;
  currency: string;
  /** ISO country codes the checkout accepts (must also be allowed in WooCommerce). */
  countries: { code: string; name: string }[];
  defaultCountry: string;
  /**
   * Payment method title on a new WooCommerce order. Once paid, the order shows the method
   * actually used instead (e.g. "MobilePay (Stripe)").
   */
  paymentMethodTitle: string;
  supportEmail: string;
};

export const DEFAULT_STORE_ID = "piece-dk";

/** Brands by store ID. A new storefront adds its brand here. */
export const brands: Record<string, StoreBrand> = {
  "piece-dk": {
    name: "Hverdag",
    tagline: "Gode ting til hverdagen",
    description: "Tidløst tøj, accessories og ting til hjemmet – udvalgt med omtanke og lavet til at holde.",
    heroEyebrow: "Ny kollektion",
    theme: {},
  },
  "halloween-kostumer-dk": {
    name: "Maskerade",
    tagline: "Kostumer til fest, fastelavn og halloween",
    description: "Udklædning og tilbehør til børn og voksne – klar til næste fest, uanset om den er sjov eller uhyggelig.",
    heroEyebrow: "Sæsonens kostumer",
    theme: {
      paper: "#fbf8fc",
      accent: "#5b2b82",
      "accent-soft": "#efe6f6",
      action: "#5b2b82",
      "action-hover": "#47206a",
      line: "#ebe3ef",
      "line-strong": "#d6c9de",
      tint: "#f1e9f5",
      "tint-strong": "#e3d4ec",
      hero: "#2a1838",
      "hero-blob": "#7a3fa8",
      sale: "#c2410c",
    },
  },
};

type StoreEnv = {
  storeId?: string;
  storeName?: string;
  supportEmail?: string;
};

export function resolveStoreConfig(env: StoreEnv): StoreConfig {
  const id = env.storeId?.trim() || DEFAULT_STORE_ID;
  const brand = brands[id] ?? brands[DEFAULT_STORE_ID]!;
  return {
    ...brand,
    id,
    name: env.storeName?.trim() || brand.name,
    locale: "da-DK",
    currency: "DKK",
    countries: [{ code: "DK", name: "Danmark" }],
    defaultCountry: "DK",
    paymentMethodTitle: "Stripe",
    supportEmail: env.supportEmail?.trim() || "kundeservice@example.com",
  };
}

// Literal process.env.NEXT_PUBLIC_* references, so Next.js inlines them in browser code.
export const storeConfig: StoreConfig = resolveStoreConfig({
  storeId: process.env.NEXT_PUBLIC_STORE_ID,
  storeName: process.env.NEXT_PUBLIC_STORE_NAME,
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL,
});

/** The brand's colours as CSS custom properties, for the root element. */
export function themeStyle(theme: StoreTheme): Record<string, string> {
  return Object.fromEntries(Object.entries(theme).map(([token, value]) => [`--color-${token}`, value]));
}

/** Whether a dark hero needs light text. */
export function isDark(hex: string | undefined): boolean {
  const match = hex && /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return false;
  const [r, g, b] = match.slice(1).map((h) => parseInt(h, 16) / 255);
  // Relative luminance (sRGB approximation).
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! < 0.45;
}
