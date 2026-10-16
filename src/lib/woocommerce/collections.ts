import "server-only";
import { findCollection, merchandising } from "@/config/merchandising";
import type { Loadable, ProductCategory, ProductList, ProductSummary } from "@/types/commerce";
import type { ListingScope } from "./filters";
import {
  PAGE_SIZE,
  collectionQuery,
  getCategories,
  getPluginFeatures,
  getProductBySlug,
  getProducts,
  type ProductFilters,
  type ProductQuery,
  type SortKey,
} from "./products";

/**
 * Products for the shop's theme pages and front page tiles (src/config/merchandising.ts).
 * Every read goes through the cached catalogue functions.
 */

/** A page of a theme page's products; null when the theme does not exist in this shop (not when WooCommerce is unavailable). */
export async function getCollectionProducts(
  slug: string,
  options: ProductFilters & { page?: number; perPage?: number; sort?: SortKey } = {},
): Promise<Loadable<ProductList> | null> {
  const collection = findCollection(slug);
  if (!collection) return null;
  const query = await collectionQuery(collection);
  if (!query.ok) return query;
  if (!query.data) return null;
  return getProducts({ ...query.data, ...options });
}

/**
 * What a theme page lists, for its filters' choices (see ./filters.ts): its categories and
 * themes. Null when that can't be told (unknown theme, or WooCommerce can't be read).
 */
export async function getCollectionScope(slug: string): Promise<ListingScope | null> {
  const collection = findCollection(slug);
  const query = collection ? await collectionQuery(collection) : null;
  return query?.ok && query.data ? { categoryIds: query.data.categoryIds, tagIds: query.data.tagIds } : null;
}

/** The first products behind a link to a category or theme page (for a tile's photo). */
export async function getLinkProducts(href: string, perPage: number): Promise<ProductSummary[]> {
  const [, kind, slug] = href.split("/");
  if (kind === "tema" && slug) {
    const result = await getCollectionProducts(slug, { perPage });
    return result?.ok ? result.data.products : [];
  }
  if (kind === "kategori" && slug) {
    const categories = await getCategories();
    const category = categories.ok ? categories.data.find((c) => c.slug === slug) : undefined;
    if (!category) return [];
    const result = await getProducts({ categoryIds: [category.id], notInCategoryIds: hiddenCategoryIds(categories.ok ? categories.data : [], slug), perPage, hideAdult: true });
    return result.ok ? result.data.products : [];
  }
  return [];
}

/** Product cards for these slugs (unknown or unpublished ones are left out). */
export async function getProductsBySlug(slugs: string[]): Promise<ProductSummary[]> {
  const products = await Promise.all(slugs.map((slug) => getProductBySlug(slug)));
  return products.flatMap((p) => (p.ok && p.data ? [p.data] : []));
}

/** IDs of the shop's hidden categories (merchandising.hidden), except the one being shown. */
function hiddenCategoryIds(categories: ProductCategory[], shown: string): number[] {
  return categories.filter((c) => merchandising.hidden.includes(c.slug) && c.slug !== shown).map((c) => c.id);
}

/**
 * A page of a listing with the shop's season first (merchandising.seasonFirst): e.g. on the
 * Fastelavn shop's "Pigekostumer" the costumes that are not Halloween or Christmas, then
 * those. Only with the recommended sorting; other sortings, a listing of the season's own
 * categories and an older plugin (no category filters) get the plain listing.
 */
export async function getSeasonalProducts(query: ProductQuery & { page: number; sort: SortKey }): Promise<Loadable<ProductList>> {
  const { seasonFirst } = merchandising;
  const [categories, plugin] = await Promise.all([getCategories(), getPluginFeatures()]);
  const seasonIds = categories.ok ? categories.data.filter((c) => seasonFirst.categories.includes(c.slug)).map((c) => c.id) : [];
  const ownCategory = query.categoryIds?.some((id) => seasonIds.includes(id));
  if (query.sort !== "anbefalet" || !plugin.categoryFilters || seasonIds.length === 0 || ownCategory) return getProducts(query);

  const perPage = query.perPage ?? PAGE_SIZE;
  const start = (query.page - 1) * perPage;
  const inSeason: ProductQuery = { [seasonFirst.prefer === "in" ? "inAnyCategoryIds" : "notInCategoryIds"]: seasonIds };
  const rest: ProductQuery = { [seasonFirst.prefer === "in" ? "notInCategoryIds" : "inAnyCategoryIds"]: seasonIds };

  // The season's part by page, not by offset: WooCommerce reports the total (the season's
  // size) for an empty page past the end, but 0 for an empty offset read.
  const first = await getProducts({ ...query, ...inSeason, perPage });
  if (!first.ok) return first;
  const firstTotal = first.data.total;
  const missing = perPage - first.data.products.length;
  const second = await getProducts({ ...query, ...rest, page: 1, perPage: Math.max(missing, 1), offset: Math.max(0, start - firstTotal) });
  if (!second.ok) return second;

  const total = firstTotal + second.data.total;
  return {
    ok: true,
    data: {
      products: [...first.data.products, ...(missing > 0 ? second.data.products.slice(0, missing) : [])],
      total,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
      page: query.page,
    },
  };
}
