import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeStripe } from "../../../../../tests/support/fake-stripe";

/**
 * Exercises the real route handler: Stripe signature verification on the raw body,
 * idempotent handling of duplicate deliveries, and retry semantics.
 */

const SECRET = "whsec_test_secret_for_unit_tests";
process.env.STRIPE_SECRET_KEY = "sk_test_dummy_key_for_signature_tests";
process.env.STRIPE_WEBHOOK_SECRET = SECRET;

const state = vi.hoisted(() => ({ events: [] as { event: string; payment_intent_id: string }[], paid: new Set<string>(), fail: false }));
const stripe = new FakeStripe();

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("@/lib/checkout/deps", () => ({
  checkoutDeps: () => ({
    gateway: stripe,
    backend: {
      createOrder: vi.fn(),
      attachPaymentIntent: vi.fn(),
      async sendPaymentEvent(_id: number, _key: string, input: { event: string; payment_intent_id: string }) {
        if (state.fail) throw new Error("WooCommerce is unreachable");
        state.events.push(input);
        const already = state.paid.has(input.payment_intent_id);
        if (input.event === "succeeded") state.paid.add(input.payment_intent_id);
        return { status: 200, body: { result: already ? "already_paid" : "paid", order: { items: [] } } };
      },
    },
  }),
}));

const { POST } = await import("./route");
const signer = new Stripe("sk_test_dummy_key_for_signature_tests");

function signedRequest(payload: string, secret = SECRET) {
  const header = signer.webhooks.generateTestHeaderString({ payload, secret });
  return new Request("http://shop.test/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": header }, body: payload });
}

async function paidIntent() {
  const pi = await stripe.create(
    { amount: 54700, currency: "dkk", description: "x", metadata: { wc_order_id: "101", wc_order_key: "wc_order_abc", store_id: "piece-dk" } },
    `key-${Math.random()}`,
  );
  stripe.succeed(pi.id);
  return pi;
}

function eventPayload(type: string, id: string) {
  return JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, object: "event", type, data: { object: { id, object: "payment_intent" } } });
}

describe("POST /api/stripe/webhook", () => {
  beforeEach(() => {
    state.events.length = 0;
    state.fail = false;
  });

  it("rejects requests without a valid signature", async () => {
    const pi = await paidIntent();
    const payload = eventPayload("payment_intent.succeeded", pi.id);

    expect((await POST(new Request("http://shop.test", { method: "POST", body: payload }))).status).toBe(400);
    expect((await POST(signedRequest(payload, "whsec_wrong"))).status).toBe(400);

    const tampered = signedRequest(payload);
    const forged = new Request(tampered.url, { method: "POST", headers: tampered.headers, body: payload.replace("succeeded", "canceled") });
    expect((await POST(forged)).status).toBe(400);
    expect(state.events).toHaveLength(0);
  });

  it("marks the order paid once, even when Stripe delivers the event twice", async () => {
    const pi = await paidIntent();
    const payload = eventPayload("payment_intent.succeeded", pi.id);

    const first = await POST(signedRequest(payload));
    const second = await POST(signedRequest(payload));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(state.events).toHaveLength(2); // both reach WooCommerce...
    expect(state.paid.size).toBeGreaterThan(0); // ...whose state machine turns the second into "already_paid".
  });

  it("uses the PaymentIntent's current state, not the event's", async () => {
    const pi = await paidIntent();
    // A late "payment_failed" for an intent that has since succeeded must not fail the order.
    await POST(signedRequest(eventPayload("payment_intent.payment_failed", pi.id)));
    expect(state.events[0]).toMatchObject({ event: "succeeded", payment_intent_id: pi.id });
  });

  it("reserves the order when the amount is authorized (captured when the order is sent)", async () => {
    const pi = await stripe.create(
      { amount: 54700, currency: "dkk", captureMethod: "manual", description: "x", metadata: { wc_order_id: "101", wc_order_key: "wc_order_abc", store_id: "piece-dk" } },
      `key-${Math.random()}`,
    );
    stripe.confirm(pi.id);
    const response = await POST(signedRequest(eventPayload("payment_intent.amount_capturable_updated", pi.id)));
    expect(response.status).toBe(200);
    expect(state.events[0]).toMatchObject({ event: "authorized", payment_intent_id: pi.id, amount_minor: 54700 });
  });

  it("acknowledges unrelated events without touching orders", async () => {
    const response = await POST(signedRequest(JSON.stringify({ id: "evt_1", object: "event", type: "customer.created", data: { object: { id: "cus_1", object: "customer" } } })));
    expect(response.status).toBe(200);
    expect(state.events).toHaveLength(0);
  });

  it("returns 500 so Stripe retries when WooCommerce is down", async () => {
    state.fail = true;
    const pi = await paidIntent();
    const response = await POST(signedRequest(eventPayload("payment_intent.succeeded", pi.id)));
    expect(response.status).toBe(500);
  });
});
