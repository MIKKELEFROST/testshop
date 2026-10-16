import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeStripe, FakeStripeError } from "../../../tests/support/fake-stripe";
import type { PaymentEventInput } from "@/lib/woocommerce/checkout-api";
import { WooCommerceError } from "@/lib/woocommerce/client";
import type { WcOrderSummary } from "@/lib/woocommerce/schemas";
import { refusal, runSettleSweep, settleAction, settleOrder, settleOrders, settleToken, settleUrl, validSettleToken, type SettleBackend } from "./settle";

const SECRET = "sk_test_settle_unit_secret";
const meta = { wc_order_id: "101", wc_order_key: "wc_order_abc123", store_id: "piece-dk" };

/** An authorized order as the plugin keeps it, with the plugin's answers to the payment events. */
async function setup({ status = "completed", amount = "547.00", piMeta = meta }: { status?: string; amount?: string; piMeta?: Record<string, string> } = {}) {
  const stripe = new FakeStripe();
  const pi = await stripe.create({ amount: 54700, currency: "dkk", captureMethod: "manual", metadata: piMeta, description: "x" }, `k-${Math.random()}`);
  stripe.confirm(pi.id);
  const order: WcOrderSummary = {
    id: 101,
    number: "101",
    order_key: "wc_order_abc123",
    status,
    currency: "DKK",
    total: "547.00",
    total_tax: "109.40",
    shipping_total: "49.00",
    needs_payment: false,
    payment_intent_id: pi.id,
    capture: { status: "authorized", amount, authorized_at: "2026-10-16T08:00:00+00:00", attempt: 0 },
    email: "kunde@example.com",
    items: [],
  };
  const events: PaymentEventInput[] = [];
  const backend: SettleBackend = {
    createOrder: async () => ({ status: 500, body: {} }),
    attachPaymentIntent: async () => ({ status: 500, body: {} }),
    async getOrder(id, key) {
      return id === order.id && key === order.order_key ? structuredClone(order) : null;
    },
    async sendPaymentEvent(_id, _key, input) {
      events.push(input);
      const capture = order.capture!;
      let result = "ignored";
      if (input.event === "succeeded") {
        result = capture.status === "captured" ? "already_paid" : "paid";
        capture.status = "captured";
      } else if (input.event === "canceled" && ["authorized", "failed"].includes(capture.status)) {
        if (order.status === "completed") [order.status, capture.status, result] = ["on-hold", "expired", "capture_failed"];
        else [capture.status, result] = ["released", "released"];
      } else if (input.event === "capture_failed" && order.status === "completed") {
        [order.status, capture.status, result] = ["on-hold", "failed", "capture_failed"];
        capture.attempt += 1;
      }
      return { status: 200, body: { result } };
    },
    async sweepPayments() {
      return { settle: [{ id: order.id, order_key: order.order_key, action: "capture" as const }], warned: [7] };
    },
  };
  return { stripe, pi, order, events, deps: { backend, gateway: stripe } };
}

describe("settle token", () => {
  it("is made from the shop and the order, so a token works for exactly one order of one shop", () => {
    const token = settleToken(SECRET, "piece-dk", 101, "wc_order_abc123");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(validSettleToken(SECRET, "piece-dk", 101, "wc_order_abc123", token)).toBe(true);
    expect(validSettleToken(SECRET, "piece-dk", 102, "wc_order_abc123", token)).toBe(false);
    expect(validSettleToken(SECRET, "piece-dk", 101, "wc_order_other", token)).toBe(false);
    expect(validSettleToken(SECRET, "halloween-kostumer-dk", 101, "wc_order_abc123", token)).toBe(false);
    expect(validSettleToken("sk_test_other", "piece-dk", 101, "wc_order_abc123", token)).toBe(false);
    expect(validSettleToken(SECRET, "piece-dk", 101, "wc_order_abc123", "")).toBe(false);
    expect(validSettleToken(SECRET, "piece-dk", 101, "wc_order_abc123", `${token}x`)).toBe(false);
  });
});

