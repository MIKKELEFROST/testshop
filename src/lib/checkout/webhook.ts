import { finalizePayment, type CheckoutDeps, type FinalizeOutcome } from "./service";

/** Stripe events that can change an order. Everything else is acknowledged and ignored. */
export const HANDLED_EVENT_TYPES = new Set([
  "payment_intent.succeeded",
  "payment_intent.processing",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
]);

export type StripeEventLike = { id: string; type: string; data: { object: { id?: string; object?: string } } };

export type WebhookResult = { status: number; body: Record<string, unknown>; outcome?: FinalizeOutcome };

/**
 * Handle a signature-verified Stripe event.
 *
 * Idempotency: we do not trust the event payload's snapshot or its ordering. The
 * PaymentIntent is re-read from Stripe and its *current* state is applied to WooCommerce,
 * whose state machine (behind a per-order lock) turns duplicates into no-ops. Replayed,
 * duplicated or out-of-order events therefore converge on the same result.
 *
 * Any failure returns 500 so Stripe retries (with backoff, for up to three days).
 */
export async function handleStripeEvent(event: StripeEventLike, deps: CheckoutDeps): Promise<WebhookResult> {
  if (!HANDLED_EVENT_TYPES.has(event.type)) {
    return { status: 200, body: { received: true, handled: false } };
  }

  const paymentIntentId = event.data.object.id;
  if (event.data.object.object !== "payment_intent" || !paymentIntentId) {
    return { status: 200, body: { received: true, handled: false } };
  }

  try {
    const paymentIntent = await deps.gateway.retrieve(paymentIntentId);
    const outcome = await finalizePayment(paymentIntent, deps);
    if (outcome.type === "needs_review") {
      console.error(`[stripe-webhook] ${event.id}: order needs manual review (${outcome.reason})`);
    }
    return { status: 200, body: { received: true, handled: true, outcome: outcome.type }, outcome };
  } catch (error) {
    console.error(`[stripe-webhook] ${event.id} (${event.type}) failed:`, error instanceof Error ? error.message : "unknown error");
    return { status: 500, body: { received: false } };
  }
}
