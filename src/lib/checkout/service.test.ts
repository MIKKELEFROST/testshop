import { describe, expect, it } from "vitest";
import { FakeStripe } from "../../../tests/support/fake-stripe";
import type { CheckoutRequest } from "@/lib/validation/checkout";
import { storeBranding } from "./branding";
import type { CommerceBackend } from "./service";
import { finalizePayment, paymentEventFor, startCheckout, toCreateOrderInput } from "./service";
import type { PluginResult } from "@/lib/woocommerce/checkout-api";
import type { WcOrderSummary, WcQuote } from "@/lib/woocommerce/schemas";

const request: CheckoutRequest = {
  items: [
    { productId: 10, variationId: 0, quantity: 1 },
    { productId: 10, variationId: 0, quantity: 1 },
  ],
  contact: { email: "kunde@example.com", phone: "" },
  shipping: { firstName: "Test", lastName: "Kunde", company: "", address1: "Testvej 1", address2: "", postcode: "8000", city: "Aarhus C", country: "DK" },
  billingSameAsShipping: true,
  shippingRateId: "flat_rate:1",
  expectedTotal: "547.00",
  customerNote: "",
  coupons: [],
};

function order(overrides: Partial<WcOrderSummary> = {}): WcOrderSummary {
  return {
    id: 101,
    number: "101",
    order_key: "wc_order_abc123",
    status: "pending",
    currency: "DKK",
    total: "547.00",
    total_tax: "109.40",
    shipping_total: "49.00",
    needs_payment: true,
    payment_intent_id: null,
    email: "kunde@example.com",
    items: [{ product_id: 10, variation_id: 0, name: "T-shirt", quantity: 2, total: "498.00" }],
    ...overrides,
  };
}

/** Minimal plugin double: one order, compare-and-set payment intent, scripted createOrder responses. */
function fakeBackend(createResponses: PluginResult[] = []) {
  let current = order();
  const calls = { create: 0, attach: 0, events: [] as unknown[] };
  const backend: CommerceBackend = {
    async createOrder() {
      calls.create += 1;
      return createResponses.shift() ?? { status: 201, body: { result: "created", order: structuredClone(current) } };
    },
    async attachPaymentIntent(_id, _key, intentId, previous) {
      calls.attach += 1;
      if (current.payment_intent_id && current.payment_intent_id !== previous) {
        return { status: 409, body: { code: "payment_intent_exists", payment_intent_id: current.payment_intent_id } };
      }
      current = { ...current, payment_intent_id: intentId };
      return { status: 200, body: { result: "attached", order: structuredClone(current) } };
    },
    async sendPaymentEvent(_id, _key, input) {
      calls.events.push(input);
      return { status: 200, body: { result: input.event === "succeeded" ? "paid" : "noted", order: structuredClone(current) } };
    },
  };
  return {
    backend,
    calls,
    get order() {
      return current;
    },
    set order(value: WcOrderSummary) {
      current = value;
    },
  };
}

const ctx = { checkoutId: "chk_unit_test_0000001" };

