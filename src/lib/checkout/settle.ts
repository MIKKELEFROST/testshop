import { createHmac, timingSafeEqual } from "node:crypto";
import { storeConfig } from "@/config/store";
import { stripeCurrencyExponent, toMinorUnits } from "@/lib/money";
import type { PaymentIntentLike } from "@/lib/stripe/gateway";
import type { PaymentSweep, WcOrderSummary } from "@/lib/woocommerce/schemas";
import { finalizePayment, type CheckoutDeps, type CommerceBackend, type SettleCallback } from "./service";

/**
 * Capture at shipment: the customer's payment is authorized when the order is placed (see
 * ./service.ts) and settled here when the shop has decided what happens to the order.
 *
 * - The shop marks the order completed (sent): capture what the order still costs (its total less
 *   refunds), once. Stripe's idempotency key and the PaymentIntent's state make a second capture
 *   impossible, however often this runs.
 * - The shop cancels (or refunds, or fails) the order before that: release the authorization.
 *
 * The plugin calls POST /api/payments/settle right after the status change (with the order's
 * token from `settleCallback`), and the daily job (/api/cron/settle-payments) asks the plugin for
 * orders still to settle. Neither is trusted: the order is re-read from WooCommerce and the
 * PaymentIntent from Stripe, and their state decides. Results go to the plugin as payment events.
 */

export const SETTLE_PATH = "/api/payments/settle";

export type SettleBackend = CommerceBackend & {
  getOrder(orderId: number, orderKey: string): Promise<WcOrderSummary | null>;
  sweepPayments(storeId: string): Promise<PaymentSweep>;
};

export type SettleDeps = CheckoutDeps & { backend: SettleBackend };

export type OrderToSettle = { id: number; key: string };

export type SettleOutcome =
  | { type: "captured" | "released" | "refunded" | "capture_failed"; orderId: number }
  | { type: "ignored"; orderId: number; reason: string };

/**
 * The order's token in the plugin's callback: HMAC-SHA256 of the shop and the order with a
 * server secret (STRIPE_SECRET_KEY), so only this storefront can make one, and one order's token
 * says nothing about another's or the other webshop's. No secret is stored in WordPress.
 */
export function settleToken(secret: string, storeId: string, orderId: number, orderKey: string): string {
  return createHmac("sha256", secret).update(`wchc-settle:v1:${storeId}:${orderId}:${orderKey}`).digest("base64url");
}

