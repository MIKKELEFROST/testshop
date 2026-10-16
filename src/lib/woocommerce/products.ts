import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";
import { ACCESSORY_CATEGORY_SLUGS, ADULT_CATEGORY_SLUGS, RELATED_LIMIT } from "@/config/catalog";
import { merchandising, type Collection } from "@/config/merchandising";
import { storeConfig } from "@/config/store";
import { describeError } from "@/lib/log";
import { versionAtLeast } from "@/lib/version";
import type { Loadable, Product, ProductCategory, ProductList, ProductSummary } from "@/types/commerce";
import { wooRequest } from "./client";
import { categoryPath, primaryCategory } from "./category-tree";
import { decodeEntities, mapCategory, mapProduct, mapProductSummary } from "./mappers";
import { rankAccessories, rankSimilar } from "./related";
import { wcCategorySchema, wcProductSchema, wcVariationSchema } from "./schemas";

/**
 * Catalogue reads. Cached with `use cache: remote` (short lifetime + tags): one cache shared
 * by all server instances, so the WordPress host is asked once per lifetime instead of once
 * per cold instance (its web host refuses bursts with HTTP 508). Revalidated on demand by
 * WooCommerce webhooks (see /api/revalidate). Prices and stock shown here are informational:
 * the checkout always re-validates them against WooCommerce.
 *
 * Failures are cached only briefly, so a WooCommerce outage never sticks.
 *
 * Only this storefront's products are read: `wchc_shop` limits the results to the products
 * of its webshop in WooCommerce (Headless Checkout Bridge 1.2+). A store ID that is not a
 * webshop there sees every product.
 */

export const CATALOG_TAG = "wc-catalog";
export const productTag = (id: number) => `wc-product-${id}`;

const UNAVAILABLE = "Vi kan ikke hente produkterne lige nu. Prøv igen om lidt.";

/**
 * Lifetime for a failed read: retried after 30 s. (Kept at the 5-minute "expire" minimum so
 * Next.js can still prerender the friendly error state, e.g. when building without access.)
 */
const FAILURE_LIFE = { stale: 30, revalidate: 30, expire: 300 };

const SHOP = { wchc_shop: storeConfig.id };

/** Products per listing page: whole rows of 5 (desktop), 3 and 2 columns. */
export const PAGE_SIZE = 30;

/** What a product card needs; keeps listing responses small (no descriptions). */
const SUMMARY_FIELDS = [
  "id", "name", "slug", "type", "status", "price", "regular_price", "sale_price", "on_sale", "purchasable",
  "stock_status", "stock_quantity", "manage_stock", "backorders_allowed", "categories", "attributes", "images", "headless_prices",
  "meta_data",
].join(",");

/** Product cards for the related rows also need the themes, to rank them. */
const RELATED_FIELDS = `${SUMMARY_FIELDS},tags`;

/**
 * Category counts are recounted every 15 minutes (one small request per category), not
 * every minute like product lists.
 */
const CATEGORY_LIFE = { stale: 300, revalidate: 900, expire: 86400 };

/** How a listing is sorted (the `sorter` URL parameter); the first is the default. */
export const SORTS = {
  // The shop's merchandising order: WooCommerce's menu order, which the Guirca importer sets
  // by kind of product (costumes first, then masks, wigs, hats and blood, other accessories,
  // decorations; newest first within each), then the name. On category pages and "Alle
  // produkter" the season's products come first (see getSeasonalProducts).
  anbefalet: { label: "Anbefalet", orderby: "menu_order", order: "asc" },
  nyeste: { label: "Nyeste", orderby: "date", order: "desc" },
  populaere: { label: "Mest populære", orderby: "popularity", order: "desc" },
  "pris-lav": { label: "Pris: lav til høj", orderby: "price", order: "asc" },
  "pris-hoej": { label: "Pris: høj til lav", orderby: "price", order: "desc" },
} as const;

export type SortKey = keyof typeof SORTS;

