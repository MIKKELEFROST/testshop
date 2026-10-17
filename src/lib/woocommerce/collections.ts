import "server-only";
import { findCollection, merchandising } from "@/config/merchandising";
import type { Loadable, ProductCategory, ProductList, ProductSummary } from "@/types/commerce";
import type { ListingScope } from "./filters";
import {
  PAGE_SIZE,
  collectionQuery,
  getCategories,
  getPluginFeatures,
  getProductPhoto,
  getProducts,
  type ProductFilters,
  type ProductPhoto,
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

/** The photos of these products (slugs, see getProductPhoto), in that order; unknown or unpublished ones are left out. */
export async function getProductPhotos(slugs: string[]): Promise<ProductPhoto[]> {
  const photos = await Promise.all(slugs.map((slug) => getProductPhoto(slug)));
  return photos.filter((photo) => photo !== null);
}

/** IDs of the shop's hidden categories (merchandising.hidden), except the one being shown. */
function hiddenCategoryIds(categories: ProductCategory[], shown: string): number[] {
  return categories.filter((c) => merchandising.hidden.includes(c.slug) && c.slug !== shown).map((c) => c.id);
}

/**
 * A page of a listing with the shop's season first (merchandising.seasonFirst), and the shop's
 * hidden categories (merchandising.hidden) last: e.g. on the Fastelavn shop's "Pigekostumer" the
 * costumes that are not Halloween or Christmas, then those; on the Halloween shop's "Gadgets og
 * sjov" the Halloween products, then the others, and the Christmas ones only after them. Only
 * with the recommended sorting; other sortings, a listing of the season's own categories and an
 * older plugin (no category filters) get the plain listing.
 */
export async function getSeasonalProducts(query: ProductQuery & { page: number; sort: SortKey }): Promise<Loadable<ProductList>> {
  const { seasonFirst } = merchandising;
  const [categories, plugin] = await Promise.all([getCategories(), getPluginFeatures()]);
  const seasonIds = categories.ok ? categories.data.filter((c) => seasonFirst.categories.includes(c.slug)).map((c) => c.id) : [];
  const ownCategory = query.categoryIds?.some((id) => seasonIds.includes(id));
  if (query.sort !== "anbefalet" || !plugin.categoryFilters || seasonIds.length === 0 || ownCategory) return getProducts(query);

  // A hidden category being listed itself (e.g. /kategori/jul-og-nytaar) is not put last.
  const hiddenIds = categories.ok
    ? categories.data.filter((c) => merchandising.hidden.includes(c.slug) && !query.categoryIds?.includes(c.id)).map((c) => c.id)
    : [];
  const parts = seasonalParts(seasonIds, hiddenIds, seasonFirst.prefer).map((part): ProductQuery => {
    const notInCategoryIds = union(query.notInCategoryIds, part.notInCategoryIds);
    return { ...query, ...part, ...(notInCategoryIds ? { notInCategoryIds } : {}) };
  });

  const perPage = query.perPage ?? PAGE_SIZE;
  const start = (query.page - 1) * perPage;
  // The first part by page, not by offset: WooCommerce reports the total (the part's size) for
  // an empty page past the end, but 0 for an empty offset read.
  const first = await getProducts({ ...parts[0]!, perPage });
  if (!first.ok) return first;
  const products = [...first.data.products];
  let before = first.data.total;
  for (const part of parts.slice(1)) {
    const missing = perPage - products.length;
    const offset = Math.max(0, start - before);
    const read = await getProducts({ ...part, page: 1, perPage: Math.max(missing, 1), offset });
    if (!read.ok) return read;
    let size = read.data.total;
    // Read wholly past its end (its total then says 0): the next part's offset needs its size.
    if (read.data.products.length === 0 && offset > 0) {
      const counted = await getProducts({ ...part, page: 1, perPage: 1 });
      if (!counted.ok) return counted;
      size = counted.data.total;
    }
    if (missing > 0) products.push(...read.data.products.slice(0, missing));
    before += size;
  }

  return {
    ok: true,
    data: { products, total: before, totalPages: Math.max(1, Math.ceil(before / perPage)), page: query.page },
  };
}

type Part = Pick<ProductQuery, "inAnyCategoryIds" | "notInCategoryIds">;

/**
 * The parts of a seasonal listing, in order, each product in exactly one: the season (or
 * everything outside it, with `prefer: "out"`), the rest except the hidden categories, then the
 * hidden categories. A part that is empty by definition is left out (no WooCommerce read): for
 * the Fastelavn shop, whose season categories are its hidden ones, that is the middle part.
 */
export function seasonalParts(seasonIds: number[], hiddenIds: number[], prefer: "in" | "out"): Part[] {
  const hidden = hiddenIds.filter((id) => prefer === "out" || !seasonIds.includes(id));
  const parts: Part[] =
    prefer === "in"
      ? [
          { inAnyCategoryIds: seasonIds },
          { notInCategoryIds: union(seasonIds, hidden) },
          ...(hidden.length > 0 ? [{ inAnyCategoryIds: hidden, notInCategoryIds: seasonIds }] : []),
        ]
      : [
          { notInCategoryIds: union(seasonIds, hidden) },
          // The season outside the hidden categories: nothing when they cover the season.
          ...(seasonIds.every((id) => hidden.includes(id)) ? [] : [{ inAnyCategoryIds: seasonIds, ...(hidden.length > 0 ? { notInCategoryIds: hidden } : {}) }]),
          ...(hidden.length > 0 ? [{ inAnyCategoryIds: hidden }] : []),
        ];
  return parts;
}

function union(a: number[] | undefined, b: number[] | undefined): number[] | undefined {
  const ids = [...new Set([...(a ?? []), ...(b ?? [])])];
  return ids.length > 0 ? ids : undefined;
}