describe("settleUrl", () => {
  it("sends WordPress to the shop's own address in production, not Vercel's shortest domain (it may only redirect)", () => {
    const env = { VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "fastelavnskostumer.dk", NEXT_PUBLIC_SITE_URL: "https://www.fastelavnskostumer.dk" };
    expect(settleUrl(env)).toBe("https://www.fastelavnskostumer.dk/api/payments/settle");
    // Without an https address of its own: Vercel's production address.
    expect(settleUrl({ ...env, NEXT_PUBLIC_SITE_URL: "http://localhost:3000" })).toBe("https://fastelavnskostumer.dk/api/payments/settle");
    expect(settleUrl({ ...env, NEXT_PUBLIC_SITE_URL: undefined })).toBe("https://fastelavnskostumer.dk/api/payments/settle");
  });

  it("sends WordPress from a preview to the production address (previews are protected), elsewhere to NEXT_PUBLIC_SITE_URL", () => {
    expect(settleUrl({ VERCEL_ENV: "preview", VERCEL_PROJECT_PRODUCTION_URL: "fastelavnskostumer.dk", NEXT_PUBLIC_SITE_URL: "https://preview.vercel.app" })).toBe(
      "https://fastelavnskostumer.dk/api/payments/settle",
    );
    expect(settleUrl({ NEXT_PUBLIC_SITE_URL: "https://shop.example/" })).toBe("https://shop.example/api/payments/settle");
    expect(settleUrl({ NEXT_PUBLIC_SITE_URL: "ikke en adresse" })).toBeUndefined();
    expect(settleUrl({})).toBeUndefined();
  });
});

describe("settleAction", () => {
  it("captures sent orders and releases ended ones; orders paid at once are left alone", () => {
    const capture = (status: string) => ({ status, amount: "1.00", authorized_at: null, attempt: 0 });
    expect(settleAction({ status: "completed", capture: capture("authorized") })).toBe("capture");
    expect(settleAction({ status: "completed", capture: capture("expired") })).toBe("capture");
    expect(settleAction({ status: "completed", capture: capture("captured") })).toBeNull();
    // The shop collected the payment another way: the order may stay completed.
    expect(settleAction({ status: "completed", capture: capture("manual") })).toBeNull();
    expect(settleAction({ status: "cancelled", capture: capture("manual") })).toBeNull();
    for (const status of ["cancelled", "refunded", "failed"]) expect(settleAction({ status, capture: capture("authorized") })).toBe("release");
    expect(settleAction({ status: "cancelled", capture: capture("released") })).toBeNull();
    expect(settleAction({ status: "on-hold", capture: capture("authorized") })).toBeNull();
    expect(settleAction({ status: "processing", capture: capture("authorized") })).toBeNull();
    expect(settleAction({ status: "completed", capture: null })).toBeNull();
    expect(settleAction({ status: "completed" })).toBeNull();
  });
});