export function parseSort(value: string | string[] | undefined): SortKey {
  const key = Array.isArray(value) ? value[0] : value;
  return key && key in SORTS ? (key as SortKey) : "anbefalet";
}

export type ProductQuery = {
  /** Products in any of these categories (a category includes its subcategories' products). */
  categoryIds?: number[];
  /** … that are also in every one of these (plugin 1.4+, see getPluginFeatures). */
  alsoInCategoryIds?: number[];
  /** … that are in none of these (plugin 1.4+; with an older plugin they are filtered out of each page). */
  notInCategoryIds?: number[];
  /** … that are in one of these (plugin 1.4+). */
  inAnyCategoryIds?: number[];
  /** … with any of these themes (tag IDs). */
  tagIds?: number[];
  search?: string;
  /** Only these products (in this order). */
  include?: number[];
  /** Leave out adult-only (18+) products. Listings do; their own category and search don't. */
  hideAdult?: boolean;
  sort?: SortKey;
  page?: number;
  perPage?: number;
  /** Skip this many products (instead of whole pages). */
  offset?: number;
};

/** A page of this shop's published products. */
export async function getProducts(options: ProductQuery = {}): Promise<Loadable<ProductList>> {
  "use cache: remote";
  cacheTag(CATALOG_TAG);

  const page = options.page ?? 1;
  const sort = SORTS[options.sort ?? "anbefalet"];
  const list = (ids: number[] | undefined) => (ids && ids.length > 0 ? ids.join(",") : undefined);
  try {
    const adult = options.hideAdult ? await getAdultProductIds() : [];
    const { data, headers } = await wooRequest("wc/v3/products", {
      query: {
        ...SHOP,
        status: "publish",
        per_page: options.perPage ?? PAGE_SIZE,
        page,
        offset: options.offset,
        ...(options.include ? { include: list(options.include), orderby: "include" } : { orderby: sort.orderby, order: sort.order }),
        category: list(options.categoryIds),
        wchc_in_category: list(options.alsoInCategoryIds),
        wchc_not_in_category: list(options.notInCategoryIds),
        wchc_in_any_category: list(options.inAnyCategoryIds),
        tag: list(options.tagIds),
        exclude: list(adult),
        search: options.search || undefined,
        _fields: SUMMARY_FIELDS,
      },
      schema: z.array(wcProductSchema),
    });
    const hidden = new Set(options.notInCategoryIds);
    cacheLife("minutes");
    return {
      ok: true,
      data: {
        products: data.map(mapProductSummary).filter((p) => !p.categories.some((c) => hidden.has(c.id))),
        total: Number(headers.get("x-wp-total") ?? data.length),
        totalPages: Number(headers.get("x-wp-totalpages") ?? 1),
        page,
      },
    };
  } catch (error) {
    logCatalogError("getProducts", error);
    cacheLife(FAILURE_LIFE);
    return { ok: false, error: UNAVAILABLE };
  }
}

/** IDs of this shop's adult-only (18+) products, to leave them out of general listings. */
async function getAdultProductIds(): Promise<number[]> {
  "use cache: remote";
  cacheTag(CATALOG_TAG);
  const categories = await getCategories();
  if (!categories.ok) throw new Error(categories.error);
  const adult = categories.data.filter((c) => ADULT_CATEGORY_SLUGS.includes(c.slug)).map((c) => c.id);
  if (adult.length === 0) {
    cacheLife("hours");
    return [];
  }
  const { data } = await wooRequest("wc/v3/products", {
    query: { ...SHOP, status: "publish", category: adult.join(","), per_page: 100, _fields: "id" },
    schema: z.array(z.object({ id: z.number() })),
  });
  cacheLife("hours");
  return data.map((p) => p.id);
}

