/**
 * The shop's selling points (USP'er). "{fri_fragt}" becomes the free shipping amount from
 * WooCommerce ("Fri fragt fra" on the shipping methods, e.g. "599 kr."); a selling point that
 * mentions it is left out when no shipping method is free from an amount.
 *
 * Shared by all webshops. They are promises to customers, so change them here if a webshop
 * cannot keep one.
 */

import { formatAmount } from "@/lib/money";

export type UspIcon = "gift" | "rabbit" | "piggy-bank" | "return-30" | "happy" | "clock-truck" | "denmark" | "box" | "trophy";

export type Usp = { icon: UspIcon; title: string; text?: string };

/*
 * Only parcel-shop delivery becomes free from the amount (door delivery keeps its price), so
 * every free shipping promise says "til pakkeshop". Delivery: sent the same day when ordered
 * before 19:00 on a weekday, normally delivered the next weekday ("1-dags levering"); never a
 * date.
 */

/** Row of five above the footer on every shop page. */
export const USP_STRIP: Usp[] = [
  { icon: "gift", title: "Fri fragt til pakkeshop v/ {fri_fragt}" },
  { icon: "rabbit", title: "1-dags levering" },
  { icon: "piggy-bank", title: "100% prismatch" },
  { icon: "return-30", title: "Gratis retur i 30 dage" },
  { icon: "happy", title: "+500.000 glade kunder" },
];

/** Under "Læg i kurv" on product pages. */
export const USP_PRODUCT: Usp[] = [
  { icon: "clock-truck", title: "Lynhurtig 1-dags levering", text: "Bestil før kl. 19 på hverdage" },
  { icon: "denmark", title: "Dansk webshop", text: "Dansk lager og kundeservice" },
  { icon: "box", title: "Gratis fragt", text: "til pakkeshop ved {fri_fragt}" },
  { icon: "trophy", title: "Bedømt som Fremragende", text: "+30.000 femstjernede anmeldelser" },
];

/**
 * The selling points without the text-only rating ("Bedømt som Fremragende"), where a Trustpilot
 * TrustBox shows the real one instead (src/config/trustpilot.ts).
 */
export function withoutRating(usps: Usp[]): Usp[] {
  return usps.filter((usp) => usp.icon !== "trophy");
}

/** The return promise in "Levering og retur" on product pages: free returns (company.returnShipping). */
export const RETURN_PROMISE = "Gratis retur i 30 dage";

/**
 * The return promise on products sold with a hygiene seal (HYGIENE_CATEGORY_SLUGS in
 * src/config/catalog.ts): the law lets the shop refuse them once the seal is broken, but only
 * when the customer is told before buying (see /fortrydelsesret).
 */
export const HYGIENE_RETURN_PROMISE = "Gratis retur i 30 dage – gælder ikke, hvis forseglingen er brudt (hygiejnevare)";

/** "Levering og retur" on product pages. */
export const DELIVERY_FACTS: string[] = [
  "Fri fragt til pakkeshop ved køb for mindst {fri_fragt}",
  "Lynhurtig 1-dags levering: bestil før kl. 19 på en hverdag, så sender vi samme dag, og pakken er normalt fremme hverdagen efter",
  "Levering til pakkeshop eller til døren. Du vælger fragtfirma i kassen.",
  RETURN_PROMISE,
];

/** The bar above the header. */
export const USP_BAR: string[] = ["Fri fragt til pakkeshop v/ {fri_fragt}", "1-dags levering", "Gratis retur i 30 dage"];

const FREE_SHIPPING = "{fri_fragt}";

/** "599 kr." (whole kroner without øre). */
export function formatThreshold(amount: string): string {
  return `${formatAmount(amount)} kr.`;
}

function fill(text: string, freeShippingFrom: string | null): string | null {
  if (!text.includes(FREE_SHIPPING)) return text;
  return freeShippingFrom ? text.replaceAll(FREE_SHIPPING, formatThreshold(freeShippingFrom)) : null;
}

/** Selling points with the free shipping amount filled in; those that need it are dropped without it. */
export function resolveUsps(usps: Usp[], freeShippingFrom: string | null): Usp[] {
  return usps.flatMap((usp) => {
    const title = fill(usp.title, freeShippingFrom);
    const text = usp.text === undefined ? undefined : fill(usp.text, freeShippingFrom);
    return title === null || text === null ? [] : [{ ...usp, title, ...(text === undefined ? {} : { text }) }];
  });
}

export function resolveTexts(texts: string[], freeShippingFrom: string | null): string[] {
  return texts.map((t) => fill(t, freeShippingFrom)).filter((t): t is string => t !== null);
}
