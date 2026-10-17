import { storeConfig } from "@/config/store";
import { stripeCurrencyExponent, toMinorUnits } from "@/lib/money";
import { CAPTURE_METHOD, PAYABLE_STATUSES, type PaymentGateway, type PaymentIntentLike } from "@/lib/stripe/gateway";
import { paymentMethodTitle } from "@/lib/stripe/payment-method";
import type { CheckoutRequest } from "@/lib/validation/checkout";
import type {
  AddressInput,
  CreateOrderInput,
  PaymentEventInput,
  PluginResult,
} from "@/lib/woocommerce/checkout-api";
import type { WcOrderSummary, WcQuote } from "@/lib/woocommerce/schemas";
import { storeBranding } from "./branding";

/**
 * Checkout orchestration — the only place where WooCommerce orders and Stripe
 * PaymentIntents meet.
 *
 * Order lifecycle (see docs/ARCHITECTURE.md):
 *   1. Customer clicks "Betal". The server sends cart + address + the total the customer
 *      saw to WooCommerce, which recalculates everything, reserves stock and creates (or
 *      idempotently returns) ONE pending order per checkout session.
 *   2. The server ensures ONE PaymentIntent per order, for exactly the WooCommerce total.
 *   3. The browser confirms the payment with Stripe (Payment Element). The amount is only
 *      authorized (manual capture): a card may as a rule only be charged when the goods are sent.
 *   4. Stripe's webhook (and the return URL, as a fast path) call `finalizePayment`, which
 *      re-reads the PaymentIntent from Stripe and lets WooCommerce reserve the order: processing
 *      (to be sent; plugin 1.6, on-hold before), not paid. WooCommerce core then reduces stock
 *      exactly once.
 *   5. When the shop marks the order completed (sent), the plugin tells the storefront, which
 *      captures the payment (./settle.ts); a cancelled order's authorization is released.
 */

export type CommerceBackend = {
  createOrder(input: CreateOrderInput): Promise<PluginResult>;
  attachPaymentIntent(orderId: number, orderKey: string, paymentIntentId: string, previous: string | null): Promise<PluginResult>;
  sendPaymentEvent(orderId: number, orderKey: string, input: PaymentEventInput): Promise<PluginResult>;
};

export type CheckoutDeps = {
  backend: CommerceBackend;
  gateway: PaymentGateway;
  /**
   * Where and with which token the plugin reports the order when it is sent or cancelled, sent
   * with the authorization (see ./settle.ts). Without it the daily job settles the order.
   */
  settleCallback?: (orderId: number, orderKey: string) => SettleCallback | undefined;
};

export type SettleCallback = { settle_url: string; settle_token: string };

export type CheckoutContext = { checkoutId: string; ip?: string; userAgent?: string };

export type OrderRef = { id: number; key: string; number: string };

export type StartCheckoutOutcome =
  | { type: "ready"; clientSecret: string; paymentIntentId: string; order: OrderRef & { total: string; currency: string } }
  | { type: "total_changed"; message: string; quote: WcQuote }
  | { type: "cart_invalid"; message: string; quote?: WcQuote }
  | { type: "out_of_stock"; message: string; quote?: WcQuote }
  /** A coupon was rejected (e.g. its usage limit was reached): the quote shows the total without it. */
  | { type: "coupon_invalid"; message: string; quote?: WcQuote }
  | { type: "already_paid"; order: OrderRef }
  /** The session's order is paid but this is a different cart: start a new checkout session. */
  | { type: "new_session_required" }
  | { type: "busy"; message: string };

export class CheckoutError extends Error {
  constructor(message: string, public readonly retryable = true) {
    super(message);
    this.name = "CheckoutError";
  }
}

