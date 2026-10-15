import type { CreatePaymentIntentParams, PaymentGateway, PaymentIntentLike, PaymentMethodLike } from "@/lib/stripe/gateway";

/**
 * In-memory stand-in for Stripe's PaymentIntents API with the behaviour the checkout
 * relies on: idempotency keys, cancel rules, amount updates and refunds.
 */
export class FakeStripe implements PaymentGateway {
  intents = new Map<string, PaymentIntentLike>();
  private byIdempotencyKey = new Map<string, { id: string; params: string }>();
  refunds: { paymentIntentId: string; idempotencyKey: string }[] = [];
  /** What each PaymentIntent was created with, by id. */
  createParams = new Map<string, CreatePaymentIntentParams>();
  calls = { create: 0, update: 0, cancel: 0 };
  private seq = 0;

  async retrieve(id: string) {
    const pi = this.intents.get(id);
    if (!pi) throw new Error(`No such payment_intent: ${id}`);
    return structuredClone(pi);
  }

  async create(params: CreatePaymentIntentParams, idempotencyKey: string) {
    const fingerprint = JSON.stringify(params);
    const previous = this.byIdempotencyKey.get(idempotencyKey);
    if (previous) {
      if (previous.params !== fingerprint) throw new Error("Keys for idempotent requests can only be used with the same parameters");
      return this.retrieve(previous.id);
    }
    this.calls.create += 1;
    const id = `pi_fake${String(++this.seq).padStart(6, "0")}${Math.random().toString(36).slice(2, 8)}`;
    const pi: PaymentIntentLike = {
      id,
      status: "requires_payment_method",
      amount: params.amount,
      amount_received: 0,
      currency: params.currency,
      client_secret: `${id}_secret_test`,
      metadata: { ...params.metadata },
      last_payment_error: null,
    };
    this.intents.set(id, pi);
    this.createParams.set(id, structuredClone(params));
    this.byIdempotencyKey.set(idempotencyKey, { id, params: fingerprint });
    return structuredClone(pi);
  }

  async updateAmount(id: string, amount: number) {
    const pi = this.require(id);
    if (!["requires_payment_method", "requires_confirmation", "requires_action"].includes(pi.status)) {
      throw new Error(`Cannot update a PaymentIntent in status ${pi.status}`);
    }
    this.calls.update += 1;
    pi.amount = amount;
    return structuredClone(pi);
  }

  async cancelIfPossible(id: string) {
    const pi = this.require(id);
    if (["requires_payment_method", "requires_confirmation", "requires_action", "requires_capture"].includes(pi.status)) {
      this.calls.cancel += 1;
      pi.status = "canceled";
    }
    return structuredClone(pi);
  }

  async refund(paymentIntentId: string, idempotencyKey: string) {
    if (this.refunds.some((r) => r.idempotencyKey === idempotencyKey)) return;
    this.refunds.push({ paymentIntentId, idempotencyKey });
  }

  /** What Stripe.js + the bank would do when the customer confirms. */
  succeed(id: string, method: PaymentMethodLike = { type: "card", card: { brand: "visa", wallet: null } }) {
    const pi = this.require(id);
    pi.status = "succeeded";
    pi.amount_received = pi.amount;
    pi.last_payment_error = null;
    pi.payment_method = method;
  }

  /** Each call is a new attempt (a new failed charge), like a customer trying again. */
  decline(id: string, code = "card_declined") {
    const pi = this.require(id);
    pi.status = "requires_payment_method";
    pi.last_payment_error = { code, message: "Your card was declined.", charge: `ch_fake${++this.seq}`, payment_method_id: `pm_fake${this.seq}` };
  }

  process(id: string, method: PaymentMethodLike = { type: "mobilepay" }) {
    const pi = this.require(id);
    pi.status = "processing";
    pi.payment_method = method;
  }

  private require(id: string) {
    const pi = this.intents.get(id);
    if (!pi) throw new Error(`No such payment_intent: ${id}`);
    return pi;
  }
}

export function eventFor(pi: { id: string }, type: string, eventId = `evt_${Math.random().toString(36).slice(2)}`) {
  return { id: eventId, type, data: { object: { id: pi.id, object: "payment_intent" } } };
}
