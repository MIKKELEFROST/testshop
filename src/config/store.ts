/**
 * Store (brand) configuration.
 *
 * Several storefronts share one WooCommerce backend (Fastelavnskostumer.dk, Halloweenkostumer.dk, …).
 * Each one is its own deployment of this code with its own NEXT_PUBLIC_STORE_ID, which
 * - picks the brand below (name, logo, texts, colours, heading font and the season it is built around),
 * - is the webshop in WooCommerce (Products → Webshops) whose products this storefront sells,
 * - is written to every WooCommerce order and Stripe payment from this storefront.
 */

/** Colour tokens a brand can override (see @theme in app/globals.css). */
export type StoreTheme = Partial<
  Record<
    | "paper"
    | "ink"
    | "ink-soft"
    | "muted"
    | "accent"
    | "accent-soft"
    | "action"
    | "action-hover"
    | "on-action"
    | "bar"
    | "on-bar"
    | "chrome"
    | "chrome-ink"
    | "chrome-muted"
    | "chrome-line"
    | "footer"
    | "footer-ink"
    | "footer-muted"
    | "footer-line"
    | "highlight"
    | "line"
    | "line-strong"
    | "field"
    | "tint"
    | "tint-strong"
    | "hero"
    | "hero-blob"
    | "sale"
    | "price"
    | "canvas"
    | "video",
    string
  >
>;

/** The holiday a shop is built around: its front page counts down to it all year. */
export type Season = "fastelavn" | "halloween";

/** Heading font: family, weight, letter spacing and case (see the `heading` utility). */
export type DisplayFont = { family: string; weight: number; tracking: string; uppercase: boolean };

export type StoreBrand = {
  /** The shop's name as customers see it, e.g. "Halloweenkostumer.dk". */
  name: string;
  /** Customer service email (NEXT_PUBLIC_SUPPORT_EMAIL overrides it). */
  email: string;
  /** The logo: a drawn mark and the name in two lines ("Halloween" over "kostumer.dk"). */
  logo: { mark: "barrel-cat" | "pumpkin"; word: string; suffix: string };
  tagline: string;
  description: string;
  season: Season;
  font: DisplayFont;
  theme: StoreTheme;
  /**
   * On the customer's card statement after the Stripe account's shortened descriptor, e.g.
   * "PREFIX* HALLOWEEN", since the shops share one Stripe account. Capital Latin letters (no
   * æøå), at most 10 characters, so that Stripe's 22-character limit always fits.
   */
  statementDescriptorSuffix: string;
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

/** Brands by store ID. A new storefront adds its brand here (and its front page in src/config/merchandising.ts). */
export const brands: Record<string, StoreBrand> = {
  // Fastelavn all year: colourful, playful and for the whole family.
  "piece-dk": {
    name: "Fastelavnskostumer.dk",
    email: "kundeservice@fastelavnskostumer.dk",
    logo: { mark: "barrel-cat", word: "Fastelavns", suffix: "kostumer.dk" },
    tagline: "Kostumer til fastelavn – til hele familien",
    description:
      "Fastelavnskostumer til børn og voksne: prinsesser, superhelte, dyr og alt det sjove tilbehør. Hurtig levering fra dansk webshop.",
    season: "fastelavn",
    statementDescriptorSuffix: "FASTELAVN",
    font: { family: '"Fredoka Variable"', weight: 650, tracking: "-0.01em", uppercase: false },
    theme: {
      paper: "#fffaf2",
      ink: "#1d2246",
      "ink-soft": "#3b405f",
      muted: "#686c86",
      accent: "#2446c8",
      "accent-soft": "#e5eaff",
      action: "#2446c8",
      "action-hover": "#1b379f",
      "on-action": "#ffffff",
      bar: "#1d2246",
      "on-bar": "#ffffff",
      chrome: "#ffffff",
      "chrome-ink": "#1d2246",
      "chrome-muted": "#5a5f7d",
      "chrome-line": "#f0e7d9",
      footer: "#1d2246",
      "footer-ink": "#ffffff",
      "footer-muted": "#b9bdd8",
      "footer-line": "#2f3566",
      highlight: "#e8336f",
      line: "#efe6d8",
      "line-strong": "#ded2bf",
      field: "#8c8270",
      tint: "#fff1d6",
      "tint-strong": "#ffe3a6",
      hero: "#ffd84d",
      "hero-blob": "#ff9ec2",
      sale: "#e11d48",
      price: "#d9480f",
      canvas: "#fcf3e4",
      video: "#2446c8",
    },
  },
  // Halloween all year: dark header and footer, light pages, so photos, prices and the checkout stay clear.
  "halloween-kostumer-dk": {
    name: "Halloweenkostumer.dk",
    email: "kundeservice@halloweenkostumer.dk",
    logo: { mark: "pumpkin", word: "Halloween", suffix: "kostumer.dk" },
    tagline: "Halloweenkostumer, masker og alt det uhyggelige",
    description:
      "Halloweenkostumer til voksne og børn, masker, blod og effekter, make-up og pynt til huset. Hurtig levering fra dansk webshop.",
    season: "halloween",
    statementDescriptorSuffix: "HALLOWEEN",
    font: { family: '"Bebas Neue"', weight: 400, tracking: "0.02em", uppercase: true },
    theme: {
      paper: "#f8f6f3",
      ink: "#17131c",
      "ink-soft": "#3a3340",
      muted: "#6c6573",
      accent: "#6d28d9",
      "accent-soft": "#efe7ff",
      action: "#f2690d",
      "action-hover": "#db5b05",
      "on-action": "#1a0f05",
      bar: "#f2690d",
      "on-bar": "#1a0f05",
      chrome: "#130f19",
      "chrome-ink": "#f5f0fa",
      "chrome-muted": "#b9b0c6",
      "chrome-line": "#2b2335",
      footer: "#130f19",
      "footer-ink": "#f5f0fa",
      "footer-muted": "#b9b0c6",
      "footer-line": "#2b2335",
      highlight: "#6d28d9",
      line: "#e7e1e8",
      "line-strong": "#d4cbd7",
      field: "#8a8090",
      tint: "#f1edf3",
      "tint-strong": "#e3dbe8",
      hero: "#140f1d",
      "hero-blob": "#f2690d",
      sale: "#d6233c",
      price: "#c2410c",
      canvas: "#f1ede8",
      video: "#6d28d9",
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
    supportEmail: env.supportEmail?.trim() || brand.email,
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

/** Colours and heading font of a brand as CSS custom properties, for the root element. */
export function brandStyle(brand: Pick<StoreBrand, "theme" | "font">): Record<string, string> {
  const { font } = brand;
  return {
    ...themeStyle(brand.theme),
    "--font-display": `${font.family}, var(--font-sans)`,
    "--display-weight": String(font.weight),
    "--display-tracking": font.tracking,
    "--display-case": font.uppercase ? "uppercase" : "none",
  };
}

/** Whether a dark hero needs light text. */
export function isDark(hex: string | undefined): boolean {
  const match = hex && /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return false;
  const [r, g, b] = match.slice(1).map((h) => parseInt(h, 16) / 255);
  // Relative luminance (sRGB approximation).
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! < 0.45;
}