describe("settleOrder", () => {
  const ref = { id: 101, key: "wc_order_abc123" };

  it("captures a sent order's reservation once and reports the payment", async () => {
    const { stripe, pi, events, deps } = await setup();
    expect(await settleOrder(ref, deps)).toEqual({ type: "captured", orderId: 101 });
    expect(await stripe.retrieve(pi.id)).toMatchObject({ status: "succeeded", amount_received: 54700 });
    expect(events).toEqual([expect.objectContaining({ event: "succeeded", amount_minor: 54700, payment_method_title: "Visa-kort (Stripe)" })]);

    // A repeated callback or the daily job: nothing more to capture.
    expect(await settleOrder(ref, deps)).toMatchObject({ type: "ignored", reason: "nothing_to_settle" });
    expect(stripe.calls.capture).toBe(1);
  });

  it("captures once when two runs settle the same order at the same time", async () => {
    const { stripe, deps } = await setup();
    const outcomes = await Promise.all([settleOrder(ref, deps), settleOrder(ref, deps), settleOrder(ref, deps)]);
    expect(outcomes.map((o) => o.type)).toEqual(["captured", "captured", "captured"]);
    expect(stripe.calls.capture).toBe(1);
  });

  it("captures only what the order still costs after a refund; the rest is released", async () => {
    const { stripe, pi, deps } = await setup({ amount: "398.00" });
    await settleOrder(ref, deps);
    expect(await stripe.retrieve(pi.id)).toMatchObject({ status: "succeeded", amount_received: 39800, amount_capturable: 0 });
  });

  it("does not capture more than was reserved: the order goes back to the shop", async () => {
    const { stripe, order, events, deps } = await setup({ amount: "600.00" });
    expect(await settleOrder(ref, deps)).toEqual({ type: "capture_failed", orderId: 101 });
    expect(stripe.calls.capture).toBe(0);
    expect(events[0]).toMatchObject({ event: "capture_failed", message: expect.stringContaining("600.00 DKK") });
    expect(order.status).toBe("on-hold");
  });

  it("reports a capture Stripe refuses, and keeps the reservation", async () => {
    const { stripe, pi, events, deps } = await setup();
    stripe.failNextCapture(pi.id, "card_declined");
    expect(await settleOrder(ref, deps)).toEqual({ type: "capture_failed", orderId: 101 });
    expect(events[0]).toMatchObject({ event: "capture_failed", message: "Stripe afviste at trække beløbet (card_declined)" });
    expect((await stripe.retrieve(pi.id)).status).toBe("requires_capture");
  });

  it("asks Stripe again when the shop completes the order again after a refused capture", async () => {
    const { stripe, pi, order, deps } = await setup();
    stripe.failNextCapture(pi.id);
    expect((await settleOrder(ref, deps)).type).toBe("capture_failed");
    // A repeated report of the same attempt gets Stripe's same answer (same key) ...
    order.status = "completed";
    order.capture!.attempt -= 1;
    expect((await settleOrder(ref, deps)).type).toBe("capture_failed");
    expect(stripe.calls.capture).toBe(0);
    // ... a new attempt is a new request.
    order.status = "completed";
    order.capture!.attempt += 1;
    expect(await settleOrder(ref, deps)).toEqual({ type: "captured", orderId: 101 });
    expect(stripe.calls.capture).toBe(1);
  });

  it("reports an expired reservation of a sent order", async () => {
    const { stripe, pi, events, deps } = await setup();
    stripe.expire(pi.id);
    expect(await settleOrder(ref, deps)).toEqual({ type: "capture_failed", orderId: 101 });
    expect(events[0]).toMatchObject({ event: "canceled", message: "automatic" });
    expect(stripe.calls.capture).toBe(0);
  });

  it("tries again later (throws) when Stripe could not be reached, without reporting anything", async () => {
    const { stripe, events, deps } = await setup();
    const gateway = Object.assign(Object.create(stripe) as FakeStripe, {
      capture: async () => {
        throw new FakeStripeError("An error occurred with our connection to Stripe.", "api_connection_error");
      },
    });
    await expect(settleOrder(ref, { ...deps, gateway })).rejects.toThrow(/connection/);
    expect(events).toEqual([]);
  });

  it("leaves a payment this Stripe key does not know (a test-mode order after go-live) without failing", async () => {
    const { stripe, pi, events, deps } = await setup();
    stripe.intents.delete(pi.id);
    expect(await settleOrder(ref, deps)).toEqual({ type: "ignored", orderId: 101, reason: "payment_not_found" });
    expect(events).toEqual([]);
  });

  it("tries again later (throws) when Stripe answers with an error of its own", async () => {
    const { stripe, deps } = await setup();
    const gateway = Object.assign(Object.create(stripe) as FakeStripe, {
      retrieve: async () => {
        throw new FakeStripeError("An error occurred with our API.", "api_error");
      },
    });
    await expect(settleOrder(ref, { ...deps, gateway })).rejects.toThrow(/our API/);
  });

  it("releases the reservation of a cancelled order", async () => {
    const { stripe, pi, events, deps } = await setup({ status: "cancelled" });
    expect(await settleOrder(ref, deps)).toEqual({ type: "released", orderId: 101 });
    expect((await stripe.retrieve(pi.id)).status).toBe("canceled");
    expect(events).toEqual([expect.objectContaining({ event: "canceled" })]);
    expect(stripe.calls.capture).toBe(0);
  });

  it("leaves orders that are not sent or ended, unknown orders and other shops' payments alone", async () => {
    const waiting = await setup({ status: "on-hold" });
    expect(await settleOrder(ref, waiting.deps)).toMatchObject({ type: "ignored" });
    expect(await settleOrder({ id: 101, key: "wc_order_wrong" }, waiting.deps)).toMatchObject({ type: "ignored", reason: "order_not_found" });

    const other = await setup({ piMeta: { ...meta, store_id: "halloween-kostumer-dk" } });
    expect(await settleOrder(ref, other.deps)).toMatchObject({ type: "ignored", reason: "other_store" });
    expect(other.stripe.calls.capture + waiting.stripe.calls.capture).toBe(0);
  });
});

