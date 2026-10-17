/**
 * Trustpilot TrustBoxes per shop: Trustpilot's own widgets, which show the shop's real rating
 * from Trustpilot and link to its Trustpilot page.
 *
 * Only a TrustBox (Trustpilot's script and markup, components/marketing/trustbox.tsx) may show
 * the rating. Never draw Trustpilot's logo, stars or colours ourselves: they are Trustpilot's
 * trademarks, and a rating customers can't check against Trustpilot misleads them.
 *
 * Empty until the owner gives each shop's Trustpilot business unit ID and profile page (see
 * docs/DEPLOY.md). Until then nothing is loaded from Trustpilot, and the shop shows its
 * text-only rating (src/config/usps.ts).
 */

import { storeConfig } from "./store";

/**
 * Where a shop shows a TrustBox: the trust strip above the footer on the front page, next to
 * the promises under "Læg i kurv", the cart page and the checkout's order summary, and the
 * footer's bottom bar (dark in both shops).
 */
export type TrustBoxPlacement = "strip" | "product" | "cart" | "footer";

/** A TrustBox design: Trustpilot's template ID and the height Trustpilot's code gives it. */
export type TrustBoxTemplate = { templateId: string; height: string };

/**
 * Trustpilot's templates the shops can use (Trustpilot Business → TrustBox widgets → a widget →
 * Get code: `data-template-id` and `data-style-height`). On Trustpilot's Free plan only the
 * Review Collector works; the ones that show the rating need a paid plan.
 */
export const TRUSTBOX_TEMPLATES = {
  /** The word rating and the stars on one line ("Fremragende ★★★★★ Trustpilot"). Paid plan. */
  microStar: { templateId: "5419b732fbfb950b10de65e5", height: "24px" },
  /** The word rating and the TrustScore on one line ("Fremragende 4.4 ud af 5 ★ Trustpilot"). Paid plan. */
  microTrustScore: { templateId: "5419b637fa0340045cd0c936", height: "20px" },
  /** The word rating, the stars and the number of reviews. Paid plan. */
  microCombo: { templateId: "5419b6ffb0d04a076446a9af", height: "20px" },
  /** "Bedøm os på ★ Trustpilot": asks for a review and shows no rating. Free plan. */
  reviewCollector: { templateId: "56278e9abfbbba0bdcd568bc", height: "52px" },
} satisfies Record<string, TrustBoxTemplate>;

export type TrustBoxTheme = "light" | "dark";

export type TrustBoxSettings = TrustBoxTemplate & {
  /** "dark" on a dark background (the footers), else "light". */
  theme: TrustBoxTheme;
  /**
   * Any other data-* attributes in the code Trustpilot gives, without "data-": e.g.
   * { token: "…" } for the Review Collector, or { stars: "4,5" }.
   */
  data?: Record<string, string>;
};

export type TrustpilotBrand = {
  /** The shop's business unit ID at Trustpilot: `data-businessunit-id` in a TrustBox's code (24 characters). */
  businessUnitId: string;
  /** The shop's public page on Trustpilot, the link in every TrustBox, e.g. "https://dk.trustpilot.com/review/halloweenkostumer.dk". */
  profileUrl: string;
  /** The TrustBox at each placement; a placement left out shows none. */
  placements: Partial<Record<TrustBoxPlacement, TrustBoxSettings>>;
};

/**
 * The placements both shops start with (the footers are dark in both). Check them against the
 * shop's Trustpilot plan. A micro TrustBox hides Trustpilot's logo when it is too narrow (Micro
 * Star below about 310 px, Micro TrustScore below about 256 px), and stars without it look like
 * a rating the shop drew itself: the cart's summary is 278 px wide on a 360 px phone.
 */
