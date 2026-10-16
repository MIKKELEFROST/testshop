import { formatPrice, fromMinorUnits, toMinorUnits } from "@/lib/money";
import type { WcQuote } from "@/lib/woocommerce/schemas";

/**
 * Quote as sent to the browser. All amounts are calculated by WooCommerce; here they are
 * only combined for display according to the shop's "display prices in cart" setting.
 */
export type ClientQuote = {
  currency: string;
  taxDisplay: "incl" | "excl";
  needsShipping: boolean;
  items: {
    productId: number;
    variationId: number;
    name: string;
    sku: string;
    quantity: number;
    unitPrice: string;
    lineTotal: string;
    stockQuantity: number | null;
  }[];
  shippingRates: { id: string; label: string; price: string }[];
  shippingRateId: string | null;
  totals: { subtotal: string; discount: string; shipping: string; tax: string; total: string };
  errors: { code: string; message: string; productId: number; variationId: number; available: number | null }[];
  couponsEnabled: boolean;
  /** Coupons WooCommerce applied, with their discount. */
  coupons: { code: string; discount: string }[];
  /** Requested coupons WooCommerce rejected, with its reason. */
  couponErrors: { code: string; message: string }[];
  /** Goods from this amount get free shipping (some methods), when the quote route knows it. */
  freeShippingFrom?: string | null;
};

const EXP = 4; // WooCommerce never returns more than 4 decimals.

function add(a: string, b: string): string {
  return trim(fromMinorUnits(toMinorUnits(a, EXP) + toMinorUnits(b, EXP), EXP));
}

function trim(value: string): string {
  return value.replace(/(\.\d\d)\d*$/, (_m, two: string) => two);
}

export function toClientQuote(quote: WcQuote): ClientQuote {
  const incl = quote.tax_display_cart !== "excl";
  const withTax = (net: string, tax: string) => (incl ? add(net, tax) : trim(net));

  return {
    currency: quote.currency,
    taxDisplay: incl ? "incl" : "excl",
    needsShipping: quote.needs_shipping,
    items: quote.items.map((item) => ({
      productId: item.product_id,
      variationId: item.variation_id,
      name: item.name,
      sku: item.sku,
      quantity: item.quantity,
      unitPrice: incl ? item.unit_price : trim(fromMinorUnits(Math.round(toMinorUnits(item.line_subtotal, EXP) / item.quantity), EXP)),
      lineTotal: withTax(item.line_subtotal, item.line_subtotal_tax),
      stockQuantity: item.stock_quantity,
    })),
    shippingRates: quote.shipping_rates.map((rate) => ({ id: rate.id, label: rate.label, price: withTax(rate.cost, rate.tax) })),
    shippingRateId: quote.shipping_rate_id,
    totals: {
      subtotal: withTax(quote.totals.subtotal, quote.totals.subtotal_tax),
      discount: withTax(quote.totals.discount, quote.totals.discount_tax),
      shipping: withTax(quote.totals.shipping, quote.totals.shipping_tax),
      tax: trim(quote.totals.tax),
      // Passed back unchanged as `expectedTotal` when the customer pays.
      total: quote.totals.total,
    },
    errors: quote.errors.map((e) => ({
      code: e.code,
      message: e.message,
      productId: e.product_id,
      variationId: e.variation_id,
      available: e.available ?? null,
    })),
    couponsEnabled: quote.coupons_enabled,
    coupons: quote.coupons.map((c) => ({ code: c.code, discount: withTax(c.discount, c.discount_tax) })),
    couponErrors: quote.coupon_errors,
  };
}

/**
 * A Danish address for prices before the customer has typed one (the cart, the Apple Pay /
 * Google Pay sheet): WooCommerce only returns shipping rates for an address with a postcode,
 * and the flat rates are the same in all of Denmark.
 */
export const ESTIMATE_ADDRESS = { country: "DK", postcode: "1050", city: "København K" };

/** The cheapest shipping rate's price, or null when the quote has no rates. */
export function cheapestShipping(quote: ClientQuote): string | null {
  if (quote.shippingRates.length === 0) return null;
  return quote.shippingRates.reduce((low, rate) => (toMinorUnits(rate.price, EXP) < toMinorUnits(low, EXP) ? rate.price : low), quote.shippingRates[0]!.price);
}

/**
 * "Fragt" in the cart, from a quote for ESTIMATE_ADDRESS: "fra 39,00 kr.", or "Gratis til
 * pakkeshop" once the goods reach "Fri fragt fra" (the free rates are the parcel shop ones).
 * Null when nothing is shipped.
 */
export function cartShippingLabel(quote: ClientQuote | null): string | null {
  if (quote && !quote.needsShipping) return null;
  const cheapest = quote ? cheapestShipping(quote) : null;
  if (!quote || cheapest === null) return "Beregnes ved kassen";
  if (toMinorUnits(cheapest, EXP) > 0) return `fra ${formatPrice(cheapest, quote.currency)}`;
  return quote.shippingRates.every((r) => toMinorUnits(r.price, EXP) === 0) ? "Gratis" : "Gratis til pakkeshop";
}

/** Whether the quote's total includes delivery: nothing is shipped, or a shipping method is chosen. */
export function includesShipping(quote: ClientQuote, selectedRateId: string | null): boolean {
  return !quote.needsShipping || (selectedRateId !== null && quote.shippingRates.some((r) => r.id === selectedRateId));
}

/**
 * What the checkout's "Leveringsmetode" shows: a request for the address, the quote's error
 * (with "Prøv igen"), progress while the rates for the address load, that nothing can be
 * delivered there, or the rates. While a new quote loads, the previous one is still the
 * `quote`: rates it has stay visible, but a quote without rates (asked for before the postcode
 * was typed) does not mean "we can't deliver there".
 */
export function shippingSection({
  postcodeValid,
  quote,
  loading,
  failed,
}: {
  postcodeValid: boolean;
  quote: ClientQuote | null;
  loading: boolean;
  /** The quote failed (also while "Prøv igen" runs). */
  failed: boolean;
}): "address" | "error" | "loading" | "undeliverable" | "rates" {
  if (!postcodeValid) return "address";
  if (failed) return "error";
  if (quote && quote.shippingRates.length > 0) return "rates";
  return loading || !quote ? "loading" : "undeliverable";
}

/** The line under "Betal nu": what the customer pays, and whether delivery is included yet. */
export function payTotalLine({
  quote,
  selectedRateId,
  postcodeValid,
  loading,
}: {
  quote: ClientQuote | null;
  selectedRateId: string | null;
  postcodeValid: boolean;
  loading: boolean;
}): string {
  if (!quote) return "";
  const total = formatPrice(quote.totals.total);
  if (includesShipping(quote, selectedRateId)) return `Du betaler ${total} inkl. moms og levering.`;
  if (!postcodeValid) return `Du betaler ${total} inkl. moms. Levering beregnes, når du har angivet din adresse.`;
  // The address is there: its rates are on their way, or it can't be delivered to (said above).
  return loading ? "Henter fragtpriser…" : `Du betaler ${total} inkl. moms.`;
}