export async function startCheckout(
  request: CheckoutRequest,
  context: CheckoutContext,
  deps: CheckoutDeps,
): Promise<StartCheckoutOutcome> {
  const input = toCreateOrderInput(request, context);
  const { status, body } = await deps.backend.createOrder(input);

  if (body.previous_payment_intent_id) {
    // A previous order of this session was cancelled (e.g. unpaid for too long) and had a
    // PaymentIntent: make sure it can never be paid.
    await deps.gateway.cancelIfPossible(body.previous_payment_intent_id).catch(() => undefined);
  }

  if (status === 200 || status === 201) {
    if (!body.order) throw new CheckoutError("Order response without order");
    return ensurePaymentIntent(body.order, request, deps);
  }

  const message = body.message ?? "Checkout kunne ikke gennemføres.";
  switch (body.code) {
    case "total_changed":
      if (!body.quote) throw new CheckoutError("total_changed without quote");
      return { type: "total_changed", message, quote: body.quote };
    case "cart_invalid":
    case "shipping_rate_unavailable":
      return { type: "cart_invalid", message, quote: body.quote };
    case "out_of_stock":
      return { type: "out_of_stock", message, quote: body.quote };
    case "coupon_invalid":
    case "coupon_unavailable":
      return { type: "coupon_invalid", message, quote: body.quote };
    case "already_paid":
      if (!body.order) throw new CheckoutError("already_paid without order");
      return sameItems(body.order, request) ? { type: "already_paid", order: ref(body.order) } : { type: "new_session_required" };
    case "busy":
      return { type: "busy", message };
    default:
      throw new CheckoutError(`Unexpected checkout response ${status} ${body.code ?? ""}`, status >= 500);
  }
}

async function ensurePaymentIntent(
  order: WcOrderSummary,
  request: CheckoutRequest,
  deps: CheckoutDeps,
): Promise<StartCheckoutOutcome> {
  const exponent = stripeCurrencyExponent(order.currency);
  const amount = toMinorUnits(order.total, exponent);
  const currency = order.currency.toLowerCase();
  const previous = order.payment_intent_id;

  if (previous) {
    const existing = await deps.gateway.retrieve(previous);
    if (paidOrReserved(existing)) return { type: "already_paid", order: ref(order) };
    if (reusable(existing, currency)) {
      const current = existing.amount === amount ? existing : await updateAmountOrNull(existing, amount, deps);
      if (current) return ready(order, current);
    }
    // Also a PaymentIntent from before capture at shipment: Elements must match its capture method.
    const cancelled = existing.status === "canceled" ? existing : await deps.gateway.cancelIfPossible(existing.id);
    if (paidOrReserved(cancelled)) return { type: "already_paid", order: ref(order) };
  }

  const created = await deps.gateway.create(
    {
      amount,
      currency,
      captureMethod: CAPTURE_METHOD,
      description: `${storeConfig.name} ordre #${order.number}`,
      statementDescriptorSuffix: storeConfig.statementDescriptorSuffix,
      metadata: {
        wc_order_id: String(order.id),
        wc_order_key: order.order_key,
        wc_order_number: order.number,
        store_id: storeConfig.id,
      },
      shipping: {
        name: `${request.shipping.firstName} ${request.shipping.lastName}`,
        phone: request.contact.phone || undefined,
        address: {
          line1: request.shipping.address1,
          line2: request.shipping.address2 || undefined,
          postal_code: request.shipping.postcode,
          city: request.shipping.city,
          country: request.shipping.country,
        },
      },
    },
    // Same order + amount + predecessor => Stripe returns the same PaymentIntent (no duplicates on retries).
    // The capture method keeps keys used before capture at shipment (other parameters) from clashing.
    `wchc:${order.id}:${order.order_key}:${amount}:${previous ?? "none"}:${CAPTURE_METHOD}`,
  );

  const attached = await deps.backend.attachPaymentIntent(order.id, order.order_key, created.id, previous);
  if (attached.status === 200) return ready(order, created);

  // Lost a race against a parallel request: use the PaymentIntent that won, discard ours.
  await deps.gateway.cancelIfPossible(created.id).catch(() => undefined);

  if (attached.body.code === "payment_intent_exists" && attached.body.payment_intent_id) {
    const winner = await deps.gateway.retrieve(attached.body.payment_intent_id);
    if (paidOrReserved(winner)) return { type: "already_paid", order: ref(order) };
    if (reusable(winner, currency)) {
      const current = winner.amount === amount ? winner : await updateAmountOrNull(winner, amount, deps);
      if (current) return ready(order, current);
    }
    return { type: "busy", message: "Betalingen er ved at blive forberedt. Prøv igen." };
  }

  if (attached.body.code === "not_payable" && attached.body.order) {
    return { type: "already_paid", order: ref(attached.body.order) };
  }

  throw new CheckoutError(`Could not attach payment (${attached.status} ${attached.body.code ?? ""})`);
}