/** This shop's themes (WooCommerce product tags), name -> ID. */
export async function getThemeIds(): Promise<Loadable<Map<string, number>>> {
  "use cache: remote";
  cacheTag(CATALOG_TAG);
  try {
    const tags = new Map<string, number>();
    for (let page = 1; page <= 10; page++) {
      const { data, headers } = await wooRequest("wc/v3/products/tags", {
        query: { per_page: 100, page, hide_empty: true, _fields: "id,name" },
        schema: z.array(z.object({ id: z.number(), name: z.string() })),
      });
      for (const tag of data) tags.set(decodeEntities(tag.name), tag.id);
      if (page >= Number(headers.get("x-wp-totalpages") ?? 1)) break;
    }
    cacheLife(CATEGORY_LIFE);
    return { ok: true, data: tags };
  } catch (error) {
    logCatalogError("getThemeIds", error);
    cacheLife(FAILURE_LIFE);
    return { ok: false, error: UNAVAILABLE };
  }
}

/**
 * What the WooCommerce plugin can do (Headless Checkout Bridge, from its status endpoint):
 * 1.4 filters products by more categories and counts a shop's products per category in one request.
 */
export async function getPluginFeatures(): Promise<{ categoryFilters: boolean }> {
  "use cache: remote";
  try {
    const { data } = await wooRequest("wc-headless/v1/status", { schema: z.object({ version: z.string() }).loose() });
    cacheLife("hours");
    return { categoryFilters: versionAtLeast(data.version, "1.4.0") };
  } catch (error) {
    logCatalogError("getPluginFeatures", error);
    cacheLife(FAILURE_LIFE);
    return { categoryFilters: false };
  }
}

/**
 * The query for a theme page (src/config/merchandising.ts): null when none of its categories
 * or themes exist in this shop, an error when WooCommerce can't be read right now.
 */
export async function collectionQuery(collection: Collection): Promise<Loadable<ProductQuery | null>> {
  const [categories, themes, plugin] = await Promise.all([getCategories(), getThemeIds(), getPluginFeatures()]);
  if (!categories.ok) return categories;
  if (!themes.ok) return themes;
  const idsOf = (slugs: string[] | undefined) =>
    (slugs ?? []).map((slug) => categories.data.find((c) => c.slug === slug)?.id).filter((id): id is number => id !== undefined);
  const themeIds = (names: string[] | undefined) => (names ?? []).map((n) => themes.data.get(n)).filter((id): id is number => id !== undefined);

  const categoryIds = idsOf(collection.categories);
  if (collection.categories?.length && categoryIds.length === 0) return { ok: true, data: null };
  let tagIds = themeIds(collection.themes);
  if (collection.themes?.length && tagIds.length === 0) return { ok: true, data: null };
  let alsoInCategoryIds: number[] = [];
  if (collection.alsoIn?.length) {
    if (plugin.categoryFilters) alsoInCategoryIds = idsOf(collection.alsoIn);
    // An older plugin ignores "also in": narrow by the fallback themes instead (unless the page has themes).
    else if (tagIds.length === 0) tagIds = themeIds(collection.alsoInFallbackThemes);
  }
  // The shop's hidden categories (e.g. Halloween in the Fastelavn shop), unless the theme is about them.
  const wanted = new Set([...(collection.categories ?? []), ...(collection.alsoIn ?? [])]);
  const notInCategoryIds = idsOf(merchandising.hidden.filter((slug) => !wanted.has(slug)));
  return { ok: true, data: { categoryIds, alsoInCategoryIds, notInCategoryIds, tagIds, hideAdult: true } };
}

/** Slugs of all this shop's published products (for the sitemap); refreshed a few times a day. */
export async function getAllProductSlugs(): Promise<string[]> {
  "use cache: remote";
  cacheTag(CATALOG_TAG);
  try {
    const slugs: string[] = [];
    for (let page = 1; page <= 200; page++) {
      const { data, headers } = await wooRequest("wc/v3/products", {
        query: { ...SHOP, status: "publish", per_page: 100, page, orderby: "id", order: "asc", _fields: "slug" },
        schema: z.array(z.object({ slug: z.string() })),
        timeoutMs: 30_000,
      });
      slugs.push(...data.map((p) => p.slug));
      if (page >= Number(headers.get("x-wp-totalpages") ?? 1)) break;
    }
    cacheLife("hours");
    return slugs;
  } catch (error) {
    logCatalogError("getAllProductSlugs", error);
    cacheLife(FAILURE_LIFE);
    return [];
  }
}

