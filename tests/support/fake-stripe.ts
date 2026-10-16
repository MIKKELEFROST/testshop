import type { CreatePaymentIntentParams, PaymentGateway, PaymentIntentLike, PaymentMethodLike } from "@/lib/stripe/gateway";

/** An error as the Stripe SDK throws it (rawType and code). */
export class FakeStripeError extends Error {
  constructor(
    message: string,
    public readonly rawType: "card_error" | "invalid_request_error" | "idempotency_error" | "api_connection_error",
    public readonly code?: string,
  ) {
    super(message);
    this.name = "FakeStripeError";
  }
}

/**
 * In-memory stand-in for Stripe's PaymentIntents API with the behaviour the checkout
 * relies on: idempotency keys, cancel rules, amount updates, manual capture and refunds.
 */
export class FakeStripe implements PaymentGateway {
  intents = new Map<string, PaymentIntentLike>();
  private byIdempotencyKey = new Map<string, { id: string; params: string }>();
  private captures = new Map<string, { id: string; result?: PaymentIntentLike; error?: Error }>();
  private captureFailures = new Map<string, FakeStripeError>();
  refunds: { paymentIntentId: string; idempotencyKey: string }[] = [];
  /** What each PaymentIntent was created with, by id. */
  createParams = new Map<string, CreatePaymentIntentParams>();
  calls = { create: 0, update: 0, cancel: 0, capture: 0 };
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
      amount_capturable: 0,
      amount_received: 0,
      currency: params.currency,
      capture_method: params.captureMethod ?? "automatic",
      cancellation_reason: null,
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
      pi.amount_capturable = 0;
    }
    return structuredClone(pi);
  }

  /** Stripe's capture: once per PaymentIntent, at most the authorized amount; a key answers the same again. */
  async capture(id: string, amount: number, idempotencyKey: string) {
    const previous = this.captures.get(idempotencyKey);
    if (previous) {
      if (previous.id !== id) throw new FakeStripeError("Keys for idempotent requests can only be used with the same parameters", "idempotency_error");
      if (previous.error) throw previous.error;
      return structuredClone(previous.result!);
    }
    const pi = this.require(id);
    let error: FakeStripeError | undefined;
    if (pi.status !== "requires_capture") {
      error = new FakeStripeError(`This PaymentIntent could not be captured because it has a status of ${pi.status}.`, "invalid_request_error", "payment_intent_unexpected_state");
    } else if (amount > pi.amount_capturable) {
      error = new FakeStripeError("The amount to capture is larger than the amount capturable.", "invalid_request_error", "amount_too_large");
    } else {
      error = this.captureFailures.get(id);
      this.captureFailures.delete(id);
    }
    if (error) {
      this.captures.set(idempotencyKey, { id, error });
      throw error;
    }
    this.calls.capture += 1;
    pi.status = "succeeded";
    pi.amount_received = amount;
    pi.amount_capturable = 0;
    this.captures.set(idempotencyKey, { id, result: structuredClone(pi) });
    return structuredClone(pi);
  }

  async refund(paymentIntentId: string, idempotencyKey: string) {
    if (this.refunds.some((r) => r.idempotencyKey === idempotencyKey)) return;
    this.refunds.push({ paymentIntentId, idempotencyKey });
  }

  /**
   * What Stripe.js + the bank do when the customer confirms: a manual-capture PaymentIntent is
   * authorized (requires_capture), an automatic one paid.
   */
  confirm(id: string, method: PaymentMethodLike = { type: "card", card: { brand: "visa", wallet: null } }) {
    const pi = this.require(id);
    if (pi.capture_method !== "manual") return this.succeed(id, method);
    pi.status = "requires_capture";
    pi.amount_capturable = pi.amount;
    pi.last_payment_error = null;
    pi.payment_method = method;
  }

  /** The money is taken: paid at once (automatic capture), or captured in full (e.g. in Stripe's Dashboard). */
  succeed(id: string, method: PaymentMethodLike = { type: "card", card: { brand: "visa", wallet: null } }) {
    const pi = this.require(id);
    pi.status = "succeeded";
    pi.amount_received = pi.amount;
    pi.amount_capturable = 0;
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

  /** Stripe lets an uncaptured authorization expire (normally after 7 days). */
  expire(id: string) {
    const pi = this.require(id);
    pi.status = "canceled";
    pi.cancellation_reason = "automatic";
    pi.amount_capturable = 0;
  }

  /** The next capture of this PaymentIntent is refused (the authorization stays). */
  failNextCapture(id: string, code = "card_declined") {
    this.captureFailures.set(id, new FakeStripeError("Your card was declined.", "card_error", code));
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