/** Paid, on its way (async methods) or authorized: the order has its payment, never cancel it. */
function paidOrReserved(pi: PaymentIntentLike): boolean {
  return pi.status === "succeeded" || pi.status === "processing" || pi.status === "requires_capture";
}

/** The customer can (re)submit a payment on it, as the checkout's Elements are set up. */
function reusable(pi: PaymentIntentLike, currency: string): boolean {
  return PAYABLE_STATUSES.includes(pi.status) && pi.currency === currency && pi.capture_method === CAPTURE_METHOD;
}

async function updateAmountOrNull(pi: PaymentIntentLike, amount: number, deps: CheckoutDeps) {
  try {
    return await deps.gateway.updateAmount(pi.id, amount);
  } catch {
    return null;
  }
}

function ready(order: WcOrderSummary, pi: PaymentIntentLike): StartCheckoutOutcome {
  if (!pi.client_secret) throw new CheckoutError("PaymentIntent without client secret");
  return {
    type: "ready",
    clientSecret: pi.client_secret,
    paymentIntentId: pi.id,
    order: { ...ref(order), total: order.total, currency: order.currency },
  };
}

function ref(order: WcOrderSummary): OrderRef {
  return { id: order.id, key: order.order_key, number: order.number };
}

function sameItems(order: WcOrderSummary, request: CheckoutRequest): boolean {
  const key = (p: number, v: number, q: number) => `${p}:${v}:${q}`;
  const ordered = order.items.map((i) => key(i.product_id, i.variation_id, i.quantity)).sort();
  const requested = mergeLines(request.items).map((i) => key(i.product_id, i.variation_id, i.quantity)).sort();
  return ordered.length === requested.length && ordered.every((v, i) => v === requested[i]);
}

function mergeLines(items: CheckoutRequest["items"]) {
  const merged = new Map<string, { product_id: number; variation_id: number; quantity: number }>();
  for (const item of items) {
    const k = `${item.productId}:${item.variationId}`;
    const existing = merged.get(k);
    if (existing) existing.quantity += item.quantity;
    else merged.set(k, { product_id: item.productId, variation_id: item.variationId, quantity: item.quantity });
  }
  return [...merged.values()];
}

export function toCreateOrderInput(request: CheckoutRequest, context: CheckoutContext): CreateOrderInput {
  const shipping = toAddress(request.shipping);
  const billingSource = request.billingSameAsShipping || !request.billing ? request.shipping : request.billing;

  return {
    checkout_id: context.checkoutId,
    store_id: storeConfig.id,
    store: storeBranding(),
    items: mergeLines(request.items),
    billing: { ...toAddress(billingSource), email: request.contact.email, phone: request.contact.phone ?? "" },
    shipping: { ...shipping, phone: request.contact.phone ?? "" },
    shipping_rate_id: request.shippingRateId,
    expected_total: request.expectedTotal,
    customer_note: request.customerNote,
    payment_method_title: storeConfig.paymentMethodTitle,
    customer_ip: context.ip && context.ip !== "unknown" ? context.ip : undefined,
    customer_user_agent: context.userAgent?.slice(0, 500),
    coupons: request.coupons,
  };
}

function toAddress(address: CheckoutRequest["shipping"]): AddressInput {
  return {
    first_name: address.firstName,
    last_name: address.lastName,
    company: address.company ?? "",
    address_1: address.address1,
    address_2: address.address2 ?? "",
    postcode: address.postcode,
    city: address.city,
    country: address.country,
  };
}

/* ------------------------------------------------------------------ */
/* Payment finalisation (webhook + return URL)                         */
/* ------------------------------------------------------------------ */

