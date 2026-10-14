import { createHmac, timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { CATALOG_TAG, productTag } from "@/lib/woocommerce/products";

/**
 * POST /api/revalidate — WooCommerce webhook target (product created/updated/deleted).
 *
 * WooCommerce signs each delivery: X-WC-Webhook-Signature = base64(HMAC-SHA256(body, secret)).
 * On a valid call the catalogue cache is marked stale, so price and stock changes in
 * WooCommerce show up in the storefront within seconds.
 */
export async function POST(request: Request) {
  const secret = process.env.WOOCOMMERCE_WEBHOOK_SECRET?.trim();
  if (!secret) return Response.json({ error: "not configured" }, { status: 503 });

  const body = await request.text();
  const signature = request.headers.get("x-wc-webhook-signature") ?? "";
  const expected = createHmac("sha256", secret).update(body, "utf8").digest("base64");

  const valid =
    signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) return Response.json({ error: "invalid signature" }, { status: 401 });

  // WooCommerce sends a form-encoded "webhook_id=…" ping when a webhook is created.
  let productId: number | undefined;
  try {
    const json = JSON.parse(body) as { id?: unknown; parent_id?: unknown };
    productId = typeof json.parent_id === "number" && json.parent_id > 0 ? json.parent_id : typeof json.id === "number" ? json.id : undefined;
  } catch {
    return Response.json({ ok: true, ping: true });
  }

  revalidateTag(CATALOG_TAG, "max");
  if (productId) revalidateTag(productTag(productId), "max");
  return Response.json({ ok: true });
}
