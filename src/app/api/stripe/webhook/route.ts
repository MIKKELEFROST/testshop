import { checkoutDeps } from "@/lib/checkout/deps";
import { handleStripeEvent } from "@/lib/checkout/webhook";
import { ConfigError, stripeWebhookEnv } from "@/lib/env";
import { getStripe } from "@/lib/stripe/server";
import { revalidateCatalog, revalidateProduct } from "@/lib/woocommerce/revalidate";

/**
 * POST /api/stripe/webhook — Stripe → WooCommerce payment status.
 *
 * 1. Verify the Stripe signature on the raw body (rejects forged/modified events).
 * 2. Re-read the PaymentIntent from Stripe and apply its current state to the order.
 * 3. Return 500 on any processing error so Stripe retries; duplicates are harmless.
 */
export async function POST(request: Request) {
  let secret: string;
  try {
    secret = stripeWebhookEnv().STRIPE_WEBHOOK_SECRET;
  } catch (error) {
    if (error instanceof ConfigError) console.error("[stripe-webhook] configuration:", error.message);
    return Response.json({ received: false }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "missing signature" }, { status: 400 });

  const payload = await request.text();
  let event;
  try {
    event = getStripe().webhooks.constructEvent(payload, signature, secret);
  } catch {
    return Response.json({ error: "invalid signature" }, { status: 400 });
  }

  const result = await handleStripeEvent(event as unknown as Parameters<typeof handleStripeEvent>[0], checkoutDeps());

  // Paid and reserved orders change stock: refresh the affected product pages at once, the
  // lists (their stock marks) at most every 5 minutes (see lib/woocommerce/revalidate.ts).
  if (result.outcome?.type === "applied" && ["paid", "authorized", "on_hold", "cancelled"].includes(result.outcome.result)) {
    for (const item of result.outcome.order?.items ?? []) revalidateProduct(item.product_id);
    revalidateCatalog();
  }

  return Response.json(result.body, { status: result.status });
}