export function validSettleToken(secret: string, storeId: string, orderId: number, orderKey: string, token: string): boolean {
  const expected = Buffer.from(settleToken(secret, storeId, orderId, orderKey));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Where the plugin reports a sent or cancelled order. On Vercel always the production address
 * (VERCEL_PROJECT_PRODUCTION_URL), also from a preview: previews are behind Vercel's deployment
 * protection, so WordPress cannot reach them. Elsewhere NEXT_PUBLIC_SITE_URL. Without either, the
 * daily job settles the order.
 */
export function settleUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  const production = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const base = production ? `https://${production}` : env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!base) return undefined;
  try {
    const url = new URL(SETTLE_PATH, base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** The callback sent with an authorization, or undefined without an address. */
export function settleCallbackFor(secret: string, url: string | undefined) {
  return (orderId: number, orderKey: string): SettleCallback | undefined =>
    url ? { settle_url: url, settle_token: settleToken(secret, storeConfig.id, orderId, orderKey) } : undefined;
}

/** What to do with the order's authorization now (the plugin decides the same way). */
export function settleAction(order: Pick<WcOrderSummary, "status" | "capture">): "capture" | "release" | null {
  const status = order.capture?.status;
  if (!status) return null;
  if (order.status === "completed" && status !== "captured") return "capture";
  if (["cancelled", "refunded", "failed"].includes(order.status) && (status === "authorized" || status === "failed")) return "release";
  return null;
}

/** Capture or release one order's authorization, as its state in WooCommerce and Stripe says. */
export async function settleOrder(ref: OrderToSettle, deps: SettleDeps): Promise<SettleOutcome> {
  const ignored = (reason: string): SettleOutcome => ({ type: "ignored", orderId: ref.id, reason });

  const order = await deps.backend.getOrder(ref.id, ref.key);
  if (!order) return ignored("order_not_found");
  const action = settleAction(order);
  if (!action || !order.payment_intent_id || !order.capture) return ignored("nothing_to_settle");

  let pi = await deps.gateway.retrieve(order.payment_intent_id);
  if (pi.metadata.store_id !== storeConfig.id || pi.metadata.wc_order_id !== String(order.id)) return ignored("other_store");

  if (action === "release") {
    if (pi.status === "requires_capture") pi = await deps.gateway.cancelIfPossible(pi.id);
    return report(order, pi, deps);
  }

  if (pi.status === "requires_capture") {
    const amount = toMinorUnits(order.capture.amount, stripeCurrencyExponent(order.currency));
    if (amount <= 0 || amount > pi.amount_capturable) {
      // E.g. the shop added items after the order was placed: more than the customer authorized.
      return captureFailed(order, pi, `ordrens beløb (${order.capture.amount} ${order.currency}) passer ikke til det reserverede beløb`, deps);
    }
    try {
      // Stripe answers a key the same for a day, also a refusal: a new attempt (after a failure the
      // plugin recorded) gets a new key, runs of the same attempt share one.
      pi = await deps.gateway.capture(pi.id, amount, `wchc-capture:${pi.id}:${amount}:${order.capture.attempt}`);
    } catch (error) {
      // Stripe may have captured it anyway (a parallel run, a lost answer), or let it expire.
      pi = await deps.gateway.retrieve(pi.id);
      const refused = refusal(error);
      if (pi.status === "requires_capture") {
        if (!refused) throw error;
        return captureFailed(order, pi, `Stripe afviste at trække beløbet (${refused})`, deps);
      }
    }
  }

  // succeeded: recorded as paid. canceled (expired): the plugin puts the order back on-hold.
  if (pi.status === "succeeded" || pi.status === "canceled") return report(order, pi, deps);
  return ignored(`payment_${pi.status}`);
}

/** Settle orders one at a time (gentle on WordPress), until `deadline` (ms since epoch). */
export async function settleOrders(refs: OrderToSettle[], deps: SettleDeps, deadline = Infinity) {
  const outcomes: SettleOutcome[] = [];
  let failed = 0;
  let skipped = 0;
  for (const ref of refs) {
    if (Date.now() > deadline) {
      skipped += 1;
      continue;
    }
    try {
      outcomes.push(await settleOrder(ref, deps));
    } catch (error) {
      failed += 1;
      console.error(`[settle] order ${ref.id} failed:`, error instanceof Error ? error.message : "unknown error");
    }
  }
  return { outcomes, failed, skipped };
}

/** The daily job: everything the plugin lists for this webshop. Old reservations are warned about by the plugin. */
export async function runSettleSweep(deps: SettleDeps, deadline = Infinity) {
  const sweep = await deps.backend.sweepPayments(storeConfig.id);
  const { outcomes, failed, skipped } = await settleOrders(
    sweep.settle.map((o) => ({ id: o.id, key: o.order_key })),
    deps,
    deadline,
  );
  const count = (type: SettleOutcome["type"]) => outcomes.filter((o) => o.type === type).length;
  return {
    listed: sweep.settle.length,
    captured: count("captured"),
    released: count("released"),
    refunded: count("refunded"),
    captureFailed: count("capture_failed"),
    ignored: count("ignored"),
    failed,
    skipped,
    warned: sweep.warned.length,
  };
}

/** Tell the plugin the PaymentIntent's state (captured, released, expired). */
async function report(order: WcOrderSummary, pi: PaymentIntentLike, deps: SettleDeps): Promise<SettleOutcome> {
  const outcome = await finalizePayment(pi, deps);
  const orderId = order.id;
  switch (outcome.type) {
    case "refunded":
    case "released":
      return { type: outcome.type, orderId };
    case "applied":
      if (outcome.result === "paid" || outcome.result === "already_paid") return { type: "captured", orderId };
      if (outcome.result === "released" || outcome.result === "capture_failed") return { type: outcome.result, orderId };
      return { type: "ignored", orderId, reason: outcome.result };
    default:
      return { type: "ignored", orderId, reason: outcome.reason };
  }
}

/** Stripe refused the capture while still holding the money: the plugin puts the order back on-hold. */
async function captureFailed(order: WcOrderSummary, pi: PaymentIntentLike, message: string, deps: SettleDeps): Promise<SettleOutcome> {
  const { status, body } = await deps.backend.sendPaymentEvent(order.id, order.order_key, {
    event: "capture_failed",
    payment_intent_id: pi.id,
    amount_minor: pi.amount_capturable,
    currency: pi.currency,
    currency_exponent: stripeCurrencyExponent(pi.currency),
    message,
  });
  if (status !== 200) throw new Error(`Capture failure not recorded (${status} ${body.code ?? ""})`);
  return body.result === "capture_failed" ? { type: "capture_failed", orderId: order.id } : { type: "ignored", orderId: order.id, reason: body.result ?? "unknown" };
}

/**
 * Stripe's answer that trying again will not change (a decline, an invalid request such as an
 * amount above the authorization), as its code. Connection, rate limit and idempotency errors
 * (e.g. a parallel capture with the same key) are not: they are tried again later.
 */
export function refusal(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const { type, rawType, code, message } = error as { type?: unknown; rawType?: unknown; code?: unknown; message?: unknown };
  const kind = typeof rawType === "string" ? rawType : type;
  if (kind !== "card_error" && kind !== "invalid_request_error" && kind !== "StripeCardError" && kind !== "StripeInvalidRequestError") return null;
  return typeof code === "string" ? code : typeof message === "string" ? message : String(kind);
}