export type FinalizeOutcome =
  | { type: "applied"; result: string; order?: WcOrderSummary }
  | { type: "refunded"; order?: WcOrderSummary }
  /** An authorization the order cannot keep (e.g. a second one) was cancelled. */
  | { type: "released"; order?: WcOrderSummary }
  | { type: "needs_review"; reason: string }
  | { type: "ignored"; reason: string };

/**
 * Apply the current state of a PaymentIntent to its WooCommerce order. Always pass a
 * PaymentIntent freshly retrieved from Stripe — never data from the browser.
 * Safe to call any number of times, concurrently, in any order.
 */
export async function finalizePayment(pi: PaymentIntentLike, deps: CheckoutDeps): Promise<FinalizeOutcome> {
  const orderId = Number(pi.metadata.wc_order_id);
  const orderKey = pi.metadata.wc_order_key;
  if (!Number.isSafeInteger(orderId) || orderId <= 0 || !orderKey) return { type: "ignored", reason: "not_a_shop_payment" };
  if (pi.metadata.store_id !== storeConfig.id) return { type: "ignored", reason: "other_store" };

  const event = paymentEventFor(pi);
  if (!event) return { type: "ignored", reason: `status_${pi.status}` };

  const failure = event === "failed" ? pi.last_payment_error : null;
  let answer: PluginResult;
  try {
    answer = await deps.backend.sendPaymentEvent(orderId, orderKey, {
      event,
      payment_intent_id: pi.id,
      amount_minor: event === "succeeded" ? pi.amount_received : event === "authorized" ? pi.amount_capturable : pi.amount,
      currency: pi.currency,
      currency_exponent: stripeCurrencyExponent(pi.currency),
      message: failure ? (failure.code ?? failure.message ?? undefined) : event === "canceled" ? (pi.cancellation_reason ?? undefined) : undefined,
      attempt_id: failure ? (failure.charge ?? failure.payment_method_id ?? undefined) : undefined,
      payment_method_title: event === "failed" || event === "canceled" ? undefined : paymentMethodTitle(pi.payment_method),
      ...(event === "authorized" ? deps.settleCallback?.(orderId, orderKey) : undefined),
    });
  } catch (error) {
    if (event === "authorized" && (error as { code?: unknown } | null)?.code === "invalid_payment_event") {
      // A plugin before 1.5 cannot keep a reservation: charge now, as before, rather than leave
      // money reserved for an order it would cancel as unpaid.
      const amount = pi.amount_capturable;
      return finalizePayment(await deps.gateway.capture(pi.id, amount, `wchc-capture:${pi.id}:${amount}:at-once`), deps);
    }
    throw error;
  }
  const { status, body } = answer;

  if (status === 200) {
    // An authorization is cancelled, never refunded: nothing was charged.
    if (body.result === "release_required" || (body.result === "refund_required" && pi.status === "requires_capture")) {
      await deps.gateway.cancelIfPossible(pi.id);
      return { type: "released", order: body.order };
    }
    if (body.result === "refund_required") {
      await deps.gateway.refund(pi.id, `wchc-refund:${pi.id}`);
      return { type: "refunded", order: body.order };
    }
    return { type: "applied", result: body.result ?? "ok", order: body.order };
  }

  switch (body.code) {
    case "busy":
      throw new CheckoutError("Order is locked by another request");
    case "amount_mismatch":
      return { type: "needs_review", reason: "amount_mismatch" };
    case "order_not_found":
    case "order_not_headless":
    case "payment_intent_unknown":
      return { type: "ignored", reason: body.code };
    default:
      throw new CheckoutError(`Unexpected payment response ${status} ${body.code ?? ""}`, status >= 500 || status === 0);
  }
}

export function paymentEventFor(pi: PaymentIntentLike): PaymentEventInput["event"] | null {
  switch (pi.status) {
    case "succeeded":
      return "succeeded";
    case "processing":
      return "processing";
    case "requires_capture":
      return "authorized";
    case "canceled":
      return "canceled";
    case "requires_payment_method":
      return pi.last_payment_error ? "failed" : null;
    default:
      return null;
  }
}
