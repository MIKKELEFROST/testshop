import { createHmac, timingSafeEqual } from "node:crypto";
import { revalidateCatalog, revalidateProduct } from "@/lib/woocommerce/revalidate";

/**
 * POST /api/revalidate — WooCommerce webhook target (product created/updated/deleted/restored).
 *
 * WooCommerce signs each delivery: X-WC-Webhook-Signature = base64(HMAC-SHA256(body, secret)).
 * On a valid call the changed product's cache entries (its page, its related rows, its photo)
 * are marked stale, so price and stock changes show up there within seconds; the next view
 * is served the old copy while the new one is read (`max`). A deleted or unpublished product's
 * entries expire at once instead: its next view is a 404, not the old product.
 *
 * The whole catalogue (lists, the menu's counts, the sitemap) is only marked stale when the
 * change can add or remove products from lists: a product created, deleted or restored, or
 * no longer published; and at most once per 5 minutes (see lib/woocommerce/revalidate.ts).
 */

/** The webhook topics that can change which products the lists have. */
const LIST_TOPICS = new Set(["product.created", "product.deleted", "product.restored"]);

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
  let json: { id?: unknown; parent_id?: unknown; status?: unknown };
  try {
    json = JSON.parse(body) as typeof json;
  } catch {
    return Response.json({ ok: true, ping: true });
  }
  if (typeof json !== "object" || json === null) return Response.json({ ok: true, ping: true });
  // A variation's change is its product's.
  const variation = typeof json.parent_id === "number" && json.parent_id > 0;
  const productId = variation ? (json.parent_id as number) : typeof json.id === "number" ? json.id : undefined;
  const topic = request.headers.get("x-wc-webhook-topic") ?? "";
  // A product (not a variation: a disabled size is "private") that is no longer published
  // leaves the shop, like a deleted one.
  const unpublished = !variation && typeof json.status === "string" && json.status !== "publish";
  if (productId) revalidateProduct(productId, !variation && (topic === "product.deleted" || unpublished));

  // An unknown topic (an older or odd sender) counts as a change to the lists.
  const changesLists = !topic.startsWith("product.") || LIST_TOPICS.has(topic) || unpublished;
  const catalog = changesLists && revalidateCatalog();
  return Response.json({ ok: true, product: productId ?? null, catalog });
}
