import { describe, expect, it } from "vitest";
import { formatPrice } from "@/lib/money";
import { quoteSchema } from "@/lib/woocommerce/schemas";
import { cartShippingLabel, cheapestShipping, couponRejectionMessage, includesShipping, payTotalLine, shippingSection, toClientQuote } from "./quote";

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

describe("shipping in the cart", () => {
  const client = toClientQuote(quoteSchema.parse({ ...base, coupons_enabled: false, coupons: [], coupon_errors: [] }));
  const rate = (id: string, price: string) => ({ id, label: id, price });
  const rates = [rate("dao-doer", "49.00"), rate("postnord-pakkeshop", "39.00"), rate("gls-doer", "59.00")];

  it("shows the cheapest rate", () => {
    expect(cheapestShipping({ ...client, shippingRates: rates })).toBe("39.00");
    expect(cartShippingLabel({ ...client, shippingRates: rates })).toBe(`fra ${formatPrice("39.00")}`);
  });

  it("says free to the parcel shop above the free shipping amount", () => {
    const free = rates.map((r) => (r.id.includes("pakkeshop") ? { ...r, price: "0.00" } : r));
    expect(cartShippingLabel({ ...client, shippingRates: free })).toBe("Gratis til pakkeshop");
    expect(cartShippingLabel({ ...client, shippingRates: rates.map((r) => ({ ...r, price: "0.00" })) })).toBe("Gratis");
  });

  it("leaves shipping to the checkout without rates, and says nothing when nothing is shipped", () => {
    expect(cheapestShipping(client)).toBeNull();
    expect(cartShippingLabel(client)).toBe("Beregnes ved kassen");
    expect(cartShippingLabel(null)).toBe("Beregnes ved kassen");
    expect(cartShippingLabel({ ...client, needsShipping: false })).toBeNull();
  });
});

describe("the checkout's delivery methods", () => {
  const noRates = toClientQuote(quoteSchema.parse({ ...base, coupons_enabled: false, coupons: [], coupon_errors: [] }));
  const priced = { ...noRates, shippingRates: [{ id: "flat_rate:3", label: "PostNord – nærmeste pakkeshop", price: "39.00" }], shippingRateId: "flat_rate:3" };
  const state = (postcodeValid: boolean, quote: typeof noRates | null, loading: boolean, failed = false) => shippingSection({ postcodeValid, quote, loading, failed });

  it("asks for the address until the postcode is valid", () => {
    expect(state(false, noRates, false)).toBe("address");
    expect(state(false, null, false, true)).toBe("address");
  });

  it("loads, rather than saying it can't deliver, while the quote without a postcode is replaced", () => {
    // The first quote was asked for without a postcode and has no rates; the postcode was just typed.
    expect(state(true, noRates, true)).toBe("loading");
    expect(state(true, null, true)).toBe("loading");
    expect(state(true, noRates, false)).toBe("undeliverable");
  });

  it("keeps the rates shown while a new quote loads (e.g. a street name is typed)", () => {
    expect(state(true, priced, true)).toBe("rates");
    expect(state(true, priced, false)).toBe("rates");
  });

  it("shows the error with \"Prøv igen\" there when the quote failed, also while it is retried", () => {
    expect(state(true, null, false, true)).toBe("error");
    expect(state(true, null, true, true)).toBe("error");
  });

  it("says under the pay button whether delivery is included, and that rates are on their way", () => {
    const line = (quote: typeof noRates | null, postcodeValid: boolean, loading: boolean) => payTotalLine({ quote, selectedRateId: quote?.shippingRateId ?? null, postcodeValid, loading });
    expect(line(priced, true, false)).toBe(`Du betaler ${formatPrice("298.00")} inkl. moms og levering.`);
    expect(line(noRates, false, false)).toBe(`Du betaler ${formatPrice("298.00")} inkl. moms. Levering beregnes, når du har angivet din adresse.`);
    expect(line(noRates, true, true)).toBe("Henter fragtpriser…");
    expect(line(noRates, true, false)).toBe(`Du betaler ${formatPrice("298.00")} inkl. moms.`);
    expect(line(null, true, true)).toBe("");
  });

  it("says by the disabled pay button where the failed quote's error and \"Prøv igen\" are", () => {
    const line = (failed: boolean) => payTotalLine({ quote: null, selectedRateId: null, postcodeValid: true, loading: false, failed });
    expect(line(true)).toBe("Vi kan ikke beregne priser lige nu – prøv igen under Leveringsmetode.");
    expect(line(false)).toBe("");
  });
});

describe("couponRejectionMessage", () => {
  it("says in the shop's words, with the code as typed, that an unknown code does not exist", () => {
    expect(couponRejectionMessage("FORKERT2026", 'Kupon "forkert2026" kan ikke anvendes, fordi den ikke findes.')).toBe('Rabatkoden "FORKERT2026" findes ikke.');
    expect(couponRejectionMessage("Nope", 'Coupon "nope" does not exist!')).toBe('Rabatkoden "Nope" findes ikke.');
  });

  it("keeps WooCommerce's reason for anything else, e.g. a minimum spend", () => {
    const minimum = "Minimumsforbruget for denne kupon er 300,00 kr.";
    expect(couponRejectionMessage("SOMMER10", minimum)).toBe(minimum);
    expect(couponRejectionMessage("SOMMER10", undefined)).toBe('Rabatkoden "SOMMER10" kan ikke bruges.');
  });
});
