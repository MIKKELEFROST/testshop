import { checkoutDeps } from "@/lib/checkout/deps";
import { confirmationPath } from "@/lib/checkout/paths";
import { toClientQuote } from "@/lib/checkout/quote";
import { CheckoutError, startCheckout, type StartCheckoutOutcome } from "@/lib/checkout/service";
import { ensureCheckoutId, rotateCheckoutId } from "@/lib/checkout/session";
import { ConfigError } from "@/lib/env";
import { describeError } from "@/lib/log";
import { createRateLimiter } from "@/lib/security/rate-limit";
import { clientIp, isSameOrigin, jsonError, rateLimited, readJson } from "@/lib/security/request";
import { checkoutRequestSchema, fieldErrors } from "@/lib/validation/checkout";

/**
 * POST /api/checkout — called when the customer clicks "Betal".
 *
 * Validates the input, lets WooCommerce recalculate and create/return the pending order
 * (with stock reserved), and returns the client secret of the order's single
 * PaymentIntent. The browser never sends or decides any price.
 */

const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "forbidden", "Ugyldig forespørgsel.");

  const ip = clientIp(request);
  const limit = limiter.check(ip);
  if (!limit.allowed) return rateLimited(limit);

  const parsed = checkoutRequestSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return jsonError(400, "invalid_request", "Kontrollér de markerede felter.", { fields: fieldErrors(parsed.error) });
  }

  try {
    const deps = checkoutDeps();
    const context = { checkoutId: await ensureCheckoutId(), ip, userAgent: request.headers.get("user-agent") ?? undefined };
    let outcome = await startCheckout(parsed.data, context, deps);

    if (outcome.type === "new_session_required") {
      // The previous checkout of this browser was completed: start a fresh session for this cart.
      outcome = await startCheckout(parsed.data, { ...context, checkoutId: await rotateCheckoutId() }, deps);
    }

    return toResponse(outcome);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error("[checkout] configuration:", error.message);
      return jsonError(503, "not_configured", "Betaling er ikke konfigureret endnu.");
    }
    const retryable = !(error instanceof CheckoutError) || error.retryable;
    console.error("[checkout] failed:", describeError(error));
    return jsonError(503, "unavailable", retryable ? "Vi kan ikke gennemføre betalingen lige nu. Prøv igen om lidt." : "Betalingen kunne ikke startes.");
  }
}

function toResponse(outcome: StartCheckoutOutcome): Response {
  const headers = { "Cache-Control": "no-store" };
  switch (outcome.type) {
    case "ready":
      return Response.json(
        {
          type: "ready",
          clientSecret: outcome.clientSecret,
          order: { id: outcome.order.id, number: outcome.order.number, total: outcome.order.total, currency: outcome.order.currency },
          returnPath: confirmationPath(outcome.order.id, outcome.order.key),
        },
        { headers },
      );
    case "already_paid":
      return Response.json({ type: "already_paid", returnPath: confirmationPath(outcome.order.id, outcome.order.key) }, { headers });
    case "total_changed":
      return Response.json({ type: outcome.type, message: outcome.message, quote: toClientQuote(outcome.quote) }, { status: 409, headers });
    case "cart_invalid":
    case "out_of_stock":
    case "coupon_invalid":
      return Response.json(
        { type: outcome.type, message: outcome.message, quote: outcome.quote ? toClientQuote(outcome.quote) : null },
        { status: 409, headers },
      );
    case "busy":
      return Response.json({ type: "busy", message: outcome.message }, { status: 409, headers });
    case "new_session_required":
      return jsonError(409, "busy", "Prøv venligst igen.");
  }
}
