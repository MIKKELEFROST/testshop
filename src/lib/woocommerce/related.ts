import type { ProductSummary } from "@/types/commerce";

/**
 * Ranking for the product page's "Relevant tilbehør" and "Lignende produkter": products that
 * share the product's themes (tags) come first, then those for the same target group. Pure
 * functions; the candidates are fetched in products.ts.
 */

type Profile = Pick<ProductSummary, "id" | "tags" | "audience">;

const KIDS = new Set(["Piger", "Drenge", "Baby"]);
const ADULTS = new Set(["Damer", "Herrer"]);

function ageGroup(audience: string[]): "kids" | "adults" | null {
  const kids = audience.some((a) => KIDS.has(a));
  const adults = audience.some((a) => ADULTS.has(a));
  return kids === adults ? null : kids ? "kids" : "adults";
}

/** Higher is more relevant: 3 per shared theme, +2 for the same target group, −2 for children vs adults. */
export function relevance(product: Profile, candidate: ProductSummary): number {
  const themes = new Set(product.tags.map((t) => t.id));
  let score = 3 * candidate.tags.filter((t) => themes.has(t.id)).length;
  if (candidate.audience.some((a) => product.audience.includes(a))) score += 2;
  else {
    const mine = ageGroup(product.audience);
    const theirs = ageGroup(candidate.audience);
    if (mine && theirs && mine !== theirs) score -= 2;
  }
  return score;
}

/**
 * Which candidates fit the shop's season: none in the shop's hidden categories (e.g. Halloween
 * and Christmas in the Fastelavn shop) and none named like an off-season item (`offSeasonWords`,
 * e.g. "flagermus" or "nisse"). A product that is off-season itself (in a hidden category, or
 * named like one: a skeleton costume) keeps its own kind. `hiddenCategoryIds` returns the
 * categories still left out.
 */
export function seasonFilter(
  product: { name: string; categories: { id: number }[] },
  hiddenCategoryIds: number[],
  offSeasonWords?: RegExp,
): { hiddenCategoryIds: number[]; fits: (candidate: ProductSummary) => boolean } {
  const own = new Set(product.categories.map((c) => c.id));
  const hidden = hiddenCategoryIds.filter((id) => !own.has(id));
  const offSeason = hidden.length < hiddenCategoryIds.length || Boolean(offSeasonWords?.test(product.name));
  const words = offSeason ? undefined : offSeasonWords;
  return {
    hiddenCategoryIds: hidden,
    fits: (candidate) => !candidate.categories.some((c) => hidden.includes(c.id)) && !words?.test(candidate.name),
  };
}

/** Candidates worth showing: not the product itself, not sold out, each product once. */
function usable(product: Profile, candidates: ProductSummary[], exclude: ReadonlySet<number>): ProductSummary[] {
  const seen = new Set<number>([product.id, ...exclude]);
  return candidates.filter((c) => {
    if (seen.has(c.id) || c.stockStatus === "outofstock") return false;
    seen.add(c.id);
    return true;
  });
}

function scored(product: Profile, candidates: ProductSummary[], exclude: ReadonlySet<number>) {
  return usable(product, candidates, exclude)
    .map((candidate, index) => ({ candidate, index, score: relevance(product, candidate) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
}

/** Most relevant first; ties keep WooCommerce's order. */
export function rankSimilar(product: Profile, candidates: ProductSummary[], limit: number, exclude: ReadonlySet<number> = new Set()) {
  return scored(product, candidates, exclude)
    .slice(0, limit)
    .map((r) => r.candidate);
}

/** One of each kind per round, kinds in the order of their best product. */
function interleave(products: ProductSummary[], kindOf: (product: ProductSummary) => string | number): ProductSummary[] {
  const kinds = new Map<string | number, ProductSummary[]>();
  for (const product of products) kinds.set(kindOf(product), [...(kinds.get(kindOf(product)) ?? []), product]);
  const queues = [...kinds.values()];
  const result: ProductSummary[] = [];
  for (let round = 0; result.length < products.length; round++) {
    for (const queue of queues) if (queue[round]) result.push(queue[round]!);
  }
  return result;
}

/**
 * Accessories: most relevant first, but one of each kind (a hat, a wig, a mask …) before a
 * second of any kind, so the row completes the outfit instead of showing eight hats.
 * `kindOf` names the kind, e.g. the accessory's subcategory. Accessories for the other age
 * group (negative relevance) only fill up the end.
 */
export function rankAccessories(
  product: Profile,
  candidates: ProductSummary[],
  kindOf: (candidate: ProductSummary) => string | number,
  limit: number,
): ProductSummary[] {
  const ranked = scored(product, candidates, new Set());
  const fitting = ranked.filter((r) => r.score >= 0).map((r) => r.candidate);
  const others = ranked.filter((r) => r.score < 0).map((r) => r.candidate);
  return [...interleave(fitting, kindOf), ...interleave(others, kindOf)].slice(0, limit);
}
