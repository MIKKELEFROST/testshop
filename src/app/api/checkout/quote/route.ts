import { readCheckoutId } from "@/lib/checkout/session";
import { toClientQuote } from "@/lib/checkout/quote";
import { ConfigError } from "@/lib/env";
import { createRateLimiter } from "@/lib/security/rate-limit";
import { clientIp, isSameOrigin, jsonError, rateLimited, readJson } from "@/lib/security/request";
import { quoteRequestSchema } from "@/lib/validation/checkout";
import { fetchQuote } from "@/lib/woocommerce/checkout-api";

/**
 * POST /api/checkout/quote — authoritative prices, stock, tax and shipping for a cart,
 * calculated by WooCommerce. Creates nothing.
 */

const limiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "forbidden", "Ugyldig forespørgsel.");

  const limit = limiter.check(clientIp(request));
  if (!limit.allowed) return rateLimited(limit);

  const parsed = quoteRequestSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError(400, "invalid_request", "Ugyldig kurv.");

  const { items, address, shippingRateId } = parsed.data;

  try {
    const quote = await fetchQuote({
      items: items.map((i) => ({ product_id: i.productId, variation_id: i.variationId, quantity: i.quantity })),
      address: {
        country: address.country,
        postcode: address.postcode,
        city: address.city,
        address_1: address.address1,
      },
      shipping_rate_id: shippingRateId ?? null,
      checkout_id: await readCheckoutId(),
    });
    return Response.json(toClientQuote(quote), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error("[quote] configuration:", error.message);
      return jsonError(503, "not_configured", "Butikken er ikke konfigureret endnu.");
    }
    console.error("[quote] failed:", error instanceof Error ? error.message : "unknown error");
    return jsonError(503, "backend_unavailable", "Vi kan ikke beregne priser lige nu. Prøv igen om lidt.");
  }
}