const PLACEMENTS: TrustpilotBrand["placements"] = {
  strip: { ...TRUSTBOX_TEMPLATES.microStar, theme: "light" },
  product: { ...TRUSTBOX_TEMPLATES.microStar, theme: "light" },
  cart: { ...TRUSTBOX_TEMPLATES.microTrustScore, theme: "light" },
  footer: { ...TRUSTBOX_TEMPLATES.microTrustScore, theme: "dark" },
};

/** Trustpilot per store ID (empty: no TrustBoxes). NEXT_PUBLIC_TRUSTPILOT_* override the ID and the page. */
export const trustpilotByStore: Record<string, TrustpilotBrand> = {
  "piece-dk": { businessUnitId: "", profileUrl: "", placements: PLACEMENTS },
  "halloween-kostumer-dk": { businessUnitId: "", profileUrl: "", placements: PLACEMENTS },
};

/** Trustpilot's script, which turns each TrustBox's markup into an iframe from widget.trustpilot.com. */
export const TRUSTPILOT_SCRIPT = "https://widget.trustpilot.com/bootstrap/v5/tp.widget.bootstrap.min.js";

/** Everything a TrustBox's markup needs. */
export type TrustBox = TrustBoxSettings & { businessUnitId: string; profileUrl: string; locale: string };

const TRUSTPILOT_ID = /^[0-9a-f]{24}$/;
// Set by the component itself, so not in `data`.
const OWN_ATTRIBUTES = new Set(["locale", "template-id", "businessunit-id", "style-height", "style-width", "theme"]);

function isProfileUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /(^|\.)trustpilot\.com$/.test(url.hostname) && url.pathname.startsWith("/review/");
  } catch {
    return false;
  }
}

function isSettings(settings: TrustBoxSettings): boolean {
  return (
    TRUSTPILOT_ID.test(settings.templateId) &&
    /^\d+px$/.test(settings.height) &&
    (settings.theme === "light" || settings.theme === "dark") &&
    Object.keys(settings.data ?? {}).every((key) => /^[a-z][a-z0-9-]*$/.test(key) && !OWN_ATTRIBUTES.has(key))
  );
}

/**
 * The TrustBox at each placement, or null. None at all without a valid business unit ID and
 * profile page, so a malformed one shows the text-only rating instead of a broken box. A
 * well-formed but wrong ID, or a TrustBox the plan doesn't include, only Trustpilot can tell:
 * it then shows just its logo (see docs/DEPLOY.md).
 */
export function resolveTrustBoxes(
  brand: TrustpilotBrand | undefined,
  env: { businessUnitId?: string; profileUrl?: string } = {},
): Record<TrustBoxPlacement, TrustBox | null> {
  const businessUnitId = env.businessUnitId?.trim() || brand?.businessUnitId || "";
  const profileUrl = env.profileUrl?.trim() || brand?.profileUrl || "";
  const configured = brand !== undefined && TRUSTPILOT_ID.test(businessUnitId) && isProfileUrl(profileUrl);
  const box = (placement: TrustBoxPlacement): TrustBox | null => {
    const settings = brand?.placements[placement];
    return configured && settings && isSettings(settings) ? { ...settings, businessUnitId, profileUrl, locale: "da-DK" } : null;
  };
  return { strip: box("strip"), product: box("product"), cart: box("cart"), footer: box("footer") };
}

// Literal process.env.NEXT_PUBLIC_* references, so Next.js inlines them in browser code.
const trustBoxes = resolveTrustBoxes(trustpilotByStore[storeConfig.id], {
  businessUnitId: process.env.NEXT_PUBLIC_TRUSTPILOT_BUSINESS_UNIT_ID,
  profileUrl: process.env.NEXT_PUBLIC_TRUSTPILOT_PROFILE_URL,
});

/** This shop's TrustBox at a placement, or null when it shows none there. */
export function trustBox(placement: TrustBoxPlacement): TrustBox | null {
  return trustBoxes[placement];
}

/** Whether this shop shows any TrustBox (and so loads Trustpilot's script; see the cookie policy). */
export const trustBoxesShown = Object.values(trustBoxes).some(Boolean);
