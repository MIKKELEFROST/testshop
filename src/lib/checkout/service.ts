import { storeConfig } from "@/config/store";
import { stripeCurrencyExponent, toMinorUnits } from "@/lib/money";
import { PAYABLE_STATUSES, type PaymentGateway, type PaymentIntentLike } from "@/lib/stripe/gateway";
import type { CheckoutRequest } from "@/lib/validation/checkout";
import type {
  AddressInput,
  CreateOrderInput,
  PaymentEventInput,
  PluginResult,
} from "@/lib/woocommerce/checkout-api";
import type { WcOrderSummary, WcQuote } from "@/lib/woocommerce/schemas";

/**
 * Checkout orchestration — the only place where WooCommerce orders and Stripe
 * PaymentIntents meet.
 *
 * Order lifecycle (see docs/ARCHITECTURE.md):
 *   1. Customer clicks "Betal". The server sends cart + address + the total the customer
 *      saw to WooCommerce, which recalculates everything, reserves stock and creates (or
 *      idempotently returns) ONE pending order per checkout session.
 *   2. The server ensures ONE PaymentIntent per order, for exactly the WooCommerce total.
 *   3. The browser confirms the payment with Stripe (Payment Element).
 *   4. Stripe's webhook (and the return URL, as a fast path) call `finalizePayment`, which
 *      re-reads the PaymentIntent from Stripe and lets WooCommerce mark the order paid.
 *      WooCommerce core then reduces stock exactly once.
 */

export type CommerceBackend = {
  createOrder(input: CreateOrderInput): Promise<PluginResult>;
  attachPaymentIntent(orderId: number, orderKey: string, paymentIntentId: string, previous: string | null): Promise<PluginResult>;
  sendPaymentEvent(orderId: number, orderKey: string, input: PaymentEventInput): Promise<PluginResult>;
};

export type CheckoutDeps = { backend: CommerceBackend; gateway: PaymentGateway };

export type CheckoutContext = { checkoutId: string; ip?: string; userAgent?: string };

export type OrderRef = { id: number; key: string; number: string };

export type StartCheckoutOutcome =
  | { type: "ready"; clientSecret: string; paymentIntentId: string; order: OrderRef & { total: string; currency: string } }
  | { type: "total_changed"; message: string; quote: WcQuote }
  | { type: "cart_invalid"; message: string; quote?: WcQuote }
  | { type: "out_of_stock"; message: string; quote?: WcQuote }
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

  if (status === 200 || status === 201) {
    if (!body.order) throw new CheckoutError("Order response without order");
    if (body.previous_payment_intent_id) {
      // A previous, cancelled order of this session had a PaymentIntent: make sure it can never be paid.
      await deps.gateway.cancelIfPossible(body.previous_payment_intent_id).catch(() => undefined);
    }
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
    if (existing.status === "succeeded" || existing.status === "processing") {
      return { type: "already_paid", order: ref(order) };
    }
    if (PAYABLE_STATUSES.includes(existing.status) && existing.currency === currency) {
      const current = existing.amount === amount ? existing : await updateAmountOrNull(existing, amount, deps);
      if (current) return ready(order, current);
    }
    const cancelled = existing.status === "canceled" ? existing : await deps.gateway.cancelIfPossible(existing.id);
    if (cancelled.status === "succeeded" || cancelled.status === "processing") {
      return { type: "already_paid", order: ref(order) };
    }
  }

  const created = await deps.gateway.create(
    {
      amount,
      currency,
      description: `${storeConfig.name} ordre #${order.number}`,
      receiptEmail: request.contact.email,
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
    `wchc:${order.id}:${order.order_key}:${amount}:${previous ?? "none"}`,
  );

  const attached = await deps.backend.attachPaymentIntent(order.id, order.order_key, created.id, previous);
  if (attached.status === 200) return ready(order, created);

  // Lost a race against a parallel request: use the PaymentIntent that won, discard ours.
  await deps.gateway.cancelIfPossible(created.id).catch(() => undefined);

  if (attached.body.code === "payment_intent_exists" && attached.body.payment_intent_id) {
    const winner = await deps.gateway.retrieve(attached.body.payment_intent_id);
    if (winner.status === "succeeded" || winner.status === "processing") return { type: "already_paid", order: ref(order) };
    if (PAYABLE_STATUSES.includes(winner.status)) {
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
    items: mergeLines(request.items),
    billing: { ...toAddress(billingSource), email: request.contact.email, phone: request.contact.phone ?? "" },
    shipping: { ...shipping, phone: request.contact.phone ?? "" },
    shipping_rate_id: request.shippingRateId,
    expected_total: request.expectedTotal,
    customer_note: request.customerNote,
    payment_method_title: storeConfig.paymentMethodTitle,
    customer_ip: context.ip && context.ip !== "unknown" ? context.ip : undefined,
    customer_user_agent: context.userAgent?.slice(0, 500),
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

  const { status, body } = await deps.backend.sendPaymentEvent(orderId, orderKey, {
    event,
    payment_intent_id: pi.id,
    amount_minor: event === "succeeded" ? pi.amount_received : pi.amount,
    currency: pi.currency,
    currency_exponent: stripeCurrencyExponent(pi.currency),
    message: event === "failed" ? (pi.last_payment_error?.code ?? pi.last_payment_error?.message ?? undefined) : undefined,
  });

  if (status === 200) {
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
    case "canceled":
      return "canceled";
    case "requires_payment_method":
      return pi.last_payment_error ? "failed" : null;
    default:
      return null;
  }
}
