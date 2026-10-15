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

export type PaymentIntentLike = {
  id: string;
  status: PaymentIntentStatus;
  amount: number;
  amount_received: number;
  currency: string;
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
  metadata: Record<string, string>;
  description: string;
  receiptEmail?: string;
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
  /** Cancels if still cancelable; returns the latest state either way. */
  cancelIfPossible(id: string): Promise<PaymentIntentLike>;
  refund(paymentIntentId: string, idempotencyKey: string): Promise<void>;
}

/** Statuses where the customer can still (re)submit a payment on the same PaymentIntent. */
export const PAYABLE_STATUSES: PaymentIntentStatus[] = ["requires_payment_method", "requires_confirmation", "requires_action"];
