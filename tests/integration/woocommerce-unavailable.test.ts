/**
 * WooCommerce temporarily unavailable: the storefront must fail safe (no order, no
 * payment) and report a retryable error instead of crashing.
 */
import { describe, expect, it } from "vitest";
import { FakeStripe } from "../support/fake-stripe";

process.env.WOOCOMMERCE_URL = "http://127.0.0.1:9"; // nothing listens here
process.env.WOOCOMMERCE_CONSUMER_KEY = "ck_unreachable";
process.env.WOOCOMMERCE_CONSUMER_SECRET = "cs_unreachable";
process.env.WOOCOMMERCE_TIMEOUT_MS = "2000";

const { WooCommerceError } = await import("@/lib/woocommerce/client");
const { createOrder, attachPaymentIntent, sendPaymentEvent, fetchQuote } = await import("@/lib/woocommerce/checkout-api");
const { startCheckout } = await import("@/lib/checkout/service");
const { handleStripeEvent } = await import("@/lib/checkout/webhook");

const request = {
  items: [{ productId: 10, variationId: 0, quantity: 1 }],
  contact: { email: "x@example.com", phone: "" },
  shipping: { firstName: "A", lastName: "B", company: "", address1: "Vej 1", address2: "", postcode: "8000", city: "Aarhus", country: "DK" },
  billingSameAsShipping: true,
  shippingRateId: "flat_rate:1",
  expectedTotal: "298.00",
  customerNote: "",
};

describe("WooCommerce unavailable", () => {
  it("quote fails with a retryable error", async () => {
    const error = await fetchQuote({ items: [{ product_id: 10, variation_id: 0, quantity: 1 }], address: {} }).catch((e) => e);
    expect(error).toBeInstanceOf(WooCommerceError);
    expect(error.retryable).toBe(true);
  });

  it("checkout creates no payment", async () => {
    const stripe = new FakeStripe();
    await expect(
      startCheckout(request, { checkoutId: "chk_unavailable_0001" }, { backend: { createOrder, attachPaymentIntent, sendPaymentEvent }, gateway: stripe }),
    ).rejects.toBeInstanceOf(WooCommerceError);
    expect(stripe.calls.create).toBe(0);
  });

  it("webhook answers 500 so Stripe retries later", async () => {
    const stripe = new FakeStripe();
    const pi = await stripe.create({ amount: 29800, currency: "dkk", description: "x", metadata: { wc_order_id: "5", wc_order_key: "wc_order_x", store_id: "piece-dk" } }, "k");
    stripe.succeed(pi.id);
    const result = await handleStripeEvent(
      { id: "evt_1", type: "payment_intent.succeeded", data: { object: { id: pi.id, object: "payment_intent" } } },
      { backend: { createOrder, attachPaymentIntent, sendPaymentEvent }, gateway: stripe },
    );
    expect(result.status).toBe(500);
  });
});
