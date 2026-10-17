/**
 * WooCommerce temporarily unavailable: the storefront must fail safe (no order, no
 * payment) and report a retryable error instead of crashing.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { FakeStripe } from "../support/fake-stripe";

// The catalogue reads' "use cache: remote" lifetimes and tags only mean something inside Next.js.
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {} }));

process.env.WOOCOMMERCE_URL = "http://127.0.0.1:9"; // nothing listens here
process.env.WOOCOMMERCE_CONSUMER_KEY = "ck_unreachable";
process.env.WOOCOMMERCE_CONSUMER_SECRET = "cs_unreachable";
process.env.WOOCOMMERCE_TIMEOUT_MS = "2000";

const { WooCommerceError } = await import("@/lib/woocommerce/client");
const { createOrder, attachPaymentIntent, sendPaymentEvent, fetchQuote } = await import("@/lib/woocommerce/checkout-api");
const { startCheckout } = await import("@/lib/checkout/service");
const { handleStripeEvent } = await import("@/lib/checkout/webhook");
const { wooRequest } = await import("@/lib/woocommerce/client");
const { getProductBySlug, getRelatedProducts } = await import("@/lib/woocommerce/products");

const request = {
  items: [{ productId: 10, variationId: 0, quantity: 1 }],
  contact: { email: "x@example.com", phone: "" },
  shipping: { firstName: "A", lastName: "B", company: "", address1: "Vej 1", address2: "", postcode: "8000", city: "Aarhus", country: "DK" },
  billingSameAsShipping: true,
  shippingRateId: "flat_rate:1",
  expectedTotal: "298.00",
  customerNote: "",
  coupons: [],
};

describe("WooCommerce unavailable", () => {
  it("quote fails with a retryable error", async () => {
    const error = await fetchQuote({ store_id: "piece-dk", items: [{ product_id: 10, variation_id: 0, quantity: 1 }], address: {} }).catch((e) => e);
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

  it("catalogue reads: a page gets its friendly error, and once three reads found the host unreachable the others stop asking", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const sent = (part: string) => fetch.mock.calls.filter(([url]) => String(url).includes(part)).length;
    try {
      expect(await getProductBySlug("heks")).toEqual({ ok: false, error: "Vi kan ikke hente produkterne lige nu. Prøv igen om lidt." });
      expect(sent("slug=heks")).toBe(3); // a dropped connection is tried three times
      for (let i = 0; i < 2; i++) await wooRequest("wc/v3/products", { schema: z.unknown() }).catch(() => {});
      // The breaker is open. The related rows (background reads) are not asked for: the page shows the product without them.
      expect(await getRelatedProducts({ id: 1, name: "Heks", tags: [{ id: 5, name: "Hekse" }], audience: [], categories: [{ id: 7, name: "Kostumer", slug: "kostumer" }] })).toEqual({ accessories: [], similar: [] });
      expect(sent("orderby=popularity")).toBe(0);
      // A product page waits for its turn as the breaker's trial (sent once), then shows the friendly error.
      expect(await getProductBySlug("heks")).toEqual({ ok: false, error: "Vi kan ikke hente produkterne lige nu. Prøv igen om lidt." });
      expect(sent("slug=heks")).toBe(4);
    } finally {
      fetch.mockRestore();
    }
  });
});
