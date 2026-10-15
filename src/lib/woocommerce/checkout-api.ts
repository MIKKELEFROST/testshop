import "server-only";
import { wooRequest } from "./client";
import {
  orderDetailsSchema,
  pluginResponseSchema,
  quoteSchema,
  type PluginResponse,
  type WcOrderDetails,
  type WcQuote,
} from "./schemas";

/**
 * Typed wrapper around the Headless Checkout Bridge plugin (wc-headless/v1).
 * These endpoints use WooCommerce's own cart, tax, shipping, order and stock logic.
 */

export type LineInput = { product_id: number; variation_id: number; quantity: number };

export type AddressInput = {
  first_name: string;
  last_name: string;
  company?: string;
  address_1: string;
  address_2?: string;
  postcode: string;
  city: string;
  state?: string;
  country: string;
  phone?: string;
  email?: string;
};

export type QuoteInput = {
  /** The storefront's webshop; products it does not sell come back as errors. */
  store_id: string;
  items: LineInput[];
  address: Partial<Pick<AddressInput, "country" | "postcode" | "city" | "address_1" | "address_2" | "state">>;
  shipping_rate_id?: string | null;
  checkout_id?: string;
  coupons?: string[];
  /** Needed for coupons restricted to certain e-mail addresses. */
  email?: string;
};

/**
 * The webshop's brand for WooCommerce's order e-mails (plugin 1.4; older plugins ignore it).
 * The plugin stores the valid fields on the order and drops the others.
 */
export type StoreBrandingInput = {
  name: string;
  /** The storefront's address (http or https). */
  url?: string;
  /** Reply-To of the customer's e-mails, {store_email}, and where the customer gives notice of withdrawal. */
  email: string;
  /** Base colour, #rrggbb. */
  color: string;
  /** Header image (https). */
  logo?: string;
  // The seller and the return rules for the withdrawal information and the standard withdrawal
  // form in the order confirmation (plain text). WordPress does not have them.
  company_name: string;
  company_address: string;
  cvr: string;
  return_address: string;
  /** Who pays the return shipping, as a sentence. */
  return_shipping: string;
  /** The shop's return period in days, at least the statutory 14. */
  return_days: number;
};

export type CreateOrderInput = {
  checkout_id: string;
  store_id: string;
  /** Without it the order e-mails show the WordPress site, as before plugin 1.4. */
  store?: StoreBrandingInput;
  items: LineInput[];
  billing: AddressInput & { email: string };
  shipping: AddressInput;
  shipping_rate_id: string | null;
  expected_total: string;
  customer_note?: string;
  payment_method_title: string;
  customer_ip?: string;
  customer_user_agent?: string;
  coupons: string[];
};

export type PaymentEventInput = {
  event: "succeeded" | "processing" | "failed" | "canceled";
  payment_intent_id: string;
  amount_minor: number;
  currency: string;
  currency_exponent: number;
  message?: string;
  /** Identifies one declined attempt, so the order notes it once. */
  attempt_id?: string;
  /** The payment method actually used, e.g. "MobilePay (Stripe)". */
  payment_method_title?: string;
};

export type PluginResult = { status: number; body: PluginResponse };

/** Expected business outcomes (conflicts, validation) come back as data, not exceptions. */
const BUSINESS_STATUSES = [404, 409, 422];

export async function fetchQuote(input: QuoteInput): Promise<WcQuote> {
  const { data } = await wooRequest("wc-headless/v1/quote", { method: "POST", body: input, schema: quoteSchema });
  return data;
}

export async function createOrder(input: CreateOrderInput): Promise<PluginResult> {
  const { status, data } = await wooRequest("wc-headless/v1/orders", {
    method: "POST",
    body: input,
    schema: pluginResponseSchema,
    acceptStatus: BUSINESS_STATUSES,
    timeoutMs: 30000,
  });
  return { status, body: data };
}

export async function attachPaymentIntent(
  orderId: number,
  orderKey: string,
  paymentIntentId: string,
  previousPaymentIntentId: string | null,
): Promise<PluginResult> {
  const { status, data } = await wooRequest(`wc-headless/v1/orders/${orderId}/payment-intent`, {
    method: "POST",
    body: { order_key: orderKey, payment_intent_id: paymentIntentId, previous_payment_intent_id: previousPaymentIntentId },
    schema: pluginResponseSchema,
    acceptStatus: BUSINESS_STATUSES,
  });
  return { status, body: data };
}

export async function sendPaymentEvent(orderId: number, orderKey: string, input: PaymentEventInput): Promise<PluginResult> {
  const { status, data } = await wooRequest(`wc-headless/v1/orders/${orderId}/payment`, {
    method: "POST",
    body: { order_key: orderKey, ...input },
    schema: pluginResponseSchema,
    acceptStatus: BUSINESS_STATUSES,
    timeoutMs: 30000,
  });
  return { status, body: data };
}

export async function getOrderDetails(orderId: number, orderKey: string): Promise<WcOrderDetails | null> {
  const { status, data } = await wooRequest(`wc-headless/v1/orders/${orderId}`, {
    query: { order_key: orderKey },
    schema: orderDetailsSchema.or(pluginResponseSchema),
    acceptStatus: [404],
  });
  if (status === 404) return null;
  const parsed = orderDetailsSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}
