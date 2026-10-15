/**
 * End-to-end order & payment tests against a real WooCommerce (local Docker, see
 * scripts/local-woocommerce/setup.sh) with the Headless Checkout Bridge plugin.
 * Stripe is replaced by an in-memory fake with the same contract.
 *
 *   ./scripts/local-woocommerce/setup.sh && npm run test:integration
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventFor, FakeStripe } from "../support/fake-stripe";
import {
  backdateOrder,
  cancelOpenOrders,
  createCoupon,
  deleteCoupon,
  expireStockHolds,
  getCoupon,
  getShippingMethod,
  getOrder,
  getProduct,
  orderNotes,
  plugin,
  pluginStatus,
  productBySku,
  runUnpaidOrderCleanup,
  updateProduct,
  updateShippingMethod,
  wpEval,
  configureLocalWooEnv,
  variationBySku,
} from "../support/woo-admin";
import type { CheckoutRequest } from "@/lib/validation/checkout";
import { storeBranding } from "@/lib/checkout/branding";
import { INFO_PAGES } from "@/content/info-pages";

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

const customerEmail = "integration@example.com";

// These tests run as the default store ("piece-dk"), which is not a webshop in the local
// WooCommerce, so it sells every product (webshops are tested in webshops.test.ts).
const storeId = "piece-dk";

/** Quote as the storefront requests it; `checkoutId` identifies the session's own pending order. */
async function quoteFor(lines: Line[], rateMethod = "flat_rate", coupons: string[] = [], email = customerEmail, checkoutId?: string) {
  const items = lines.map((l) => ({ product_id: l.productId, variation_id: l.variationId ?? 0, quantity: l.quantity }));
  const where = { country: "DK", postcode: address.postcode, city: address.city };
  const first = await fetchQuote({ store_id: storeId, items, address: where, coupons, email, checkout_id: checkoutId });
  const rate = first.shipping_rates.find((r) => r.method_id === rateMethod) ?? first.shipping_rates[0];
  return fetchQuote({ store_id: storeId, items, address: where, shipping_rate_id: rate?.id ?? null, coupons, email, checkout_id: checkoutId });
}