describe("settleOrders", () => {
  it("settles the orders a few at a time, each once", async () => {
    const { deps } = await setup();
    let running = 0;
    let most = 0;
    const seen: number[] = [];
    const backend = {
      ...deps.backend,
      async getOrder(id: number) {
        seen.push(id);
        most = Math.max(most, ++running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
        return null;
      },
    };
    const refs = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, key: `wc_order_${i}` }));
    const { outcomes, failed, skipped } = await settleOrders(refs, { ...deps, backend }, Infinity, 3);
    expect(most).toBe(3);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect([outcomes.length, failed, skipped]).toEqual([7, 0, 0]);

    most = 0;
    await settleOrders(refs.slice(0, 3), { ...deps, backend });
    expect(most).toBe(1);
  });
});

describe("runSettleSweep", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("settles what the plugin lists for this shop and counts what happened", async () => {
    const { deps } = await setup();
    expect(await runSettleSweep(deps)).toMatchObject({ listed: 1, captured: 1, failed: 0, skipped: 0, warned: 1 });
  });

  it("asks the plugin again after a pause when the WordPress host is overloaded", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const { deps } = await setup();
    let calls = 0;
    const sweepPayments = deps.backend.sweepPayments;
    deps.backend.sweepPayments = async (storeId) => {
      if (++calls === 1) throw new WooCommerceError("WooCommerce request failed (POST wc-headless/v1/payments/sweep: 508 http_508)", 508, "http_508");
      return sweepPayments(storeId);
    };
    const run = runSettleSweep(deps);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await run).toMatchObject({ listed: 1, captured: 1 });
    expect(calls).toBe(2);
  });

  it("does not ask again after other errors (e.g. a timeout: WordPress may still be working on it)", async () => {
    const { deps } = await setup();
    for (const error of [new WooCommerceError("did not respond in time", 0, "timeout"), new WooCommerceError("forbidden", 401, "woocommerce_rest_cannot_view")]) {
      let calls = 0;
      deps.backend.sweepPayments = async () => {
        calls += 1;
        throw error;
      };
      await expect(runSettleSweep(deps)).rejects.toBe(error);
      expect(calls).toBe(1);
    }
  });

  it("leaves orders for the next run once its time is used", async () => {
    const { stripe, deps } = await setup();
    expect(await runSettleSweep(deps, Date.now() - 1)).toMatchObject({ listed: 1, captured: 0, skipped: 1 });
    expect(stripe.calls.capture).toBe(0);
  });
});

describe("refusal", () => {
  it("tells a refusal (not worth repeating) from an error that may pass", () => {
    expect(refusal(new FakeStripeError("declined", "card_error", "card_declined"))).toBe("card_declined");
    expect(refusal(new FakeStripeError("too much", "invalid_request_error", "amount_too_large"))).toBe("amount_too_large");
    expect(refusal({ type: "StripeCardError", message: "Your card was declined." })).toBe("Your card was declined.");
    expect(refusal(new FakeStripeError("in use", "idempotency_error"))).toBeNull();
    expect(refusal(new FakeStripeError("offline", "api_connection_error"))).toBeNull();
    expect(refusal(new Error("boom"))).toBeNull();
    expect(refusal("boom")).toBeNull();
  });
});