describe("startCheckout", () => {
  it("charges exactly the WooCommerce order total, never a client amount", async () => {
    const woo = fakeBackend();
    woo.order = order({ total: "612.50" });
    const stripe = new FakeStripe();

    const outcome = await startCheckout({ ...request, expectedTotal: "1.00" }, ctx, { backend: woo.backend, gateway: stripe });

    expect(outcome.type).toBe("ready");
    const pi = [...stripe.intents.values()][0]!;
    expect(pi.amount).toBe(61250);
    expect(pi.currency).toBe("dkk");
    expect(pi.metadata).toMatchObject({ wc_order_id: "101", wc_order_key: "wc_order_abc123", store_id: "piece-dk" });
  });

  it("names the shop on the card statement and leaves the receipt to WooCommerce", async () => {
    const woo = fakeBackend();
    const stripe = new FakeStripe();
    const outcome = await startCheckout(request, ctx, { backend: woo.backend, gateway: stripe });
    if (outcome.type !== "ready") throw new Error("expected ready");
    const params = stripe.createParams.get(outcome.paymentIntentId)!;
    expect(params.statementDescriptorSuffix).toBe("FASTELAVN");
    expect(params).not.toHaveProperty("receiptEmail");
    expect(JSON.stringify(params)).not.toContain(request.contact.email);
  });

  it("merges duplicate cart lines before sending them to WooCommerce", () => {
    const input = toCreateOrderInput(request, ctx);
    expect(input.items).toEqual([{ product_id: 10, variation_id: 0, quantity: 2 }]);
    expect(input.billing).toMatchObject({ email: "kunde@example.com", postcode: "8000" });
  });

  it("sends the webshop's brand with the order, for WooCommerce's order e-mails", () => {
    expect(toCreateOrderInput(request, ctx).store).toEqual(storeBranding());
  });

  it("reuses the order's PaymentIntent on repeated clicks (no double payment)", async () => {
    const woo = fakeBackend();
    const stripe = new FakeStripe();
    const deps = { backend: woo.backend, gateway: stripe };

    const first = await startCheckout(request, ctx, deps);
    const second = await startCheckout(request, ctx, deps);

    expect(first.type === "ready" && second.type === "ready" && first.paymentIntentId === second.paymentIntentId).toBe(true);
    expect(stripe.calls.create).toBe(1);
  });

  it("updates the amount of an unpaid PaymentIntent when the order total changed", async () => {
    const woo = fakeBackend();
    const stripe = new FakeStripe();
    const deps = { backend: woo.backend, gateway: stripe };
    await startCheckout(request, ctx, deps);

    woo.order = { ...woo.order, total: "596.00" };
    const outcome = await startCheckout(request, ctx, deps);

    expect(outcome.type).toBe("ready");
    expect(stripe.calls.create).toBe(1);
    expect([...stripe.intents.values()][0]!.amount).toBe(59600);
  });

  it("reports an already paid order instead of creating a second payment", async () => {
    const woo = fakeBackend();
    const stripe = new FakeStripe();
    const deps = { backend: woo.backend, gateway: stripe };
    const first = await startCheckout(request, ctx, deps);
    if (first.type !== "ready") throw new Error("expected ready");
    stripe.succeed(first.paymentIntentId);

    const again = await startCheckout(request, ctx, deps);
    expect(again.type).toBe("already_paid");
    expect(stripe.calls.create).toBe(1);
  });

  it("replaces a cancelled PaymentIntent and links it to its predecessor", async () => {
    const woo = fakeBackend();
    const stripe = new FakeStripe();
    const deps = { backend: woo.backend, gateway: stripe };
    const first = await startCheckout(request, ctx, deps);
    if (first.type !== "ready") throw new Error("expected ready");
    await stripe.cancelIfPossible(first.paymentIntentId);

    const second = await startCheckout(request, ctx, deps);
    expect(second.type).toBe("ready");
    if (second.type === "ready") expect(second.paymentIntentId).not.toBe(first.paymentIntentId);
    expect(woo.order.payment_intent_id).not.toBe(first.paymentIntentId);
  });

  it("cancels its own PaymentIntent when a parallel request attached one first", async () => {
    const woo = fakeBackend();
    const stripe = new FakeStripe();
    // The order still shows no PaymentIntent (read before the parallel request attached one).
    const winner = await stripe.create({ amount: 54700, currency: "dkk", metadata: {}, description: "x" }, "winner");
    woo.backend.attachPaymentIntent = async (_id, _key, intentId) =>
      intentId === winner.id
        ? { status: 200, body: { result: "attached" } }
        : { status: 409, body: { code: "payment_intent_exists", payment_intent_id: winner.id } };

    const outcome = await startCheckout(request, ctx, { backend: woo.backend, gateway: stripe });

    expect(outcome.type === "ready" && outcome.paymentIntentId).toBe(winner.id);
    const losers = [...stripe.intents.values()].filter((pi) => pi.id !== winner.id);
    expect(losers.every((pi) => pi.status === "canceled")).toBe(true);
  });

  it("returns WooCommerce's new quote when prices changed", async () => {
    const quote = { totals: { total: "596.00" } } as unknown as WcQuote;
    const woo = fakeBackend([{ status: 409, body: { code: "total_changed", message: "changed", quote } }]);
    const stripe = new FakeStripe();

    const outcome = await startCheckout(request, ctx, { backend: woo.backend, gateway: stripe });
    expect(outcome).toMatchObject({ type: "total_changed", quote });
    expect(stripe.calls.create).toBe(0);
  });

  it("maps stock and validation conflicts without creating payments", async () => {
    const stripe = new FakeStripe();
    for (const code of ["out_of_stock", "cart_invalid", "shipping_rate_unavailable", "busy"]) {
      const woo = fakeBackend([{ status: code === "cart_invalid" || code === "shipping_rate_unavailable" ? 422 : 409, body: { code, message: code } }]);
      const outcome = await startCheckout(request, ctx, { backend: woo.backend, gateway: stripe });
      expect(outcome.type).toBe(code === "shipping_rate_unavailable" ? "cart_invalid" : code);
    }
    expect(stripe.calls.create).toBe(0);
  });

  it("asks for a new checkout session when the session's paid order was for a different cart", async () => {
    const paid = order({ status: "processing", needs_payment: false, items: [{ product_id: 99, variation_id: 0, name: "Andet", quantity: 1, total: "10.00" }] });
    const woo = fakeBackend([{ status: 409, body: { code: "already_paid", order: paid } }]);
    const outcome = await startCheckout(request, ctx, { backend: woo.backend, gateway: new FakeStripe() });
    expect(outcome.type).toBe("new_session_required");

    const same = fakeBackend([{ status: 409, body: { code: "already_paid", order: order({ status: "processing" }) } }]);
    expect((await startCheckout(request, ctx, { backend: same.backend, gateway: new FakeStripe() })).type).toBe("already_paid");
  });

  it("passes coupon codes to WooCommerce and reports a rejected coupon without creating a payment", async () => {
    expect(toCreateOrderInput({ ...request, coupons: ["SOMMER10"] }, ctx).coupons).toEqual(["SOMMER10"]);

    const stripe = new FakeStripe();
    const quote = { totals: { total: "547.00" } } as unknown as WcQuote;
    for (const code of ["coupon_invalid", "coupon_unavailable"]) {
      const woo = fakeBackend([{ status: 409, body: { code, message: "Rabatkoden er brugt.", quote } }]);
      const outcome = await startCheckout({ ...request, coupons: ["SOMMER10"] }, ctx, { backend: woo.backend, gateway: stripe });
      expect(outcome).toMatchObject({ type: "coupon_invalid", message: "Rabatkoden er brugt.", quote });
    }
    expect(stripe.calls.create).toBe(0);
  });

  it("cancels the PaymentIntent of a replaced (expired) order", async () => {
    const stripe = new FakeStripe();
    const old = await stripe.create({ amount: 100, currency: "dkk", metadata: {}, description: "old" }, "old");
    const woo = fakeBackend([{ status: 201, body: { result: "created", order: order({ id: 102 }), previous_payment_intent_id: old.id } }]);
    await startCheckout(request, ctx, { backend: woo.backend, gateway: stripe });
    expect((await stripe.retrieve(old.id)).status).toBe("canceled");

    // Also when the new checkout itself is refused (the old order was cancelled anyway).
    const older = await stripe.create({ amount: 100, currency: "dkk", metadata: {}, description: "older" }, "older");
    const refused = fakeBackend([{ status: 409, body: { code: "total_changed", message: "x", quote: {} as WcQuote, previous_payment_intent_id: older.id } }]);
    await startCheckout(request, ctx, { backend: refused.backend, gateway: stripe });
    expect((await stripe.retrieve(older.id)).status).toBe("canceled");
  });
});

