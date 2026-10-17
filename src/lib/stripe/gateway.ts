/**
 * The subset of Stripe the checkout needs. The real implementation lives in ./server.ts;
 * tests use an in-memory fake with the same contract.
 */

export type PaymentIntentStatus =
  | "requires_payment_method"
  | "requires_confirmation"
  | "requires_action"
  | "processing"
  | "requires_capture"
  | "canceled"
  | "succeeded"
  | (string & {});

/**
 * The shop reserves (authorizes) the amount when the customer pays and captures it when the
 * order is sent: a card may as a rule only be charged when the goods are sent. Stripe then only
 * offers payment methods that support it (cards, Apple Pay, Google Pay, MobilePay, Klarna …),
 * and the browser's Elements must say the same (`captureMethod`).
 */
export const CAPTURE_METHOD = "manual" as const;

/** Stripe's smallest charge, in minor units (2.50 kr. for DKK): a smaller PaymentIntent is refused. */
const MINIMUM_CHARGE: Record<string, number> = { dkk: 250, eur: 50, sek: 300, nok: 300, gbp: 30, usd: 50 };

export function minimumChargeMinor(currency: string): number {
  return MINIMUM_CHARGE[currency.toLowerCase()] ?? 50;
}

export type PaymentIntentLike = {
  id: string;
  status: PaymentIntentStatus;
  amount: number;
  /** What can still be captured (`requires_capture`). */
  amount_capturable: number;
  amount_received: number;
  currency: string;
  /** "manual": authorized, captured when the order is sent. "automatic": charged at once (orders from before). */
  capture_method: "manual" | "automatic" | "automatic_async" | (string & {});
  /** Why Stripe cancelled it, e.g. "automatic" when an uncaptured authorization expired. */
  cancellation_reason?: string | null;
  client_secret: string | null;
  metadata: Record<string, string>;
  last_payment_error?: {
    message?: string | null;
    code?: string | null;
    /** Failed charge (card errors) or payment method: identifies one attempt. */
    charge?: string | null;
    payment_method_id?: string | null;
  } | null;
  /** Set once the customer has chosen a method (only when retrieved with it expanded). */
  payment_method?: PaymentMethodLike | null;
};

export type PaymentMethodLike = {
  type: string;
  card?: { brand?: string | null; wallet?: string | null } | null;
};

export type CreatePaymentIntentParams = {
  amount: number;
  currency: string;
  /** Omitted: Stripe's default, charged at once. */
  captureMethod?: typeof CAPTURE_METHOD;
  metadata: Record<string, string>;
  description: string;
  /** The shop on the card statement (see StoreBrand.statementDescriptorSuffix). */
  statementDescriptorSuffix?: string;
  shipping?: {
    name: string;
    phone?: string;
    address: { line1: string; line2?: string; postal_code: string; city: string; country: string };
  };
};

export interface PaymentGateway {
  /** Includes the payment method the customer used. */
  retrieve(id: string): Promise<PaymentIntentLike>;
  create(params: CreatePaymentIntentParams, idempotencyKey: string): Promise<PaymentIntentLike>;
  updateAmount(id: string, amount: number): Promise<PaymentIntentLike>;
  /** Cancels if still cancelable (also releases an authorization); returns the latest state either way. */
  cancelIfPossible(id: string): Promise<PaymentIntentLike>;
  /** Captures an authorization (at most `amount_capturable`; the rest is released). Throws when Stripe refuses. */
  capture(id: string, amount: number, idempotencyKey: string): Promise<PaymentIntentLike>;
  refund(paymentIntentId: string, idempotencyKey: string): Promise<void>;
}

/** Statuses where the customer can still (re)submit a payment on the same PaymentIntent. */
export const PAYABLE_STATUSES: PaymentIntentStatus[] = ["requires_payment_method", "requires_confirmation", "requires_action"];