async function requestFor(lines: Line[], rateMethod = "flat_rate", coupons: string[] = [], checkoutId?: string): Promise<CheckoutRequest> {
  const quote = await quoteFor(lines, rateMethod, coupons, customerEmail, checkoutId);
  return {
    items: lines.map((l) => ({ productId: l.productId, variationId: l.variationId ?? 0, quantity: l.quantity })),
    contact: { email: customerEmail, phone: "12345678" },
    shipping: address,
    billingSameAsShipping: true,
    shippingRateId: quote.shipping_rate_id,
    expectedTotal: quote.totals.total,
    customerNote: "",
    coupons,
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

    it('makes a flat rate free from its "Fri fragt fra" amount, after discounts', async () => {
      // Typed with the shop's decimal comma, as in the admin; 2 × 249 = 498 reaches it exactly.
      const method = await updateShippingMethod(1, { wchc_free_from: "498,00" });
      expect(method.settings.wchc_free_from).toMatchObject({ label: "Fri fragt fra", type: "price" });
      const discount = await createCoupon({ code: `fragt${Date.now().toString(36)}`, discount_type: "percent", amount: "10" });
      try {
        const two = [{ productId: ids.tshirt, quantity: 2 }];
        const free = await quoteFor(two);
        expect(free.shipping_rates.find((r) => r.id === free.shipping_rate_id)).toMatchObject({ method_id: "flat_rate", cost: "0.00", tax: "0.00" });
        expect(free.totals).toMatchObject({ shipping: "0.00", shipping_tax: "0.00", total: "498.00" });

        expect((await quoteFor([{ productId: ids.tshirt, quantity: 1 }])).totals).toMatchObject({ shipping: "39.20", shipping_tax: "9.80" });
        // 10 % off takes the goods to 448.20, below the amount, so the shipping price is back.
        expect((await quoteFor(two, "flat_rate", [discount.code])).totals).toMatchObject({ shipping: "39.20", total: "497.20" });

        // The order and the payment get the free shipping the customer saw.
        const stripe = new FakeStripe();
        const { order, paymentIntentId } = await readyCheckout(stripe, two);
        expect(await getOrder(order.id)).toMatchObject({ shipping_total: "0.00", shipping_tax: "0.00", total: "498.00" });
        expect((await stripe.retrieve(paymentIntentId)).amount).toBe(49800);
      } finally {
        await updateShippingMethod(1, { wchc_free_from: "" });
        await deleteCoupon(discount.id);
      }
    });

    it('gives flat rates saved without "Fri fragt fra" the setting, so the REST API does not warn', async () => {
      // WooCommerce's REST API reads each saved setting directly: a missing one is null plus a PHP warning.
      const seeded = "['title' => 'GLS Pakkeshop', 'tax_status' => 'taxable', 'cost' => '39.20']";
      // Saved before plugin 1.3 (past the plugin's filter); the first request after a plugin update adds it.
      await wpEval(`remove_all_filters('pre_update_option'); update_option('woocommerce_flat_rate_1_settings', ${seeded}); delete_option('wchc_shipping_settings_version');`);
      expect((await getShippingMethod(1)).settings.wchc_free_from.value).toBe("");
      // Saved later by code that does not know the setting.
      await wpEval(`update_option('woocommerce_flat_rate_1_settings', ${seeded});`);
      expect((await getShippingMethod(1)).settings.wchc_free_from.value).toBe("");
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

  describe("coupons", () => {
    const created: number[] = [];
    async function coupon(data: Record<string, unknown>) {
      const c = await createCoupon({ code: `it${Date.now().toString(36)}${created.length}`, discount_type: "percent", amount: "10", ...data });
      created.push(c.id);
      return c;
    }
    afterAll(async () => {
      for (const id of created) await deleteCoupon(id).catch(() => undefined);
    });

    it("applies a WooCommerce coupon to the quote, the order and the payment", async () => {
      const { id, code } = await coupon({});
      const quote = await quoteFor([{ productId: ids.tshirt, quantity: 1 }], "flat_rate", [code.toUpperCase()]);
      // 249 incl. VAT, 10 % off = 24.90 (19.92 + 4.98 VAT); + GLS 49 = 273.10
      expect(quote.coupons).toEqual([{ code, discount: "19.92", discount_tax: "4.98" }]);
      expect(quote.coupon_errors).toEqual([]);
      expect(quote.totals).toMatchObject({ discount: "19.92", discount_tax: "4.98", total: "273.10" });

      const stripe = new FakeStripe();
      const outcome = await startCheckout(await requestFor([{ productId: ids.tshirt, quantity: 1 }], "flat_rate", [code]), { checkoutId: newCheckoutId() }, { backend, gateway: stripe });
      if (outcome.type !== "ready") throw new Error(`Expected ready, got ${outcome.type}`);
      expect((await stripe.retrieve(outcome.paymentIntentId)).amount).toBe(27310);
      const order = await getOrder(outcome.order.id);
      expect(order.total).toBe("273.10");
      expect(order.coupon_lines.map((c) => c.code)).toEqual([code]);

      stripe.succeed(outcome.paymentIntentId);
      await handleStripeEvent(eventFor({ id: outcome.paymentIntentId }, "payment_intent.succeeded"), { backend, gateway: stripe });
      expect((await getOrder(outcome.order.id)).status).toBe("processing");
      expect((await getCoupon(id)).usage_count).toBe(1);
    });

    it("reports unknown and inapplicable coupons with WooCommerce's reason, without blocking the cart", async () => {
      const { code: tooBig } = await coupon({ minimum_amount: "1000" });
      const quote = await quoteFor([{ productId: ids.tshirt, quantity: 1 }], "flat_rate", ["findes-ikke-123", tooBig]);
      expect(quote.errors).toEqual([]);
      expect(quote.coupons).toEqual([]);
      expect(quote.coupon_errors.map((e) => e.code)).toEqual(["findes-ikke-123", tooBig]);
      expect(quote.coupon_errors.every((e) => e.message.length > 0)).toBe(true);
      expect(quote.totals.total).toBe("298.00");

      // Paying with a rejected code is refused, never charged without the customer seeing the total.
      const stripe = new FakeStripe();
      const request = { ...(await requestFor([{ productId: ids.tshirt, quantity: 1 }])), coupons: ["findes-ikke-123"] };
      const outcome = await startCheckout(request, { checkoutId: newCheckoutId() }, { backend, gateway: stripe });
      expect(outcome.type).toBe("coupon_invalid");
      expect(stripe.calls.create).toBe(0);
    });

    it("checks e-mail restricted coupons against the customer's e-mail", async () => {
      const { code } = await coupon({ email_restrictions: ["vip@example.com"] });
      const lines = [{ productId: ids.tshirt, quantity: 1 }];
      expect((await quoteFor(lines, "flat_rate", [code], "vip@example.com")).coupons.map((c) => c.code)).toEqual([code]);
      expect((await quoteFor(lines, "flat_rate", [code], "anden@example.com")).coupon_errors.map((e) => e.code)).toEqual([code]);

      const stripe = new FakeStripe();
      const vip = await requestFor(lines, "flat_rate", []);
      const withCode = { ...vip, coupons: [code], expectedTotal: "273.10" };
      const refused = await startCheckout(withCode, { checkoutId: newCheckoutId() }, { backend, gateway: stripe });
      expect(refused.type).toBe("coupon_invalid");
      const allowed = await startCheckout({ ...withCode, contact: { ...withCode.contact, email: "vip@example.com" } }, { checkoutId: newCheckoutId() }, { backend, gateway: stripe });
      expect(allowed.type).toBe("ready");
    });

    it("single-use coupon: the customer can retry after a decline, nobody else can use it meanwhile", async () => {
      const { id, code } = await coupon({ usage_limit: 1 });
      const stripe = new FakeStripe();
      const checkoutId = newCheckoutId();
      const lines = [{ productId: ids.tshirt, quantity: 1 }];
      const request = await requestFor(lines, "flat_rate", [code]);

      const first = await startCheckout(request, { checkoutId }, { backend, gateway: stripe });
      if (first.type !== "ready") throw new Error(`Expected ready, got ${first.type}`);
      stripe.decline(first.paymentIntentId);
      await handleStripeEvent(eventFor({ id: first.paymentIntentId }, "payment_intent.payment_failed"), { backend, gateway: stripe });

      // The same session still gets the discount (its own hold does not count) ...
      const own = await quoteFor(lines, "flat_rate", [code], customerEmail, checkoutId);
      expect(own.coupons.map((c) => c.code)).toEqual([code]);
      expect(own.totals.total).toBe(request.expectedTotal);
      const retry = await startCheckout(request, { checkoutId }, { backend, gateway: stripe });
      expect(retry).toMatchObject({ type: "ready", order: { id: first.order.id }, paymentIntentId: first.paymentIntentId });

      // ... and also after changing the cart (the order is rebuilt and the coupon held again).
      const bigger = await requestFor([{ productId: ids.tshirt, quantity: 2 }], "flat_rate", [code], checkoutId);
      const resumed = await startCheckout(bigger, { checkoutId }, { backend, gateway: stripe });
      expect(resumed).toMatchObject({ type: "ready", order: { id: first.order.id } });

      // Another customer cannot use the held coupon.
      const other = await quoteFor(lines, "flat_rate", [code], "anden@example.com");
      expect(other.coupon_errors.map((e) => e.code)).toEqual([code]);
      const otherOutcome = await startCheckout({ ...request, contact: { ...request.contact, email: "anden@example.com" } }, { checkoutId: newCheckoutId() }, { backend, gateway: stripe });
      expect(otherOutcome.type).toBe("coupon_invalid");

      if (resumed.type !== "ready") throw new Error("unreachable");
      stripe.succeed(resumed.paymentIntentId);
      await handleStripeEvent(eventFor({ id: resumed.paymentIntentId }, "payment_intent.succeeded"), { backend, gateway: stripe });
      expect((await getOrder(first.order.id)).status).toBe("processing");
      expect((await getCoupon(id)).usage_count).toBe(1);
    });
  });

  describe("unpaid orders", () => {
    it("an unpaid order older than the hold time is not resumed: a new order replaces it", async () => {
      const stripe = new FakeStripe();
      const checkoutId = newCheckoutId();
      const request = await requestFor([{ productId: ids.tote, quantity: 1 }]);
      const old = await startCheckout(request, { checkoutId }, { backend, gateway: stripe });
      if (old.type !== "ready") throw new Error(`Expected ready, got ${old.type}`);
      await backdateOrder(old.order.id, 61);

      // The customer comes back an hour later and pays: the only tote is not blocked by their own old order.
      const fresh = await startCheckout(request, { checkoutId }, { backend, gateway: stripe });
      if (fresh.type !== "ready") throw new Error(`Expected ready, got ${fresh.type}`);
      expect(fresh.order.id).not.toBe(old.order.id);
      expect(fresh.paymentIntentId).not.toBe(old.paymentIntentId);

      expect((await getOrder(old.order.id)).status).toBe("cancelled");
      expect((await orderNotes(old.order.id)).some((n) => n.includes("startede en ny betaling"))).toBe(true);
      expect((await stripe.retrieve(old.paymentIntentId)).status).toBe("canceled");
      expect((await getOrder(fresh.order.id)).status).toBe("pending");
    });

    it("the plugin cancels abandoned unpaid orders and releases their stock; recent ones are kept", async () => {
      const stripe = new FakeStripe();
      const abandoned = await readyCheckout(stripe, [{ productId: ids.tote, quantity: 1 }]);
      const recent = await readyCheckout(stripe, [{ productId: ids.tshirt, quantity: 1 }]);
      await backdateOrder(abandoned.order.id, 61);

      expect(await runUnpaidOrderCleanup()).toBeGreaterThanOrEqual(1);
      expect((await getOrder(abandoned.order.id)).status).toBe("cancelled");
      expect((await orderNotes(abandoned.order.id)).some((n) => n.includes("ikke betalt inden for 60 minutter"))).toBe(true);
      expect((await getOrder(recent.order.id)).status).toBe("pending");

      // The tote is available again.
      await expect(readyCheckout(stripe, [{ productId: ids.tote, quantity: 1 }])).resolves.toMatchObject({ type: "ready" });

      const status = await pluginStatus();
      expect(status).toMatchObject({ version: "1.4.0", coupons_enabled: true, unpaid_orders: { cancel_after_minutes: 60 } });
      expect((status.unpaid_orders as { last_cleanup: string | null }).last_cleanup).not.toBeNull();
    });
  });

  describe("payment details on the order", () => {
    it("records the payment method the customer actually used", async () => {
      const stripe = new FakeStripe();
      const card = await readyCheckout(stripe, [{ productId: ids.tshirt, quantity: 1 }]);
      expect((await getOrder(card.order.id)).payment_method_title).toBe("Stripe");
      stripe.succeed(card.paymentIntentId, { type: "mobilepay" });
      await handleStripeEvent(eventFor({ id: card.paymentIntentId }, "payment_intent.succeeded"), { backend, gateway: stripe });
      expect((await getOrder(card.order.id)).payment_method_title).toBe("MobilePay (Stripe)");

      const pending = await readyCheckout(stripe, [{ productId: ids.hat, quantity: 1 }]);
      stripe.process(pending.paymentIntentId, { type: "card", card: { brand: "visa", wallet: "apple_pay" } });
      await handleStripeEvent(eventFor({ id: pending.paymentIntentId }, "payment_intent.processing"), { backend, gateway: stripe });
      expect(await getOrder(pending.order.id)).toMatchObject({ status: "on-hold", payment_method_title: "Apple Pay (Stripe)" });
    });

    it("notes a declined attempt once, however often it is reported", async () => {
      const stripe = new FakeStripe();
      const ready = await readyCheckout(stripe, [{ productId: ids.tshirt, quantity: 1 }]);
      const declinedNotes = async () => (await orderNotes(ready.order.id)).filter((n) => n.includes("Betalingsforsøg afvist")).length;

      stripe.decline(ready.paymentIntentId);
      const event = eventFor({ id: ready.paymentIntentId }, "payment_intent.payment_failed");
      await handleStripeEvent(event, { backend, gateway: stripe });
      await handleStripeEvent(event, { backend, gateway: stripe });
      await finalizePayment(await stripe.retrieve(ready.paymentIntentId), { backend, gateway: stripe });
      expect(await declinedNotes()).toBe(1);

      // A new attempt that is declined again is a new note.
      stripe.decline(ready.paymentIntentId);
      await handleStripeEvent(eventFor({ id: ready.paymentIntentId }, "payment_intent.payment_failed"), { backend, gateway: stripe });
      expect(await declinedNotes()).toBe(2);
    });
  });

  describe("order e-mails in the webshop's name", () => {
    const brand = {
      name: "Halloweenkostumer.dk",
      url: "https://halloweenkostumer.example",
      email: "kundeservice@halloweenkostumer.example",
      color: "#5b2b82",
      logo: "https://halloweenkostumer.example/email-logo.png",
    };
    // The seller and return rules the storefront sends for the withdrawal information (src/config/company.ts).
    const seller = {
      company_name: "Kostumer ApS",
      company_address: "Testvej 1, 8000 Aarhus C",
      cvr: "12345678",
      return_address: "Kostumer ApS, Returvej 2, 8000 Aarhus C",
      return_shipping: "Du betaler selv returfragten.",
      return_days: 30,
    };
    // The WordPress site's own e-mail design, which orders without a brand keep.
    const siteLogo = "https://wp.example/site-logo.png";
    const siteColor = "#123456";

    /** A pending order created as a storefront does, sending `store` as given (or none, as before plugin 1.4). */
    async function orderWithStore(store?: unknown): Promise<number> {
      const quote = await quoteFor([{ productId: ids.tshirt, quantity: 1 }]);
      const person = { first_name: "Test", last_name: "Kunde", address_1: address.address1, postcode: address.postcode, city: address.city, country: "DK" };
      const { status, body } = await plugin("orders", {
        method: "POST",
        body: {
          checkout_id: newCheckoutId(),
          store_id: storeId,
          items: [{ product_id: ids.tshirt, variation_id: 0, quantity: 1 }],
          billing: { ...person, email: customerEmail },
          shipping: person,
          shipping_rate_id: quote.shipping_rate_id,
          expected_total: quote.totals.total,
          payment_method_title: "Stripe",
          coupons: [],
          ...(store === undefined ? {} : { store }),
        },
      });
      expect(status).toBe(201);
      return (body as { order: { id: number } }).order.id;
    }

    async function storedBrand(orderId: number) {
      return (await getOrder(orderId)).meta_data.find((m) => m.key === "_wchc_store_branding")?.value;
    }

    type Mail = { order: number; to: string; subject: string; message: string; headers: string; from_name: string; from_email: string };

    /**
     * Send the customer's "Processing order", the shop's "New order" and the customer's "Order
     * on-hold" e-mail for each order, as a payment does, and capture them instead of mailing them
     * (pre_wp_mail). The texts use the placeholders, and the site has its own header image and
     * base colour. `plain` sends the customer's e-mails as plain text.
     */
    async function sendOrderEmails(orderIds: number[], { plain = false } = {}) {
      const out = await wpEval(`
        $mails = array();
        $order = 0;
        add_filter( 'pre_wp_mail', function ( $short, $atts ) use ( &$mails, &$order ) {
          $mails[] = array_merge( $atts, array( 'order' => $order, 'from_name' => apply_filters( 'wp_mail_from_name', 'WordPress' ), 'from_email' => apply_filters( 'wp_mail_from', 'wordpress@localhost' ) ) );
          return true;
        }, 10, 2 );
        // After the plugin's own filters.
        add_filter( 'pre_option_woocommerce_email_header_image', function ( $pre ) { return false === $pre ? '${siteLogo}' : $pre; }, 20 );
        add_filter( 'pre_option_woocommerce_email_base_color', function ( $pre ) { return false === $pre ? '${siteColor}' : $pre; }, 20 );
        add_filter( 'pre_option_woocommerce_email_footer_text', function () { return 'Hilsen {site_title}, {site_url}, {store_url}'; } );
        $emails     = WC()->mailer()->get_emails();
        $processing = $emails['WC_Email_Customer_Processing_Order'];
        $new_order  = $emails['WC_Email_New_Order'];
        $on_hold    = $emails['WC_Email_Customer_On_Hold_Order'];
        $processing->settings['heading']            = 'Tak for din ordre hos {site_title}';
        $processing->settings['additional_content'] = 'Se {store_url} eller skriv til {store_email}';
        $new_order->settings['subject']             = 'Ny ordre #{order_number}';
        if ( ${plain ? "true" : "false"} ) {
          $processing->email_type = 'plain';
          $on_hold->email_type    = 'plain';
        }
        $site = array( 'from_name' => $processing->get_from_name(), 'from_email' => $processing->get_from_address(), 'blogname' => get_option( 'blogname' ), 'host' => wp_parse_url( home_url(), PHP_URL_HOST ) );
        foreach ( array( ${orderIds.map((id) => Math.trunc(id)).join(", ")} ) as $order ) {
          $processing->trigger( $order );
          $new_order->trigger( $order );
          $on_hold->trigger( $order );
        }
        echo "\\n@@" . wp_json_encode( array( 'site' => $site, 'mails' => $mails ) );
      `);
      const { site, mails } = JSON.parse(out.slice(out.lastIndexOf("@@") + 2)) as {
        site: { from_name: string; from_email: string; blogname: string; host: string };
        mails: Mail[];
      };
      const forOrder = (id: number) => {
        const [customer, shop, onHold] = mails.filter((m) => m.order === id);
        if (!customer || !shop || !onHold) throw new Error(`No e-mails for order ${id}`);
        return { customer, shop, onHold };
      };
      return { site, forOrder };
    }

    const replyTo = (headers: string) => headers.split(/\r?\n/).filter((line) => /^reply-to:/i.test(line));

    /** An e-mail's text without markup, on one line (plain-text e-mails are wrapped at 70 characters). */
    const textOf = (message: string) => message.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ");

    /** The standard withdrawal form as the shop's page "Returret og fortrydelse" has it, without its address line. */
    const withdrawalForm = INFO_PAGES.find((page) => page.slug === "fortrydelsesret")!
      .sections.find((section) => section.heading === "Standardfortrydelsesformular")!
      .blocks.flatMap((block) => (block.type === "list" ? block.items : block.type === "p" ? [block.text] : []))
      .filter((line) => !line.includes("{"));

    it("stores the webshop's brand the storefront sends with the order", async () => {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
      process.env.NEXT_PUBLIC_SITE_URL = "https://hverdag.example";
      try {
        const { order } = await readyCheckout(new FakeStripe(), [{ productId: ids.tshirt, quantity: 1 }]);
        expect(await storedBrand(order.id)).toEqual(storeBranding());
        expect(await storedBrand(order.id)).toMatchObject({ url: "https://hverdag.example", logo: "https://hverdag.example/email-logo.png" });
      } finally {
        if (siteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
        else process.env.NEXT_PUBLIC_SITE_URL = siteUrl;
      }
    });

    it("drops invalid brand fields, and the order still works", async () => {
      const invalid = await orderWithStore({
        name: "x".repeat(101),
        url: "javascript:alert(1)",
        email: "ikke-en-adresse",
        color: "red",
        logo: "http://halloweenkostumer.example/email-logo.png", // https only
        company_name: "x".repeat(101),
        company_address: "",
        cvr: 12345678, // text only
        return_shipping: "x".repeat(501),
        return_days: "30", // a number only
      });
      expect(await storedBrand(invalid)).toBeUndefined();
      expect((await getOrder(invalid)).status).toBe("pending");

      const mixed = await orderWithStore({
        name: "<b>Maskerade</b>",
        url: "ftp://maskerade.example",
        email: brand.email,
        color: "#5B2B82",
        logo: brand.logo,
        extra: "x",
        return_address: " <b>Returvej 2</b>, 8000 Aarhus C ",
        return_days: 13, // at least the statutory 14
      });
      expect(await storedBrand(mixed)).toEqual({ name: "Maskerade", email: brand.email, color: "#5B2B82", logo: brand.logo, return_address: "Returvej 2, 8000 Aarhus C" });
      expect(await storedBrand(await orderWithStore({ ...seller, return_days: 366 }))).toEqual({ ...seller, return_days: undefined });

      // 100 characters, not bytes.
      expect(await storedBrand(await orderWithStore({ name: "æ".repeat(100) }))).toEqual({ name: "æ".repeat(100) });
      expect(await storedBrand(await orderWithStore("Maskerade"))).toBeUndefined();
    });

    it("sends the customer's e-mails from the webshop: name, Reply-To, texts, logo and colour", async () => {
      const orderId = await orderWithStore({ ...brand, ...seller });
      expect(await storedBrand(orderId)).toEqual({ ...brand, ...seller });
      const { site, forOrder } = await sendOrderEmails([orderId]);
      const { customer, shop } = forOrder(orderId);

      expect(customer).toMatchObject({ to: customerEmail, from_name: brand.name, from_email: site.from_email });
      expect(replyTo(customer.headers)).toEqual([`Reply-To: ${brand.name} <${brand.email}>`]);
      expect(customer.subject).toContain(brand.name); // "Your {site_title} order has been received!"
      expect(customer.subject).not.toContain(site.blogname);
      expect(customer.message).toContain(`>Tak for din ordre hos ${brand.name}<`);
      // {store_email} is the webshop's e-mail, not the From address all webshops share.
      expect(customer.message).toContain(`Se https://halloweenkostumer.example eller skriv til ${brand.email}`);
      expect(customer.message).not.toContain(site.from_email);
      expect(customer.message).toContain("Hilsen Halloweenkostumer.dk, halloweenkostumer.example, https://halloweenkostumer.example");
      expect(customer.message).toContain(`src="${brand.logo}"`);
      expect(customer.message).toContain(`href="${brand.url}"`);
      expect(customer.message.toLowerCase()).toContain(brand.color);
      expect(customer.message).not.toContain(siteLogo);
      expect(customer.message).not.toContain(siteColor);
      expect(customer.message).not.toContain(site.blogname);

      // The shop's "New order" names the webshop, even without {site_title}; replies still go to the customer.
      expect(shop).toMatchObject({ from_name: brand.name, subject: `[${brand.name}] Ny ordre #${orderId}` });
      expect(replyTo(shop.headers)).toEqual([`Reply-to: Test Kunde <${customerEmail}>`]);
      expect(shop.message).toContain(`src="${brand.logo}"`);
    });

    it("puts the withdrawal information and the standard withdrawal form into the customer's order confirmation", async () => {
      const orderId = await orderWithStore({ ...brand, ...seller });
      const { forOrder } = await sendOrderEmails([orderId]);
      const { customer, shop, onHold } = forOrder(orderId);

      for (const mail of [customer, onHold]) {
        const text = textOf(mail.message);
        expect(text).toContain("Fortrydelsesret og 30 dages returret");
        expect(text).toContain("Som forbruger har du 14 dages fortrydelsesret efter forbrugeraftaleloven. Hos os får du 30 dages returret");
        expect(text).toContain("Fristen regnes fra den dag, du modtager varen.");
        expect(text).toContain(`Giv os besked på ${brand.email}, før fristen udløber. Skriv dit ordrenummer (#${orderId})`);
        expect(text).toContain("Send varen retur senest 14 dage efter, at du har givet besked");
        expect(text).toContain(`Send pakken til: ${seller.return_address}`);
        expect(text).toContain(seller.return_shipping);
        expect(text).toContain("senest 14 dage efter den dag, vi har modtaget din besked");
        expect(text).toContain("Forseglede hygiejnevarer som make-up og ansigtsmaling kan ikke returneres, når forseglingen er brudt.");
        expect(text).toContain(`Sælger: ${seller.company_name} · CVR ${seller.cvr} · ${seller.company_address}`);
        // The whole standard form, addressed to the seller.
        expect(text).toContain("Standardfortrydelsesformular");
        expect(text).toContain(`Til ${seller.company_name}, ${seller.company_address}, ${brand.email}:`);
        expect(withdrawalForm.length).toBe(8);
        for (const line of withdrawalForm) expect(text).toContain(line);
        expect(mail.message).toContain(`<a href="mailto:${brand.email}"`);
      }
      // Not in the e-mail to the shop.
      expect(shop.message).not.toContain("Standardfortrydelsesformular");
    });

    it("sends the withdrawal information in plain-text e-mails too", async () => {
      const orderId = await orderWithStore({ ...brand, ...seller });
      const { forOrder } = await sendOrderEmails([orderId], { plain: true });
      const { customer } = forOrder(orderId);

      expect(customer.message).not.toContain("<");
      expect(customer.message).toContain("FORTRYDELSESRET OG 30 DAGES RETURRET");
      expect(customer.message).toContain("STANDARDFORTRYDELSESFORMULAR");
      const text = textOf(customer.message);
      expect(text).toContain(`Giv os besked på ${brand.email}, før fristen udløber.`);
      expect(text).toContain(`Til ${seller.company_name}, ${seller.company_address}, ${brand.email}:`);
      for (const line of withdrawalForm) expect(text).toContain(line);
    });

    it("leaves out the seller and return details a storefront does not send, and needs the webshop's e-mail", async () => {
      // A brand from a storefront that sends no seller or return rules.
      const older = await orderWithStore(brand);
      const noEmail = await orderWithStore({ name: brand.name, ...seller });
      const { forOrder } = await sendOrderEmails([older, noEmail]);

      const text = textOf(forOrder(older).customer.message);
      expect(text).toContain("Som forbruger har du 14 dages fortrydelsesret efter forbrugeraftaleloven. Fristen regnes");
      expect(text).not.toContain("dages returret");
      expect(text).toContain(`Til ${brand.name}, ${brand.email}:`);
      for (const line of withdrawalForm) expect(text).toContain(line);
      expect(text).not.toContain("Send pakken til:");
      expect(text).not.toContain("Sælger:");

      // Without the e-mail the customer would give notice to, nothing is added.
      expect(forOrder(noEmail).customer.message).not.toContain("Standardfortrydelsesformular");
    });

    it("sends the e-mails of an order without a brand as before, also right after a branded one", async () => {
      const branded = await orderWithStore(brand);
      const plain = await orderWithStore();
      const { site, forOrder } = await sendOrderEmails([branded, plain]);
      const { customer, shop } = forOrder(plain);

      expect(customer).toMatchObject({ to: customerEmail, from_name: site.from_name, from_email: site.from_email });
      expect(replyTo(customer.headers)).toEqual([`Reply-to: ${site.from_name} <${site.from_email}>`]);
      expect(customer.subject).toContain(site.blogname);
      expect(customer.message).toContain(`>Tak for din ordre hos ${site.blogname}<`);
      expect(customer.message).toContain(`Hilsen ${site.blogname}, ${site.host}, {store_url}`);
      expect(customer.message).toContain(`eller skriv til ${site.from_email}`);
      expect(customer.message).not.toContain("Standardfortrydelsesformular");
      expect(customer.message).toContain(`src="${siteLogo}"`);
      expect(customer.message.toLowerCase()).toContain(siteColor);
      for (const value of [brand.name, brand.url, brand.email, brand.color, brand.logo]) {
        expect(customer.message.toLowerCase()).not.toContain(value.toLowerCase());
        expect(shop.message.toLowerCase()).not.toContain(value.toLowerCase());
      }
      expect(shop).toMatchObject({ from_name: site.from_name, subject: `Ny ordre #${plain}` });
    });
  });
});