describe("finalizePayment", () => {
  async function paidIntent(stripe: FakeStripe, metadata: Record<string, string>) {
    const pi = await stripe.create({ amount: 54700, currency: "dkk", metadata, description: "x" }, `k-${Math.random()}`);
    stripe.succeed(pi.id);
    return stripe.retrieve(pi.id);
  }
  const meta = { wc_order_id: "101", wc_order_key: "wc_order_abc123", store_id: "piece-dk" };

  it("sends the amount actually received to WooCommerce", async () => {
    const woo = fakeBackend();
    const stripe = new FakeStripe();
    const outcome = await finalizePayment(await paidIntent(stripe, meta), { backend: woo.backend, gateway: stripe });
    expect(outcome).toMatchObject({ type: "applied", result: "paid" });
    expect(woo.calls.events[0]).toMatchObject({ event: "succeeded", amount_minor: 54700, currency: "dkk", currency_exponent: 2 });
  });

  it("tells WooCommerce which payment method the customer used", async () => {
    const woo = fakeBackend();
    const stripe = new FakeStripe();
    const pi = await stripe.create({ amount: 54700, currency: "dkk", metadata: meta, description: "x" }, "mobilepay");
    stripe.succeed(pi.id, { type: "mobilepay" });
    await finalizePayment(await stripe.retrieve(pi.id), { backend: woo.backend, gateway: stripe });
    expect(woo.calls.events[0]).toMatchObject({ event: "succeeded", payment_method_title: "MobilePay (Stripe)" });
  });

  it("identifies each declined attempt so WooCommerce notes it once", async () => {
    const woo = fakeBackend();
    const stripe = new FakeStripe();
    const pi = await stripe.create({ amount: 54700, currency: "dkk", metadata: meta, description: "x" }, "declined");
    stripe.decline(pi.id);
    const first = await stripe.retrieve(pi.id);
    await finalizePayment(first, { backend: woo.backend, gateway: stripe });
    stripe.decline(pi.id);
    await finalizePayment(await stripe.retrieve(pi.id), { backend: woo.backend, gateway: stripe });

    const [a, b] = woo.calls.events as { event: string; message: string; attempt_id: string; payment_method_title?: string }[];
    expect(a).toMatchObject({ event: "failed", message: "card_declined", attempt_id: first.last_payment_error?.charge });
    expect(a!.payment_method_title).toBeUndefined();
    expect(b!.attempt_id).not.toBe(a!.attempt_id);
  });

  it("ignores payments from other shops sharing the Stripe account", async () => {
    const woo = fakeBackend();
    const stripe = new FakeStripe();
    const outcome = await finalizePayment(await paidIntent(stripe, { ...meta, store_id: "nuttetbaby-dk" }), { backend: woo.backend, gateway: stripe });
    expect(outcome).toEqual({ type: "ignored", reason: "other_store" });
    expect(woo.calls.events).toHaveLength(0);
  });

  it("refunds when WooCommerce says the payment cannot be kept", async () => {
    const woo = fakeBackend();
    woo.backend.sendPaymentEvent = async () => ({ status: 200, body: { result: "refund_required" } });
    const stripe = new FakeStripe();
    const pi = await paidIntent(stripe, meta);

    await finalizePayment(pi, { backend: woo.backend, gateway: stripe });
    await finalizePayment(pi, { backend: woo.backend, gateway: stripe });

    expect(stripe.refunds).toEqual([{ paymentIntentId: pi.id, idempotencyKey: `wchc-refund:${pi.id}` }]);
  });

  it("throws (so Stripe retries) when the order is locked", async () => {
    const woo = fakeBackend();
    woo.backend.sendPaymentEvent = async () => ({ status: 409, body: { code: "busy" } });
    const stripe = new FakeStripe();
    await expect(finalizePayment(await paidIntent(stripe, meta), { backend: woo.backend, gateway: stripe })).rejects.toThrow();
  });

  it("maps PaymentIntent states to order events", () => {
    const base = { id: "pi_x", amount: 1, amount_received: 0, currency: "dkk", client_secret: null, metadata: {} };
    expect(paymentEventFor({ ...base, status: "succeeded" })).toBe("succeeded");
    expect(paymentEventFor({ ...base, status: "processing" })).toBe("processing");
    expect(paymentEventFor({ ...base, status: "canceled" })).toBe("canceled");
    expect(paymentEventFor({ ...base, status: "requires_payment_method", last_payment_error: { code: "card_declined" } })).toBe("failed");
    expect(paymentEventFor({ ...base, status: "requires_payment_method" })).toBeNull();
    expect(paymentEventFor({ ...base, status: "requires_action" })).toBeNull();
  });
});
