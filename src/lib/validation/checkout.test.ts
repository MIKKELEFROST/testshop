import { describe, expect, it } from "vitest";
import { addressSchema, checkoutRequestSchema, fieldErrors, quoteRequestSchema } from "./checkout";

const address = {
  firstName: "Test",
  lastName: "Kunde",
  address1: "Testvej 1",
  postcode: "8000",
  city: "Aarhus C",
  country: "DK",
};

const valid = {
  items: [{ productId: 10, variationId: 0, quantity: 2 }],
  contact: { email: "test@example.com", phone: "+45 12 34 56 78" },
  shipping: address,
  billingSameAsShipping: true,
  shippingRateId: "flat_rate:1",
  expectedTotal: "547.00",
};

describe("checkout validation", () => {
  it("accepts a complete Danish checkout", () => {
    expect(checkoutRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("validates Danish addresses", () => {
    expect(addressSchema.safeParse({ ...address, postcode: "800" }).success).toBe(false);
    expect(addressSchema.safeParse({ ...address, postcode: "80000" }).success).toBe(false);
    expect(addressSchema.safeParse({ ...address, postcode: "abcd" }).success).toBe(false);
    expect(addressSchema.safeParse({ ...address, city: "  " }).success).toBe(false);
    expect(addressSchema.safeParse({ ...address, country: "SE" }).success).toBe(false);
  });

  it("returns Danish field errors keyed by path", () => {
    const result = checkoutRequestSchema.safeParse({ ...valid, contact: { email: "nope" }, shipping: { ...address, postcode: "1" } });
    expect(result.success).toBe(false);
    const errors = fieldErrors(result.error!);
    expect(errors["contact.email"]).toBe("Indtast en gyldig e-mailadresse.");
    expect(errors["shipping.postcode"]).toBe("Postnummeret skal være 4 cifre.");
  });

  it("requires a billing address when it differs from shipping", () => {
    const result = checkoutRequestSchema.safeParse({ ...valid, billingSameAsShipping: false });
    expect(result.success).toBe(false);
    expect(fieldErrors(result.error!)["billing"]).toBe("Faktureringsadressen mangler.");
  });

  it("never lets the browser send prices", () => {
    const result = checkoutRequestSchema.parse({
      ...valid,
      total: "1.00",
      items: [{ productId: 10, variationId: 0, quantity: 1, price: "0.01" }],
    });
    expect(result).not.toHaveProperty("total");
    expect(result.items[0]).not.toHaveProperty("price");
  });

  it("rejects invalid quantities and oversized carts", () => {
    expect(checkoutRequestSchema.safeParse({ ...valid, items: [{ productId: 10, quantity: 0 }] }).success).toBe(false);
    expect(checkoutRequestSchema.safeParse({ ...valid, items: [{ productId: 10, quantity: 1000 }] }).success).toBe(false);
    expect(checkoutRequestSchema.safeParse({ ...valid, items: [{ productId: 1.5, quantity: 1 }] }).success).toBe(false);
    expect(checkoutRequestSchema.safeParse({ ...valid, items: [] }).success).toBe(false);
    const many = Array.from({ length: 51 }, (_, i) => ({ productId: i + 1, quantity: 1 }));
    expect(quoteRequestSchema.safeParse({ items: many }).success).toBe(false);
  });

  it("rejects malformed totals and shipping rate ids", () => {
    expect(checkoutRequestSchema.safeParse({ ...valid, expectedTotal: "-1" }).success).toBe(false);
    expect(checkoutRequestSchema.safeParse({ ...valid, expectedTotal: "1e9" }).success).toBe(false);
    expect(checkoutRequestSchema.safeParse({ ...valid, shippingRateId: "flat_rate:1;drop" }).success).toBe(false);
  });
});
