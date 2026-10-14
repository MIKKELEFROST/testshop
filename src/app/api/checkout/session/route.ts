import { rotateCheckoutId } from "@/lib/checkout/session";
import { isSameOrigin, jsonError } from "@/lib/security/request";

/** DELETE /api/checkout/session — start a fresh checkout session after a completed order. */
export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "forbidden", "Ugyldig forespørgsel.");
  await rotateCheckoutId();
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
