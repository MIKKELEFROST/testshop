import { createHmac, timingSafeEqual } from "node:crypto";
import { storeConfig } from "@/config/store";
import { stripeCurrencyExponent, toMinorUnits } from "@/lib/money";
import type { PaymentIntentLike } from "@/lib/stripe/gateway";
import { WooCommerceError } from "@/lib/woocommerce/client";
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
 * Where the plugin reports a sent or cancelled order. In production the shop's own https address
 * (NEXT_PUBLIC_SITE_URL): Vercel's VERCEL_PROJECT_PRODUCTION_URL is the shortest production
 * domain, which may be one that only redirects (e.g. the apex to www). From a preview the
 * production address (VERCEL_PROJECT_PRODUCTION_URL): previews are behind Vercel's deployment
 * protection, so WordPress cannot reach them. Elsewhere NEXT_PUBLIC_SITE_URL. Without either, the
 * daily job settles the order.
 */
export function settleUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  const site = env.NEXT_PUBLIC_SITE_URL?.trim();
  const production = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const base = env.VERCEL_ENV === "production" && site?.startsWith("https://") ? site : production ? `https://${production}` : site;
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

/**
 * What to do with the order's authorization now (the plugin decides the same way). "manual": the
 * shop collected the payment another way after the reservation could not be captured.
 */
export function settleAction(order: Pick<WcOrderSummary, "status" | "capture">): "capture" | "release" | null {
  const status = order.capture?.status;
  if (!status) return null;
  if (order.status === "completed" && status !== "captured" && status !== "manual") return "capture";
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

  let pi: PaymentIntentLike;
  try {
    pi = await deps.gateway.retrieve(order.payment_intent_id);
  } catch (error) {
    // Unknown to this Stripe key: e.g. a test-mode order once production has live keys. Nothing to
    // settle here, every day again; the shop cancels the order (see DEPLOY.md).
    if (stripeErrorCode(error) === "resource_missing") return ignored("payment_not_found");
    throw error;
  }
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

/**
 * Settle orders, `workers` at a time (gentle on WordPress: one by default), until `deadline` (ms
 * since epoch); the rest is skipped for a later run.
 */
export async function settleOrders(refs: OrderToSettle[], deps: SettleDeps, deadline = Infinity, workers = 1) {
  const outcomes: SettleOutcome[] = [];
  let failed = 0;
  let skipped = 0;
  let next = 0;
  const work = async () => {
    while (next < refs.length) {
      const ref = refs[next++]!;
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
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(workers, refs.length)) }, work));
  return { outcomes, failed, skipped };
}

/**
 * The daily job's orders at a time: each takes a few seconds (WordPress, Stripe, WordPress), so
 * a backlog after callbacks failed for a while is cleared about three times as fast, while the
 * fragile WordPress host sees at most three of these requests at once.
 */
export const SWEEP_WORKERS = 3;

/** Wait before asking for the sweep again after the WordPress host said it is overloaded. */
export const SWEEP_RETRY_MS = 2000;

/**
 * The daily job: everything the plugin lists for this webshop. Old reservations and sent orders
 * still not captured are warned about by the plugin.
 */
export async function runSettleSweep(deps: SettleDeps, deadline = Infinity) {
  const sweep = await sweepWithRetry(deps);
  const { outcomes, failed, skipped } = await settleOrders(
    sweep.settle.map((o) => ({ id: o.id, key: o.order_key })),
    deps,
    deadline,
    SWEEP_WORKERS,
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

/**
 * The plugin's list, asked once more after a pause when the host was overloaded (508, 429) or the
 * connection dropped: Vercel does not run a failed cron job again, so one 508 would otherwise skip
 * the day's safety net. Asking again is safe: listing changes nothing, and each warning is given
 * once per order under the order lock. Not after a timeout: the host may still be working on it.
 */
async function sweepWithRetry(deps: SettleDeps) {
  try {
    return await deps.backend.sweepPayments(storeConfig.id);
  } catch (error) {
    const busy = error instanceof WooCommerceError && (error.status === 508 || error.status === 429 || error.code === "network_error");
    if (!busy) throw error;
    await new Promise((resolve) => setTimeout(resolve, Math.round(SWEEP_RETRY_MS * (0.75 + Math.random() * 0.5))));
    return deps.backend.sweepPayments(storeConfig.id);
  }
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

/** A Stripe error's code (e.g. resource_missing), or null. */
function stripeErrorCode(error: unknown): string | null {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code : null;
}
