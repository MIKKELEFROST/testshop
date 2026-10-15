import { company } from "@/config/company";
import { storeConfig, type StoreConfig } from "@/config/store";
import type { StoreBrandingInput } from "@/lib/woocommerce/checkout-api";

/**
 * The webshop's brand, sent with the order so WooCommerce's order e-mails show this webshop
 * (name, Reply-To, address, colour, logo) instead of the WordPress site, and the order
 * confirmation carries the withdrawal information and form with the seller's details and
 * return rules (plugin 1.4).
 */

/** E-mail colour for a brand without its own "action" colour: the default in app/globals.css. */
export const DEFAULT_EMAIL_COLOR = "#1d1b19";

/** The e-mail header image every storefront draws from its brand (app/email-logo.png/route.tsx). */
export const EMAIL_LOGO_PATH = "/email-logo.png";

/** The shops' return period: "30 dages returret" in the terms (src/content/info-pages.ts). */
export const RETURN_DAYS = 30;

type Seller = Pick<typeof company, "name" | "address" | "cvr" | "returnAddress" | "returnShipping">;

/**
 * The brand for an order. Company details that are still placeholders ("[Returadresse]") are
 * sent as they are, so the test e-mails show what is missing, as the shop's pages do.
 */
export function storeBranding(
  config: Pick<StoreConfig, "name" | "supportEmail" | "theme"> = storeConfig,
  siteUrl: string | undefined = process.env.NEXT_PUBLIC_SITE_URL,
  seller: Seller = company,
): StoreBrandingInput {
  const branding: StoreBrandingInput = {
    name: config.name,
    email: config.supportEmail,
    color: config.theme.action ?? DEFAULT_EMAIL_COLOR,
    company_name: seller.name,
    company_address: seller.address,
    cvr: seller.cvr,
    return_address: seller.returnAddress,
    return_shipping: seller.returnShipping,
    return_days: RETURN_DAYS,
  };
  const url = siteUrl?.trim() ?? "";
  const site = parseHttpUrl(url);
  if (site) {
    branding.url = url;
    branding.logo = new URL(EMAIL_LOGO_PATH, site).href;
  }
  return branding;
}

/** No or a malformed NEXT_PUBLIC_SITE_URL leaves out the address and logo instead of failing the checkout. */
function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}
