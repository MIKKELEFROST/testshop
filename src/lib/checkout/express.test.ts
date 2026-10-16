import { describe, expect, it } from "vitest";
import { checkoutRequestSchema, quoteRequestSchema } from "@/lib/validation/checkout";
import { expressCheckoutRequest, splitName, walletOpeningQuote, walletPostcode, walletShippingRates } from "./express";
import { ESTIMATE_ADDRESS, type ClientQuote } from "./quote";

const quote: ClientQuote = {
  currency: "DKK",
  taxDisplay: "incl",
  needsShipping: true,
  items: [],
  shippingRates: [
    { id: "flat_rate:1", label: "GLS til Døren", price: "73.75" },
    { id: "flat_rate:2", label: "DAO til Døren", price: "49.00" },
  ],
  shippingRateId: "flat_rate:2",
  totals: { subtotal: "179.00", discount: "17.90", shipping: "49.00", tax: "42.02", total: "210.10" },
  errors: [],
  couponsEnabled: true,
  coupons: [{ code: "test10", discount: "17.90" }],
  couponErrors: [],
};

const lines = [{ key: "18:0", productId: 18, variationId: 0, quantity: 1, name: "Superheltekappe", price: "179.00" }] as never;

const appleAddress = { line1: "Testvej 1", line2: "", city: "Aarhus C", postal_code: "8000", country: "DK" };

describe("express checkout helpers", () => {
  it("splits a wallet name into first and last name", () => {
    expect(splitName("Mikkel Frost")).toEqual({ firstName: "Mikkel", lastName: "Frost" });
    expect(splitName("Anne Marie  Hansen")).toEqual({ firstName: "Anne Marie", lastName: "Hansen" });
    expect(splitName("Cher")).toEqual({ firstName: "Cher", lastName: "Cher" });
    expect(splitName(undefined)).toEqual({ firstName: "", lastName: "" });
  });

  it("normalises postcodes", () => {
    expect(walletPostcode("DK-8000")).toBe("8000");
    expect(walletPostcode(null)).toBe("");
  });

  it("offers WooCommerce's rates in the wallet, its current choice first, in øre", () => {
    const thursdayMorning = new Date("2026-10-15T08:00:00Z");
    expect(walletShippingRates(quote, thursdayMorning)).toEqual([
      { id: "flat_rate:2", displayName: "DAO til Døren", amount: 4900, deliveryEstimate: "Sendes i dag – levering normalt næste hverdag" },
      { id: "flat_rate:1", displayName: "GLS til Døren", amount: 7375, deliveryEstimate: "Sendes i dag – levering normalt næste hverdag" },
    ]);
  });

  it("says in the wallet that an evening or weekend order is sent the next working day", () => {
    for (const when of ["2026-10-15T18:30:00Z", "2026-10-18T10:00:00Z"]) {
      for (const rate of walletShippingRates(quote, new Date(when))) {
        expect(rate.deliveryEstimate).toBe("Sendes næste hverdag – levering normalt hverdagen efter");
      }
    }
  });

  it("opens the wallet with rates before the customer has typed an address", () => {
    // WooCommerce only prices shipping for an address with a postcode: the form's first quote has no rates.
    const noAddress: ClientQuote = { ...quote, shippingRates: [], shippingRateId: null, totals: { ...quote.totals, shipping: "0.00", total: "161.10" } };
    expect(walletOpeningQuote(noAddress, quote)).toBe(quote);
    expect(walletShippingRates(walletOpeningQuote(noAddress, quote)!)).toHaveLength(2);
    // Without the estimate (still loading or failed) the wallet cannot open.
    expect(walletOpeningQuote(noAddress, null)).toBeNull();
    expect(walletOpeningQuote(noAddress, { ...quote, errors: [{ code: "out_of_stock", message: "", productId: 18, variationId: 0, available: 0 }] })).toBeNull();
    // Once the form has rates, or nothing is shipped, the form's quote is used.
    expect(walletOpeningQuote(quote, null)).toBe(quote);
    const nothingShipped = { ...noAddress, needsShipping: false };
    expect(walletOpeningQuote(nothingShipped, null)).toBe(nothingShipped);
    expect(quoteRequestSchema.safeParse({ items: [{ productId: 18, quantity: 1 }], address: ESTIMATE_ADDRESS }).success).toBe(true);
  });

  it("builds a valid checkout request from an Apple Pay payment", () => {
    const request = expressCheckoutRequest({
      lines,
      quote,
      billingDetails: { name: "Mikkel Frost", email: "kunde@example.com", phone: "", address: appleAddress },
      shippingAddress: { name: "Mikkel Frost", address: appleAddress },
      shippingRateId: "flat_rate:2",
    });
    const parsed = checkoutRequestSchema.safeParse(request);
    expect(parsed.success).toBe(true);
    expect(request).toMatchObject({
      contact: { email: "kunde@example.com" },
      shipping: { firstName: "Mikkel", lastName: "Frost", address1: "Testvej 1", postcode: "8000", city: "Aarhus C", country: "DK" },
      billingSameAsShipping: true,
      shippingRateId: "flat_rate:2",
      expectedTotal: "210.10",
      coupons: ["test10"],
      items: [{ productId: 18, variationId: 0, quantity: 1 }],
    });
  });

  it("keeps a different billing address, and falls back to the billing contact without a shipping contact", () => {
    const withBilling = expressCheckoutRequest({
      lines,
      quote,
      billingDetails: { name: "Firma ApS", email: "a@example.com", address: { ...appleAddress, line1: "Kontorvej 2", postal_code: "2100", city: "København Ø" } },
      shippingAddress: { name: "Mikkel Frost", address: appleAddress },
    });
    expect(withBilling.billingSameAsShipping).toBe(false);
    expect(withBilling.billing).toMatchObject({ address1: "Kontorvej 2", postcode: "2100" });
    expect(withBilling.shippingRateId).toBe("flat_rate:2");

    const noShipping = expressCheckoutRequest({ lines, quote, billingDetails: { name: "Mikkel Frost", email: "a@example.com", address: appleAddress } });
    expect(noShipping.shipping).toMatchObject({ address1: "Testvej 1", postcode: "8000" });
    expect(checkoutRequestSchema.safeParse(noShipping).success).toBe(true);
  });

  it("an address outside Denmark is rejected before anything is created", () => {
    const request = expressCheckoutRequest({
      lines,
      quote,
      billingDetails: { name: "Ola Nordmann", email: "ola@example.com", address: { ...appleAddress, country: "NO", postal_code: "0150" } },
      shippingAddress: { name: "Ola Nordmann", address: { ...appleAddress, country: "NO", postal_code: "0150" } },
    });
    expect(checkoutRequestSchema.safeParse(request).success).toBe(false);
  });
});
