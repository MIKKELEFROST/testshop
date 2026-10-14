/**
 * End-to-end order & payment tests against a real WooCommerce (local Docker, see
 * scripts/local-woocommerce/setup.sh) with the Headless Checkout Bridge plugin.
 * Stripe is replaced by an in-memory fake with the same contract.
 *
 *   ./scripts/local-woocommerce/setup.sh && npm run test:integration
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventFor, FakeStripe } from "../support/fake-stripe";
import {
  cancelOpenOrders,
  expireStockHolds,
  getOrder,
  getProduct,
  orderNotes,
  productBySku,
  updateProduct,
  configureLocalWooEnv,
  variationBySku,
} from "../support/woo-admin";
import type { CheckoutRequest } from "@/lib/validation/checkout";

const enabled = Boolean(process.env.WC_INTEGRATION);
if (enabled) configureLocalWooEnv();

const { attachPaymentIntent, createOrder, fetchQuote, sendPaymentEvent } = await import("@/lib/woocommerce/checkout-api");
const { finalizePayment, startCheckout } = await import("@/lib/checkout/service");
const { handleStripeEvent } = await import("@/lib/checkout/webhook");

const backend = { createOrder, attachPaymentIntent, sendPaymentEvent };
const address = { firstName: "Test", lastName: "Kunde", company: "", address1: "Testvej 1", address2: "", postcode: "8000", city: "Aarhus C", country: "DK" };

let ids: { tshirt: number; hat: number; tote: number; candle: number; hoodie: number; hoodieM: number };
let checkoutSeq = 0;

function newCheckoutId() {
  return `chk_it_${Date.now().toString(36)}_${++checkoutSeq}_${Math.random().toString(36).slice(2, 8)}`;
}

type Line = { productId: number; variationId?: number; quantity: number };

async function quoteFor(lines: Line[], rateMethod = "flat_rate") {
  const items = lines.map((l) => ({ product_id: l.productId, variation_id: l.variationId ?? 0, quantity: l.quantity }));
  const first = await fetchQuote({ items, address: { country: "DK", postcode: address.postcode, city: address.city } });
  const rate = first.shipping_rates.find((r) => r.method_id === rateMethod) ?? first.shipping_rates[0];
  return fetchQuote({ items, address: { country: "DK", postcode: address.postcode, city: address.city }, shipping_rate_id: rate?.id ?? null });
}

async function requestFor(lines: Line[], rateMethod = "flat_rate"): Promise<CheckoutRequest> {
  const quote = await quoteFor(lines, rateMethod);
  return {
    items: lines.map((l) => ({ productId: l.productId, variationId: l.variationId ?? 0, quantity: l.quantity })),
    contact: { email: "integration@example.com", phone: "12345678" },
    shipping: address,
    billingSameAsShipping: true,
    shippingRateId: quote.shipping_rate_id,
    expectedTotal: quote.totals.total,
    customerNote: "",
  };
}

async function readyCheckout(stripe: FakeStripe, lines: Line[], checkoutId = newCheckoutId()) {
  const outcome = await startCheckout(await requestFor(lines), { checkoutId }, { backend, gateway: stripe });
  if (outcome.type !== "ready") throw new Error(`Expected ready, got ${outcome.type}`);
  return { ...outcome, checkoutId };
}

describe.skipIf(!enabled)("checkout against WooCommerce", () => {
  beforeAll(async () => {
    const hoodie = await productBySku("HOOD");
    ids = {
      tshirt: (await productBySku("TS-001")).id,
      hat: (await productBySku("HUE-001")).id,
      tote: (await productBySku("TOTE-001")).id,
      candle: (await productBySku("LYS-001")).id,
      hoodie: hoodie.id,
      hoodieM: (await variationBySku(hoodie.id, "HOOD-M")).id,
    };
  });

  beforeEach(async () => {
    await cancelOpenOrders();
    await updateProduct(ids.tshirt, { stock_quantity: 25, regular_price: "249" });
    await updateProduct(ids.hat, { stock_quantity: 10, regular_price: "199", sale_price: "149" });
    await updateProduct(ids.tote, { stock_quantity: 1, regular_price: "129" });
    await updateProduct(ids.hoodieM, { stock_quantity: 2, regular_price: "449" }, ids.hoodie);
  });

  afterEach(async () => {
    await cancelOpenOrders();
  });

  describe("products and quotes", () => {
    it("reads prices and stock exactly as stored in WooCommerce", async () => {
      const quote = await quoteFor([{ productId: ids.hat, quantity: 1 }, { productId: ids.hoodie, variationId: ids.hoodieM, quantity: 1 }]);
      const hat = quote.items.find((i) => i.product_id === ids.hat)!;
      expect(hat.unit_price).toBe("149.00"); // sale price
      expect(hat.stock_quantity).toBe(10);
      const hoodie = quote.items.find((i) => i.variation_id === ids.hoodieM)!;
      expect(hoodie.unit_price).toBe("449.00");
      expect(hoodie.stock_quantity).toBe(2);
    });

    it("calculates 25% Danish VAT on prices entered incl. VAT, and taxable shipping", async () => {
      const quote = await quoteFor([{ productId: ids.tshirt, quantity: 1 }]);
      // 249 incl. VAT = 199.20 + 49.80; GLS 39.20 + 9.80 VAT = 49.00
      expect(quote.totals).toMatchObject({ subtotal: "199.20", subtotal_tax: "49.80", shipping: "39.20", shipping_tax: "9.80", tax: "59.60", total: "298.00" });
    });

    it("applies WooCommerce's free-shipping threshold", async () => {
      const below = await quoteFor([{ productId: ids.tshirt, quantity: 1 }], "free_shipping");
      expect(below.shipping_rates.map((r) => r.method_id)).not.toContain("free_shipping");
      const above = await quoteFor([{ productId: ids.tshirt, quantity: 3 }], "free_shipping");
      expect(above.shipping_rate_id).toMatch(/^free_shipping:/);
      expect(above.totals.total).toBe("747.00");
    });

    it("reports sold-out and insufficient stock", async () => {
      const quote = await quoteFor([{ productId: ids.candle, quantity: 1 }, { productId: ids.hoodie, variationId: ids.hoodieM, quantity: 3 }]);
      expect(quote.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "out_of_stock", product_id: ids.candle }),
          expect.objectContaining({ code: "insufficient_stock", variation_id: ids.hoodieM, available: 2 }),
        ]),
      );
    });
  });

  describe("happy path", () => {
    it("creates a pending order, takes the payment and lets WooCommerce reduce stock once", async () => {
      const stripe = new FakeStripe();
      const ready = await readyCheckout(stripe, [{ productId: ids.tshirt, quantity: 2 }]);

      let order = await getOrder(ready.order.id);
      expect(order.status).toBe("pending");
      expect(order.total).toBe("547.00");
      expect(order.meta_data.find((m) => m.key === "_wchc_store_id")?.value).toBe("piece-dk");
      expect((await getProduct(ids.tshirt)).stock_quantity).toBe(25); // reserved, not reduced

      const pi = await stripe.retrieve(ready.paymentIntentId);
      expect(pi.amount).toBe(54700);

      stripe.succeed(pi.id);
      const result = await handleStripeEvent(eventFor(pi, "payment_intent.succeeded"), { backend, gateway: stripe });
      expect(result).toMatchObject({ status: 200, body: { outcome: "applied" } });

      order = await getOrder(ready.order.id);
      expect(order.status).toBe("processing");
      expect(order.transaction_id).toBe(pi.id);
      expect(order.date_paid).not.toBeNull();
      expect((await getProduct(ids.tshirt)).stock_quantity).toBe(23);
    });

    it("handles a repeated webhook without double processing", async () => {
      const stripe = new FakeStripe();
      const ready = await readyCheckout(stripe, [{ productId: ids.tshirt, quantity: 1 }]);
      stripe.succeed(ready.paymentIntentId);
      const event = eventFor({ id: ready.paymentIntentId }, "payment_intent.succeeded", "evt_same");

      const results = await Promise.all([
        handleStripeEvent(event, { backend, gateway: stripe }),
        handleStripeEvent(event, { backend, gateway: stripe }),
        handleStripeEvent(event, { backend, gateway: stripe }),
      ]);
      expect(results.every((r) => r.status === 200)).toBe(true);
      const outcomes = results.map((r) => (r.outcome?.type === "applied" ? r.outcome.result : r.outcome?.type)).sort();
      expect(outcomes).toEqual(["already_paid", "already_paid", "paid"]);

      expect((await getProduct(ids.tshirt)).stock_quantity).toBe(24);
      const notes = await orderNotes(ready.order.id);
      expect(notes.filter((n) => n.includes("Betaling gennemført"))).toHaveLength(1);
    });

    it("confirmation page fast-path and webhook converge on the same result", async () => {
      const stripe = new FakeStripe();
      const ready = await readyCheckout(stripe, [{ productId: ids.hat, quantity: 1 }]);
      stripe.succeed(ready.paymentIntentId);
      const pi = await stripe.retrieve(ready.paymentIntentId);

      const [fromReturnUrl, fromWebhook] = await Promise.all([
        finalizePayment(pi, { backend, gateway: stripe }),
        handleStripeEvent(eventFor(pi, "payment_intent.succeeded"), { backend, gateway: stripe }),
      ]);
      expect([fromReturnUrl.type, fromWebhook.outcome?.type]).toEqual(["applied", "applied"]);
      expect((await getProduct(ids.hat)).stock_quantity).toBe(9);
    });
  });

  describe("idempotency", () => {
    it("double-clicking Betal creates one order and one PaymentIntent", async () => {
      const stripe = new FakeStripe();
      const request = await requestFor([{ productId: ids.tshirt, quantity: 1 }]);
      const checkoutId = newCheckoutId();

      const outcomes = await Promise.all([1, 2, 3].map(() => startCheckout(request, { checkoutId }, { backend, gateway: stripe })));
      const ready = outcomes.filter((o) => o.type === "ready");
      expect(ready.length).toBeGreaterThanOrEqual(1);
      expect(new Set(ready.map((o) => o.type === "ready" && o.order.id)).size).toBe(1);
      expect(new Set(ready.map((o) => o.type === "ready" && o.paymentIntentId)).size).toBe(1);

      // Any request that lost the race can simply be retried and gets the same payment.
      const retry = await startCheckout(request, { checkoutId }, { backend, gateway: stripe });
      expect(retry.type === "ready" && retry.paymentIntentId).toBe(ready[0]!.type === "ready" && ready[0]!.paymentIntentId);
      const live = [...stripe.intents.values()].filter((pi) => pi.status !== "canceled");
      expect(live).toHaveLength(1);
    });

    it("a changed cart in the same session updates the same order instead of creating another", async () => {
      const stripe = new FakeStripe();
      const checkoutId = newCheckoutId();
      const first = await readyCheckout(stripe, [{ productId: ids.tshirt, quantity: 1 }], checkoutId);
      const second = await readyCheckout(stripe, [{ productId: ids.tshirt, quantity: 1 }, { productId: ids.hat, quantity: 1 }], checkoutId);

      expect(second.order.id).toBe(first.order.id);
      expect(second.paymentIntentId).toBe(first.paymentIntentId);
      expect((await stripe.retrieve(second.paymentIntentId)).amount).toBe(44700); // 249 + 149 + 49
      const order = await getOrder(first.order.id);
      expect(order.line_items).toHaveLength(2);
      expect(order.total).toBe("447.00");
    });
  });

  describe("failure scenarios", () => {
    it("declined payment keeps the order payable; a retry on the same PaymentIntent succeeds", async () => {
      const stripe = new FakeStripe();
      const ready = await readyCheckout(stripe, [{ productId: ids.tshirt, quantity: 1 }]);

      stripe.decline(ready.paymentIntentId);
      await handleStripeEvent(eventFor({ id: ready.paymentIntentId }, "payment_intent.payment_failed"), { backend, gateway: stripe });
      expect((await getOrder(ready.order.id)).status).toBe("pending");
      expect((await orderNotes(ready.order.id)).some((n) => n.includes("card_declined"))).toBe(true);
      expect((await getProduct(ids.tshirt)).stock_quantity).toBe(25);

      stripe.succeed(ready.paymentIntentId);
      await handleStripeEvent(eventFor({ id: ready.paymentIntentId }, "payment_intent.succeeded"), { backend, gateway: stripe });
      expect((await getOrder(ready.order.id)).status).toBe("processing");
      expect((await getProduct(ids.tshirt)).stock_quantity).toBe(24);
    });

    it("cancelled payment cancels the order and releases the stock hold", async () => {
      const stripe = new FakeStripe();
      const ready = await readyCheckout(stripe, [{ productId: ids.tote, quantity: 1 }]);

      // The only tote is held: nobody else can buy it.
      const other = await startCheckout(await requestFor([{ productId: ids.tote, quantity: 1 }]), { checkoutId: newCheckoutId() }, { backend, gateway: stripe });
      expect(["out_of_stock", "cart_invalid"]).toContain(other.type);

      await stripe.cancelIfPossible(ready.paymentIntentId);
      await handleStripeEvent(eventFor({ id: ready.paymentIntentId }, "payment_intent.canceled"), { backend, gateway: stripe });
      expect((await getOrder(ready.order.id)).status).toBe("cancelled");
      expect((await getProduct(ids.tote)).stock_quantity).toBe(1);

      // Released: another customer can buy it now.
      await expect(readyCheckout(stripe, [{ productId: ids.tote, quantity: 1 }])).resolves.toMatchObject({ type: "ready" });
    });

    it("asynchronous payment: processing holds stock, failure restores it", async () => {
      const stripe = new FakeStripe();
      const ready = await readyCheckout(stripe, [{ productId: ids.hat, quantity: 2 }]);

      stripe.process(ready.paymentIntentId);
      await handleStripeEvent(eventFor({ id: ready.paymentIntentId }, "payment_intent.processing"), { backend, gateway: stripe });
      expect((await getOrder(ready.order.id)).status).toBe("on-hold");
      expect((await getProduct(ids.hat)).stock_quantity).toBe(8);

      stripe.decline(ready.paymentIntentId);
      await handleStripeEvent(eventFor({ id: ready.paymentIntentId }, "payment_intent.payment_failed"), { backend, gateway: stripe });
      expect((await getOrder(ready.order.id)).status).toBe("cancelled");
      expect((await getProduct(ids.hat)).stock_quantity).toBe(10);
    });

    it("product sold out during checkout: no order is left payable", async () => {
      const stripe = new FakeStripe();
      const request = await requestFor([{ productId: ids.hat, quantity: 1 }]);
      await updateProduct(ids.hat, { stock_quantity: 0 });

      const outcome = await startCheckout(request, { checkoutId: newCheckoutId() }, { backend, gateway: stripe });
      expect(["out_of_stock", "cart_invalid"]).toContain(outcome.type);
      expect(stripe.calls.create).toBe(0);
    });

    it("concurrent purchase of the last item: exactly one customer gets it", async () => {
      const stripe = new FakeStripe();
      const request = await requestFor([{ productId: ids.tote, quantity: 1 }]);

      const outcomes = await Promise.all(
        Array.from({ length: 4 }, () => startCheckout(request, { checkoutId: newCheckoutId() }, { backend, gateway: stripe })),
      );
      const ready = outcomes.filter((o) => o.type === "ready");
      expect(ready).toHaveLength(1);
      expect(outcomes.filter((o) => o.type === "out_of_stock" || o.type === "cart_invalid")).toHaveLength(3);

      const winner = ready[0]!;
      if (winner.type !== "ready") throw new Error("unreachable");
      stripe.succeed(winner.paymentIntentId);
      await handleStripeEvent(eventFor({ id: winner.paymentIntentId }, "payment_intent.succeeded"), { backend, gateway: stripe });
      const tote = await getProduct(ids.tote);
      expect(tote.stock_quantity).toBe(0);
      expect(tote.stock_status).toBe("outofstock");
    });

    it("price changed during checkout: customer must confirm the new total", async () => {
      const stripe = new FakeStripe();
      const request = await requestFor([{ productId: ids.tshirt, quantity: 1 }]);
      await updateProduct(ids.tshirt, { regular_price: "279" });

      const changed = await startCheckout(request, { checkoutId: newCheckoutId() }, { backend, gateway: stripe });
      expect(changed.type).toBe("total_changed");
      if (changed.type !== "total_changed") return;
      expect(changed.quote.totals.total).toBe("328.00");
      expect(stripe.calls.create).toBe(0);

      const confirmed = await startCheckout({ ...request, expectedTotal: changed.quote.totals.total }, { checkoutId: newCheckoutId() }, { backend, gateway: stripe });
      expect(confirmed.type).toBe("ready");
      if (confirmed.type === "ready") expect((await stripe.retrieve(confirmed.paymentIntentId)).amount).toBe(32800);
    });

    it("never accepts a payment whose amount differs from the order total", async () => {
      const stripe = new FakeStripe();
      const ready = await readyCheckout(stripe, [{ productId: ids.tshirt, quantity: 1 }]);

      const result = await sendPaymentEvent(ready.order.id, ready.order.key, {
        event: "succeeded",
        payment_intent_id: ready.paymentIntentId,
        amount_minor: 100,
        currency: "dkk",
        currency_exponent: 2,
      });
      expect(result).toMatchObject({ status: 409, body: { code: "amount_mismatch" } });
      expect((await getOrder(ready.order.id)).status).toBe("pending");
    });

    it("rejects payment updates with a wrong order key", async () => {
      const stripe = new FakeStripe();
      const ready = await readyCheckout(stripe, [{ productId: ids.tshirt, quantity: 1 }]);
      const result = await sendPaymentEvent(ready.order.id, "wc_order_forged", {
        event: "succeeded",
        payment_intent_id: ready.paymentIntentId,
        amount_minor: 29800,
        currency: "dkk",
        currency_exponent: 2,
      });
      expect(result.status).toBe(404);
      expect((await getOrder(ready.order.id)).status).toBe("pending");
    });

    it("payment arriving after the order was cancelled and the item sold: refunded automatically", async () => {
      const stripe = new FakeStripe();
      const ready = await readyCheckout(stripe, [{ productId: ids.tote, quantity: 1 }]);
      // Hold expired → WooCommerce cancelled the order → someone else bought the last tote.
      await cancelOpenOrders();
      await updateProduct(ids.tote, { stock_quantity: 0 });

      stripe.succeed(ready.paymentIntentId);
      const result = await handleStripeEvent(eventFor({ id: ready.paymentIntentId }, "payment_intent.succeeded"), { backend, gateway: stripe });
      expect(result.outcome?.type).toBe("refunded");
      expect(stripe.refunds).toEqual([{ paymentIntentId: ready.paymentIntentId, idempotencyKey: `wchc-refund:${ready.paymentIntentId}` }]);
      expect((await getOrder(ready.order.id)).status).toBe("cancelled");
      expect((await getProduct(ids.tote)).stock_quantity).toBe(0);
    });

    it("payment arriving after the stock hold expired and the item was sold: refunded, never oversold", async () => {
      const stripe = new FakeStripe();
      const ready = await readyCheckout(stripe, [{ productId: ids.tote, quantity: 1 }]);
      // The hold expired while the order is still pending, and the last tote was sold elsewhere.
      await expireStockHolds();
      await updateProduct(ids.tote, { stock_quantity: 0 });

      stripe.succeed(ready.paymentIntentId);
      const result = await handleStripeEvent(eventFor({ id: ready.paymentIntentId }, "payment_intent.succeeded"), { backend, gateway: stripe });
      expect(result.outcome?.type).toBe("refunded");
      expect((await getOrder(ready.order.id)).status).toBe("cancelled");
      expect((await getProduct(ids.tote)).stock_quantity).toBe(0);
    });

    it("ignores webhooks for payments that belong to another shop", async () => {
      const stripe = new FakeStripe();
      const ready = await readyCheckout(stripe, [{ productId: ids.tshirt, quantity: 1 }]);
      const pi = stripe.intents.get(ready.paymentIntentId)!;
      pi.metadata.store_id = "nuttetbaby-dk";
      stripe.succeed(pi.id);

      const result = await handleStripeEvent(eventFor(pi, "payment_intent.succeeded"), { backend, gateway: stripe });
      expect(result.outcome).toEqual({ type: "ignored", reason: "other_store" });
      expect((await getOrder(ready.order.id)).status).toBe("pending");
    });
  });
});
