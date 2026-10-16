import { buildSuggestions, normalizeQuery, searchProducts } from "@/lib/search";
import { createRateLimiter } from "@/lib/security/rate-limit";
import { clientIp, rateLimited } from "@/lib/security/request";
import { getCategories, getProducts } from "@/lib/woocommerce/products";

/** GET /api/search?q=heks — suggestions for the search field (products, categories, themes). */

const limiter = createRateLimiter({ limit: 120, windowMs: 60_000 });

/** Searches per keystroke: the query, then one variant when it finds nothing (the search page tries more). */
const TRIES = 2;

export async function GET(request: Request) {
  const limit = limiter.check(clientIp(request));
  if (!limit.allowed) return rateLimited(limit);

  const q = normalizeQuery(new URL(request.url).searchParams.get("q"));
  if (q.length < 2) return Response.json({ products: [], links: [], searched: null });

  const [found, categories] = await Promise.all([
    searchProducts(q, (search) => getProducts({ search, perPage: 24 }), { tries: TRIES }),
    getCategories(),
  ]);
  if (!found.ok) return Response.json({ products: [], links: [], searched: null }, { status: 503 });
  const suggestions = buildSuggestions(q, found.data.list.products, categories.ok ? categories.data : [], found.data.searched);
  return Response.json(suggestions, { headers: { "Cache-Control": "public, max-age=60" } });
}
