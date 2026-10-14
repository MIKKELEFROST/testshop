import { revalidateTag } from "next/cache";
import { checkoutDeps } from "@/lib/checkout/deps";
import { handleStripeEvent } from "@/lib/checkout/webhook";
import { ConfigError, stripeWebhookEnv } from "@/lib/env";
import { getStripe } from "@/lib/stripe/server";
import { CATALOG_TAG, productTag } from "@/lib/woocommerce/products";

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

  // Paid orders change stock: refresh the affected product pages.
  if (result.outcome?.type === "applied" && ["paid", "on_hold", "cancelled"].includes(result.outcome.result)) {
    revalidateTag(CATALOG_TAG, "max");
    for (const item of result.outcome.order?.items ?? []) revalidateTag(productTag(item.product_id), "max");
  }

  return Response.json(result.body, { status: result.status });
}
