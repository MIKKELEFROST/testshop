import { createRateLimiter } from "@/lib/security/rate-limit";
import { clientIp, rateLimited } from "@/lib/security/request";
import { getProductsByIds } from "@/lib/woocommerce/products";

/** GET /api/products?ids=12,34 — product cards for the favourites page (this shop's products only). */

const limiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

export async function GET(request: Request) {
  const limit = limiter.check(clientIp(request));
  if (!limit.allowed) return rateLimited(limit);

  const raw = new URL(request.url).searchParams.get("ids") ?? "";
  const ids = [...new Set(raw.split(",").map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 100);
  const result = await getProductsByIds(ids.sort((a, b) => a - b));
  if (!result.ok) return Response.json({ error: result.error }, { status: 503 });
  return Response.json({ products: result.data }, { headers: { "Cache-Control": "private, max-age=60" } });
}