/** Product cards for these IDs (e.g. the favourites), in that order; unknown IDs are left out. */
export async function getProductsByIds(ids: number[]): Promise<Loadable<ProductSummary[]>> {
  if (ids.length === 0) return { ok: true, data: [] };
  const result = await getProducts({ include: ids.slice(0, 100), perPage: 100 });
  return result.ok ? { ok: true, data: result.data.products } : result;
}

export async function getProductBySlug(slug: string): Promise<Loadable<Product | null>> {
  "use cache: remote";
  cacheTag(CATALOG_TAG);

  try {
    const { data } = await wooRequest("wc/v3/products", {
      query: { ...SHOP, slug, status: "publish" },
      schema: z.array(wcProductSchema),
    });
    const product = data[0];
    if (!product) {
      cacheLife("minutes");
      return { ok: true, data: null };
    }
    cacheTag(productTag(product.id));

    const variations =
      product.type === "variable"
        ? (
            await wooRequest(`wc/v3/products/${product.id}/variations`, {
              query: { per_page: 100, status: "publish" },
              schema: z.array(wcVariationSchema),
            })
          ).data
        : [];

    cacheLife("minutes");
    return { ok: true, data: mapProduct(product, variations) };
  } catch (error) {
    logCatalogError("getProductBySlug", error);
    cacheLife(FAILURE_LIFE);
    return { ok: false, error: UNAVAILABLE };
  }
}

export type RelatedProducts = { accessories: ProductSummary[]; similar: ProductSummary[] };

/**
 * "Relevant tilbehør" and "Lignende produkter" for a product page.
 *
 * - Accessories: products in the accessory categories (ACCESSORY_CATEGORY_SLUGS) with one of
 *   the product's themes; if there are too few, accessories from the product's other
 *   categories (e.g. Halloween). One of each kind first (see rankAccessories).
 * - Similar: products in the product's most specific category, those with its themes first.
 *
 * Both prefer the product's target group. A failure only hides the rows.
 */
export async function getRelatedProducts(product: Pick<Product, "id" | "tags" | "audience" | "categories">): Promise<RelatedProducts> {
  "use cache: remote";
  cacheTag(CATALOG_TAG, productTag(product.id));

  try {
    const categories = await getCategories();
    if (!categories.ok) throw new Error(categories.error);
    const tree = categories.data;
    const roots = tree.filter((c) => c.parent === 0 && ACCESSORY_CATEGORY_SLUGS.includes(c.slug));
    const rootIds = new Set(roots.map((c) => c.id));
    // Accessory category -> its kind (the subcategory directly below the accessory root).
    const kindOf = new Map<number, number>();
    for (const category of tree) {
      const path = categoryPath(tree, category);
      if (path[0] && rootIds.has(path[0].id)) kindOf.set(category.id, path[1]?.id ?? path[0].id);
    }
    const accessoryKind = (p: ProductSummary) => p.categories.map((c) => kindOf.get(c.id)).find((k) => k !== undefined && !rootIds.has(k)) ?? 0;
    const isAccessory = (p: ProductSummary) => p.categories.some((c) => kindOf.has(c.id));
    const tagIds = product.tags.map((t) => t.id).join(",");

    let accessories: ProductSummary[] = [];
    if (roots.length > 0) {
      const byTheme = tagIds ? await relatedQuery({ category: [...rootIds].join(","), tag: tagIds, per_page: 48 }, product.id) : [];
      accessories = rankAccessories(product, byTheme, accessoryKind, RELATED_LIMIT);
      if (accessories.length < RELATED_LIMIT / 2) {
        // Too few with the same themes: accessories from the product's other categories (e.g. Halloween).
        const others = product.categories.filter((c) => !kindOf.has(c.id)).map((c) => c.id);
        if (others.length > 0) {
          const nearby = (await relatedQuery({ category: others.join(","), per_page: 100 }, product.id)).filter(isAccessory);
          accessories = rankAccessories(product, [...byTheme, ...nearby], accessoryKind, RELATED_LIMIT);
        }
      }
    }

    const primary = primaryCategory(tree, product.categories);
    let similar: ProductSummary[] = [];
    if (primary) {
      const shown = new Set(accessories.map((p) => p.id));
      const byTheme = tagIds ? await relatedQuery({ category: primary.id, tag: tagIds, per_page: 24 }, product.id) : [];
      similar = rankSimilar(product, byTheme, RELATED_LIMIT, shown);
      if (similar.length < RELATED_LIMIT) {
        const sameCategory = await relatedQuery({ category: primary.id, per_page: 24 }, product.id);
        similar = rankSimilar(product, [...byTheme, ...sameCategory], RELATED_LIMIT, shown);
      }
    }

    cacheLife("hours");
    return { accessories, similar };
  } catch (error) {
    logCatalogError("getRelatedProducts", error);
    cacheLife(FAILURE_LIFE);
    return { accessories: [], similar: [] };
  }
}

