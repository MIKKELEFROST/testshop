import { buildSuggestions, normalizeQuery } from "@/lib/search";
import { createRateLimiter } from "@/lib/security/rate-limit";
import { clientIp, rateLimited } from "@/lib/security/request";
import { getCategories, getProducts } from "@/lib/woocommerce/products";

/** GET /api/search?q=heks — suggestions for the search field (products, categories, themes). */

const limiter = createRateLimiter({ limit: 120, windowMs: 60_000 });

export async function GET(request: Request) {
  const limit = limiter.check(clientIp(request));
  if (!limit.allowed) return rateLimited(limit);

  const q = normalizeQuery(new URL(request.url).searchParams.get("q"));
  if (q.length < 2) return Response.json({ products: [], links: [] });

  const [products, categories] = await Promise.all([getProducts({ search: q, perPage: 24 }), getCategories()]);
  if (!products.ok) return Response.json({ products: [], links: [] }, { status: 503 });
  const suggestions = buildSuggestions(q, products.data.products, categories.ok ? categories.data : []);
  return Response.json(suggestions, { headers: { "Cache-Control": "public, max-age=60" } });
}
