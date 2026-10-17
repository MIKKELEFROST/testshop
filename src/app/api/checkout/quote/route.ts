import { storeConfig } from "@/config/store";
import { readCheckoutId } from "@/lib/checkout/session";
import { toClientQuote } from "@/lib/checkout/quote";
import { quoteFailureResponse } from "@/lib/checkout/quote-retry";
import { ConfigError } from "@/lib/env";
import { describeError } from "@/lib/log";
import { createRateLimiter } from "@/lib/security/rate-limit";
import { clientIp, isSameOrigin, jsonError, rateLimited, readJson } from "@/lib/security/request";
import { quoteRequestSchema } from "@/lib/validation/checkout";
import { fetchQuote } from "@/lib/woocommerce/checkout-api";
import { WooCommerceError } from "@/lib/woocommerce/client";
import { getFreeShippingFrom } from "@/lib/woocommerce/shipping";

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

  const { items, address, shippingRateId, coupons, email } = parsed.data;

  try {
    const quote = await fetchQuote(
      {
        store_id: storeConfig.id,
        items: items.map((i) => ({ product_id: i.productId, variation_id: i.variationId, quantity: i.quantity })),
        address: {
          country: address.country,
          postcode: address.postcode,
          city: address.city,
          address_1: address.address1,
        },
        shipping_rate_id: shippingRateId ?? null,
        checkout_id: await readCheckoutId(),
        coupons,
        email,
      },
      // Aborted when the browser stops waiting (e.g. the customer typed on), so WooCommerce is not asked again for it.
      request.signal,
    );
    const freeShippingFrom = await getFreeShippingFrom();
    return Response.json({ ...toClientQuote(quote), freeShippingFrom }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Nobody reads the answer.
    if (request.signal.aborted) return new Response(null, { status: 499 });
    if (error instanceof ConfigError) {
      console.error("[quote] configuration:", error.message);
      return jsonError(503, "not_configured", "Butikken er ikke konfigureret endnu.");
    }
    console.error("[quote] failed:", describeError(error));
    const failure = quoteFailureResponse(error instanceof WooCommerceError ? error : { status: 0, code: "unknown" });
    return Response.json(
      { code: failure.code, message: "Vi kan ikke beregne priser lige nu. Prøv igen om lidt." },
      {
        status: failure.status,
        headers: { "Cache-Control": "no-store", ...(failure.retryAfter !== null ? { "Retry-After": String(failure.retryAfter) } : {}) },
      },
    );
  }
}