/** This shop's published products for a related row, best sellers first. */
async function relatedQuery(query: Record<string, string | number>, excludeId: number): Promise<ProductSummary[]> {
  const { data } = await wooRequest("wc/v3/products", {
    query: { ...SHOP, status: "publish", orderby: "popularity", exclude: excludeId, _fields: RELATED_FIELDS, ...query },
    schema: z.array(wcProductSchema),
  });
  return data.map(mapProductSummary).filter((p) => !p.adult);
}

/** This shop's categories (with products), each with the shop's own product count. */
export async function getCategories(): Promise<Loadable<ProductCategory[]>> {
  "use cache: remote";
  cacheTag(CATALOG_TAG);

  try {
    const categories: z.infer<typeof wcCategorySchema>[] = [];
    for (let page = 1; page <= 10; page++) {
      const { data, headers } = await wooRequest("wc/v3/products/categories", {
        query: { per_page: 100, page, hide_empty: true },
        schema: z.array(wcCategorySchema),
      });
      categories.push(...data);
      if (page >= Number(headers.get("x-wp-totalpages") ?? 1)) break;
    }
    // WooCommerce counts every webshop's products; count (and show) only this shop's: in one
    // request with plugin 1.4, else one small request per category.
    const counts = await shopCategoryCounts(categories.map((c) => c.id));
    cacheLife(CATEGORY_LIFE);
    return {
      ok: true,
      data: categories
        .map((c, i) => ({ ...mapCategory(c), count: counts[i] ?? 0 }))
        .filter((c) => c.slug !== "uncategorized" && c.count > 0),
    };
  } catch (error) {
    logCatalogError("getCategories", error);
    cacheLife(FAILURE_LIFE);
    return { ok: false, error: UNAVAILABLE };
  }
}

/** This shop's number of published products per category (subcategories included), in the order given. */
async function shopCategoryCounts(categoryIds: number[]): Promise<number[]> {
  const plugin = await getPluginFeatures();
  if (plugin.categoryFilters) {
    const { data } = await wooRequest(`wc-headless/v1/shops/${encodeURIComponent(storeConfig.id)}/category-counts`, {
      schema: z.record(z.string(), z.number()),
    });
    return categoryIds.map((id) => data[String(id)] ?? 0);
  }
  return mapWithLimit(categoryIds, 3, (id) => countProducts(id));
}

/** Number of this shop's published products in a category (subcategories included). */
async function countProducts(categoryId: number): Promise<number> {
  const { headers } = await wooRequest("wc/v3/products", {
    query: { ...SHOP, status: "publish", category: categoryId, per_page: 1, _fields: "id" },
    schema: z.array(z.object({ id: z.number() })),
  });
  return Number(headers.get("x-wp-total") ?? 0);
}

/** Like Promise.all(items.map(fn)), but at most `limit` requests at a time. */
async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function logCatalogError(operation: string, error: unknown) {
  // Messages from our client never contain credentials or customer data.
  console.error(`[catalog] ${operation} failed:`, describeError(error));
}
