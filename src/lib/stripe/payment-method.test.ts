import { describe, expect, it } from "vitest";
import { paymentMethodTitle } from "./payment-method";

describe("paymentMethodTitle", () => {
  it("names the method the customer actually used", () => {
    expect(paymentMethodTitle({ type: "mobilepay" })).toBe("MobilePay (Stripe)");
    expect(paymentMethodTitle({ type: "card", card: { brand: "visa", wallet: null } })).toBe("Visa-kort (Stripe)");
    expect(paymentMethodTitle({ type: "card", card: { brand: "mastercard", wallet: "apple_pay" } })).toBe("Apple Pay (Stripe)");
    expect(paymentMethodTitle({ type: "card", card: { brand: "unknown" } })).toBe("Betalingskort (Stripe)");
    expect(paymentMethodTitle({ type: "some_new_method" })).toBe("Some new method (Stripe)");
  });

  it("leaves the title unchanged when the method is unknown", () => {
    expect(paymentMethodTitle(null)).toBeUndefined();
    expect(paymentMethodTitle(undefined)).toBeUndefined();
  });
});
