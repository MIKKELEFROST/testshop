import { after } from "next/server";
import { z } from "zod";
import { storeConfig } from "@/config/store";
import { settleDeps, settleSecret } from "@/lib/checkout/deps";
import { settleOrders, validSettleToken } from "@/lib/checkout/settle";
import { ConfigError } from "@/lib/env";
import { createRateLimiter } from "@/lib/security/rate-limit";
import { clientIp, jsonError, rateLimited, readJson } from "@/lib/security/request";

/**
 * POST /api/payments/settle — WordPress (the Headless Checkout Bridge plugin) → storefront, when
 * the shop has marked orders completed (sent) or cancelled them.
 *
 * Each order comes with the token this storefront gave the plugin when the payment was authorized
 * (lib/checkout/settle.ts). Orders with a valid token are accepted at once (202), and captured or
 * released after the answer, one at a time; the results reach WordPress as payment events. The
 * request itself decides nothing: the orders are re-read from WooCommerce and Stripe.
 */

export const maxDuration = 60;

// WordPress sends up to 10 orders per request, one request per status change or bulk action.
const limiter = createRateLimiter({ limit: 120, windowMs: 60_000 });

const settleRequestSchema = z.object({
  orders: z
    .array(z.object({ id: z.number().int().positive(), order_key: z.string().regex(/^wc_order_[A-Za-z0-9]+$/), token: z.string().max(100) }))
    .min(1)
    .max(50),
});

export async function POST(request: Request) {
  const limit = limiter.check(clientIp(request));
  if (!limit.allowed) return rateLimited(limit);

  const parsed = settleRequestSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError(400, "invalid_request", "Ugyldig forespørgsel.");

  let secret: string;
  try {
    secret = settleSecret();
  } catch (error) {
    if (error instanceof ConfigError) console.error("[settle] configuration:", error.message);
    return jsonError(503, "not_configured", "Betaling er ikke konfigureret.");
  }

  const accepted = parsed.data.orders.filter((o) => validSettleToken(secret, storeConfig.id, o.id, o.order_key, o.token));
  const rejected = parsed.data.orders.filter((o) => !accepted.includes(o)).map((o) => o.id);
  if (accepted.length === 0) return jsonError(401, "invalid_token", "Ugyldig token.", { accepted: [], rejected });

  const deps = settleDeps();
  // Within maxDuration; what is left is settled by the daily job.
  after(() => settleOrders(accepted.map((o) => ({ id: o.id, key: o.order_key })), deps, Date.now() + 50_000));

  return Response.json({ accepted: accepted.map((o) => o.id), rejected }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
