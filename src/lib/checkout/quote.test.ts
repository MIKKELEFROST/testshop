import { describe, expect, it } from "vitest";
import { quoteSchema } from "@/lib/woocommerce/schemas";
import { includesShipping, toClientQuote } from "./quote";

const base = {
  currency: "DKK",
  price_decimals: 2,
  prices_include_tax: true,
  tax_display_cart: "incl",
  items: [],
  needs_shipping: true,
  shipping_rates: [],
  shipping_rate_id: null,
  totals: { subtotal: "199.20", subtotal_tax: "49.80", discount: "0.00", shipping: "39.20", shipping_tax: "9.80", fees: "0.00", tax: "59.60", total: "298.00" },
  errors: [],
  cart_hash: "abc",
};

describe("toClientQuote", () => {
  it("shows coupon discounts incl. VAT when the shop displays prices incl. VAT", () => {
    const quote = quoteSchema.parse({
      ...base,
      totals: { ...base.totals, discount: "19.92", discount_tax: "4.98", tax: "54.62", total: "273.10" },
      coupons_enabled: true,
      coupons: [{ code: "sommer10", discount: "19.92", discount_tax: "4.98" }],
      coupon_errors: [{ code: "findes-ikke", message: "Kuponen findes ikke." }],
    });
    const client = toClientQuote(quote);
    expect(client.totals.discount).toBe("24.90");
    expect(client.coupons).toEqual([{ code: "sommer10", discount: "24.90" }]);
    expect(client.couponErrors).toEqual([{ code: "findes-ikke", message: "Kuponen findes ikke." }]);
    expect(client.couponsEnabled).toBe(true);
  });

  it("works with plugin 1.0, which knows no coupons (the coupon field stays hidden)", () => {
    const client = toClientQuote(quoteSchema.parse(base));
    expect(client).toMatchObject({ couponsEnabled: false, coupons: [], couponErrors: [], totals: { discount: "0.00", total: "298.00" } });
  });
});

describe("includesShipping", () => {
  const client = toClientQuote(quoteSchema.parse({ ...base, coupons_enabled: false, coupons: [], coupon_errors: [] }));

  it("is false until a shipping method is chosen", () => {
    expect(includesShipping(client, null)).toBe(false);
    const priced = { ...client, shippingRates: [{ id: "flat_rate:3", label: "PostNord – nærmeste pakkeshop", price: "39.00" }], shippingRateId: "flat_rate:3" };
    expect(includesShipping(priced, "flat_rate:3")).toBe(true);
    expect(includesShipping(priced, "flat_rate:9")).toBe(false);
  });

  it("is true when nothing is shipped", () => {
    expect(includesShipping({ ...client, needsShipping: false }, null)).toBe(true);
  });
});
