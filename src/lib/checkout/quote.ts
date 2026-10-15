import { fromMinorUnits, toMinorUnits } from "@/lib/money";
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

/** Whether the quote's total includes delivery: nothing is shipped, or a shipping method is chosen. */
export function includesShipping(quote: ClientQuote, selectedRateId: string | null): boolean {
  return !quote.needsShipping || (selectedRateId !== null && quote.shippingRates.some((r) => r.id === selectedRateId));
}

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
