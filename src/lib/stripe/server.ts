import "server-only";
import Stripe from "stripe";
import { stripeEnv } from "@/lib/env";
import { PAYABLE_STATUSES, type PaymentGateway, type PaymentIntentLike } from "./gateway";

let client: Stripe | undefined;

/** Lazily created so builds work without secrets. */
export function getStripe(): Stripe {
  client ??= new Stripe(stripeEnv().STRIPE_SECRET_KEY, {
    maxNetworkRetries: 2,
    timeout: 20_000,
    appInfo: { name: "headless-woo-checkout", version: "1.0.0" },
  });
  return client;
}

function toLike(pi: Stripe.PaymentIntent): PaymentIntentLike {
  const method = typeof pi.payment_method === "object" ? pi.payment_method : null;
  return {
    id: pi.id,
    status: pi.status,
    amount: pi.amount,
    amount_capturable: pi.amount_capturable,
    amount_received: pi.amount_received,
    currency: pi.currency,
    capture_method: pi.capture_method,
    cancellation_reason: pi.cancellation_reason,
    client_secret: pi.client_secret,
    metadata: { ...pi.metadata },
    last_payment_error: pi.last_payment_error
      ? {
          message: pi.last_payment_error.message ?? null,
          code: pi.last_payment_error.code ?? null,
          charge: pi.last_payment_error.charge ?? null,
          payment_method_id: pi.last_payment_error.payment_method?.id ?? null,
        }
      : null,
    payment_method: method
      ? {
          type: method.type,
          card: method.card ? { brand: method.card.brand, wallet: method.card.wallet?.type ?? null } : null,
        }
      : null,
  };
}

export const stripeGateway: PaymentGateway = {
  async retrieve(id) {
    return toLike(await getStripe().paymentIntents.retrieve(id, { expand: ["payment_method"] }));
  },

  async create(params, idempotencyKey) {
    const pi = await getStripe().paymentIntents.create(
      {
        amount: params.amount,
        currency: params.currency,
        capture_method: params.captureMethod,
        automatic_payment_methods: { enabled: true },
        metadata: params.metadata,
        description: params.description,
        // No receipt_email: Stripe would send its own receipt, with the account's (one) brand, next
        // to WooCommerce's order confirmation in the shop's name.
        statement_descriptor_suffix: params.statementDescriptorSuffix,
        shipping: params.shipping,
      },
      { idempotencyKey },
    );
    return toLike(pi);
  },

  async updateAmount(id, amount) {
    return toLike(await getStripe().paymentIntents.update(id, { amount }));
  },

  async cancelIfPossible(id) {
    const stripe = getStripe();
    const current = await stripe.paymentIntents.retrieve(id);
    if (!PAYABLE_STATUSES.includes(current.status) && current.status !== "requires_capture") return toLike(current);
    try {
      return toLike(await stripe.paymentIntents.cancel(id));
    } catch {
      // Lost a race (e.g. the customer just paid): report the real state.
      return toLike(await stripe.paymentIntents.retrieve(id));
    }
  },

  async capture(id, amount, idempotencyKey) {
    // With the payment method, as retrieve() has it: the order shows the method used.
    return toLike(await getStripe().paymentIntents.capture(id, { amount_to_capture: amount, expand: ["payment_method"] }, { idempotencyKey }));
  },

  async refund(paymentIntentId, idempotencyKey) {
    await getStripe().refunds.create({ payment_intent: paymentIntentId }, { idempotencyKey });
  },
};
