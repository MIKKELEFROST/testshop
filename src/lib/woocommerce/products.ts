import "server-only";
import { cacheTag } from "next/cache";
import { z } from "zod";
import { ACCESSORY_CATEGORY_SLUGS, ADULT_CATEGORY_SLUGS, RELATED_LIMIT } from "@/config/catalog";
import { merchandising, type Collection } from "@/config/merchandising";
import { storeConfig } from "@/config/store";
import { versionAtLeast } from "@/lib/version";
import type { Loadable, Product, ProductCategory, ProductList, ProductSummary } from "@/types/commerce";
import { HOURS, MINUTES, fetched, orFailure, type CacheLife, type Read } from "./cache";
import { wooRequest } from "./client";
import { categoryPath, primaryCategory } from "./category-tree";
import { decodeEntities, mapCategory, mapProduct, mapProductSummary, productImages } from "./mappers";
import { rankAccessories, rankSimilar, seasonFilter } from "./related";
import { wcCategorySchema, wcProductSchema, wcVariationSchema } from "./schemas";

/**
 * Catalogue reads. Cached with `use cache: remote` (short lifetime + tags): one cache shared
 * by all server instances, so the WordPress host is asked once per lifetime instead of once
 * per cold instance (its web host refuses bursts with HTTP 508). Revalidated on demand by
 * WooCommerce webhooks (see /api/revalidate). Prices and stock shown here are informational:
 * the checkout always re-validates them against WooCommerce.
 *
 * A failed refresh keeps the last good data (see ./cache.ts); the friendly error state is
 * only shown when nothing is cached.
 *
 * Only this storefront's products are read: `wchc_shop` limits the results to the products
 * of its webshop in WooCommerce (Headless Checkout Bridge 1.2+). A store ID that is not a
 * webshop there sees every product.
 */

export const CATALOG_TAG = "wc-catalog";
export const productTag = (id: number) => `wc-product-${id}`;

const UNAVAILABLE = "Vi kan ikke hente produkterne lige nu. Prøv igen om lidt.";

/** A read as the pages take it: the friendly error message when it failed. */
function loadable<T>(result: Read<T>): Loadable<T> {
  return result.ok ? result : { ok: false, error: UNAVAILABLE };
}

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
const CATEGORY_LIFE: CacheLife = { stale: 300, revalidate: 900, expire: 86400 };

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

/** WooCommerce's global size attribute (the Guirca import's "Størrelse"). */
export const SIZE_ATTRIBUTE = "pa_storrelse";

/** A listing's filters (see lib/listing-filters.ts and ./filters.ts). */
export type ProductFilters = {
  /** … with any of these sizes (terms of SIZE_ATTRIBUTE). */
  sizeTermIds?: number[];
  /** … with a price (incl. VAT) from `minPrice` up to `maxPrice` kr.; a variable product when one of its sizes is. */
  minPrice?: number;
  maxPrice?: number;
  /** … that are in stock (a variable product when one of its sizes is). */
  inStockOnly?: boolean;
};

export type ProductQuery = ProductFilters & {
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
  return loadable(await readProducts(options).catch(orFailure));
}

async function readProducts(options: ProductQuery): Promise<Read<ProductList>> {
  "use cache: remote";
  cacheTag(CATALOG_TAG);
  return fetched("getProducts", MINUTES, async () => {
    const page = options.page ?? 1;
    const sort = SORTS[options.sort ?? "anbefalet"];
    const list = (ids: number[] | undefined) => (ids && ids.length > 0 ? ids.join(",") : undefined);
    const adult = options.hideAdult ? await readAdultProductIds() : undefined;
    if (adult && !adult.ok) throw new Error("The 18+ products could not be read");
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
        exclude: list(adult?.data),
        search: options.search || undefined,
        attribute: options.sizeTermIds?.length ? SIZE_ATTRIBUTE : undefined,
        attribute_term: list(options.sizeTermIds),
        min_price: options.minPrice,
        max_price: options.maxPrice,
        stock_status: options.inStockOnly ? "instock" : undefined,
        _fields: SUMMARY_FIELDS,
      },
      schema: z.array(wcProductSchema),
    });
    const hidden = new Set(options.notInCategoryIds);
    return {
      products: data.map(mapProductSummary).filter((p) => !p.categories.some((c) => hidden.has(c.id))),
      total: Number(headers.get("x-wp-total") ?? data.length),
      totalPages: Number(headers.get("x-wp-totalpages") ?? 1),
      page,
    };
  });
}

/**
 * Up to 24 products for a search, in the shop's order: the search field's suggestions, and the
 * search page's check whether other words find anything (see searchProducts). One cached read
 * for both, so a search typed in the field and then sent costs WooCommerce nothing more.
 */
export async function getSearchMatches(search: string): Promise<Loadable<ProductList>> {
  return getProducts({ search, perPage: 24 });
}

/** Pages of 100 adult-only (18+) products read at most (37 products in 2026). */
const ADULT_PAGES = 10;

/**
 * IDs of this shop's adult-only (18+) products, to leave them out of general listings: all of
 * them, a page of 100 at a time. More than ADULT_PAGES pages fails the read (listings keep
 * their last version) rather than leave the rest in them.
 */
async function readAdultProductIds(): Promise<Read<number[]>> {
  "use cache: remote";
  cacheTag(CATALOG_TAG);
  return fetched("getAdultProductIds", HOURS, async () => {
    const categories = await getCategories();
    if (!categories.ok) throw new Error(categories.error);
    const adult = categories.data.filter((c) => ADULT_CATEGORY_SLUGS.includes(c.slug)).map((c) => c.id);
    if (adult.length === 0) return [];
    const ids: number[] = [];
    for (let page = 1; ; page++) {
      const { data, headers } = await wooRequest("wc/v3/products", {
        query: { ...SHOP, status: "publish", category: adult.join(","), per_page: 100, page, orderby: "id", order: "asc", _fields: "id" },
        schema: z.array(z.object({ id: z.number() })),
      });
      ids.push(...data.map((p) => p.id));
      if (page >= Number(headers.get("x-wp-totalpages") ?? 1)) return ids;
      if (page >= ADULT_PAGES) throw new Error(`More than ${ADULT_PAGES * 100} adult-only products`);
    }
  });
}

/** This shop's themes (WooCommerce product tags), name -> ID. */
export async function getThemeIds(): Promise<Loadable<Map<string, number>>> {
  return loadable(await readThemeIds().catch(orFailure));
}

async function readThemeIds(): Promise<Read<Map<string, number>>> {
  "use cache: remote";
  cacheTag(CATALOG_TAG);
  return fetched("getThemeIds", CATEGORY_LIFE, async () => {
    const tags = new Map<string, number>();
    for (let page = 1; page <= 10; page++) {
      const { data, headers } = await wooRequest("wc/v3/products/tags", {
        query: { per_page: 100, page, hide_empty: true, _fields: "id,name" },
        schema: z.array(z.object({ id: z.number(), name: z.string() })),
      });
      for (const tag of data) tags.set(decodeEntities(tag.name), tag.id);
      if (page >= Number(headers.get("x-wp-totalpages") ?? 1)) break;
    }
    return tags;
  });
}

/**
 * What the WooCommerce plugin can do (Headless Checkout Bridge, from its status endpoint):
 * 1.4 filters products by more categories and counts a shop's products per category in one request.
 */
export async function getPluginFeatures(): Promise<{ categoryFilters: boolean }> {
  const result = await readPluginFeatures().catch(orFailure);
  // Unknown (nothing cached and no answer): the code paths that work with every version.
  return result.ok ? result.data : { categoryFilters: false };
}

async function readPluginFeatures(): Promise<Read<{ categoryFilters: boolean }>> {
  "use cache: remote";
  return fetched("getPluginFeatures", HOURS, async () => {
    const { data } = await wooRequest("wc-headless/v1/status", { schema: z.object({ version: z.string() }).loose() });
    return { categoryFilters: versionAtLeast(data.version, "1.4.0") };
  });
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

/** A product as the sitemap needs it: its address, categories and the webshops that sell it. */
export type ProductSlug = { slug: string; categoryIds: number[]; webshops: string[] };

/**
 * All this shop's published products, with their category IDs and webshops (the sitemap
 * lists those whose home is this shop, see lib/home-store.ts); refreshed every hour.
 */
export async function getAllProductSlugs(): Promise<Loadable<ProductSlug[]>> {
  return loadable(await readAllProductSlugs().catch(orFailure));
}

async function readAllProductSlugs(): Promise<Read<ProductSlug[]>> {
  "use cache: remote";
  cacheTag(CATALOG_TAG);
  return fetched("getAllProductSlugs", HOURS, async () => {
    const read = (page: number) =>
      wooRequest("wc/v3/products", {
        query: { ...SHOP, status: "publish", per_page: 100, page, orderby: "id", order: "asc", _fields: "slug,categories,webshops" },
        schema: z.array(
          z.object({
            slug: z.string(),
            categories: z.array(z.object({ id: z.number() })).default([]),
            webshops: wcProductSchema.shape.webshops,
          }),
        ),
        timeoutMs: 30_000,
      });
    // Page 1 tells how many pages there are (about 90); the others are read a few at a time,
    // so the sitemap is ready in seconds instead of a minute and a half.
    const first = await read(1);
    const pages = Math.min(Number(first.headers.get("x-wp-totalpages") ?? 1), 200);
    const rest = await mapWithLimit(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => i + 2), 3, read);
    return [first, ...rest].flatMap((response) => response.data.map((p) => ({ slug: p.slug, categoryIds: p.categories.map((c) => c.id), webshops: p.webshops })));
  });
}

/** Product cards for these IDs (e.g. the favourites), in that order; unknown IDs are left out. */
export async function getProductsByIds(ids: number[]): Promise<Loadable<ProductSummary[]>> {
  if (ids.length === 0) return { ok: true, data: [] };
  const result = await getProducts({ include: ids.slice(0, 100), perPage: 100 });
  return result.ok ? { ok: true, data: result.data.products } : result;
}

export async function getProductBySlug(slug: string): Promise<Loadable<Product | null>> {
  return loadable(await readProductBySlug(slug).catch(orFailure));
}

async function readProductBySlug(slug: string): Promise<Read<Product | null>> {
  "use cache: remote";
  cacheTag(CATALOG_TAG);
  return fetched("getProductBySlug", MINUTES, async () => {
    const { data } = await wooRequest("wc/v3/products", {
      query: { ...SHOP, slug, status: "publish" },
      schema: z.array(wcProductSchema),
    });
    const product = data[0];
    if (!product) return null;
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
    return mapProduct(product, variations);
  });
}

/** A product's name and first photo, for the front page's hero and the tiles. */
export type ProductPhoto = Pick<ProductSummary, "id" | "slug" | "name" | "image">;

/**
 * The photo of a product chosen in src/config/merchandising.ts (a hero photo or a tile's).
 * One small request for its photos only (no text, no sizes), kept for an hour: these pages
 * are regenerated every minute, the photos rarely change, and a product webhook still
 * refreshes them. Null for an unknown or unpublished product, or when WooCommerce can't be read.
 */
export async function getProductPhoto(slug: string): Promise<ProductPhoto | null> {
  const result = await readProductPhoto(slug).catch(orFailure);
  return result.ok ? result.data : null;
}

async function readProductPhoto(slug: string): Promise<Read<ProductPhoto | null>> {
  "use cache: remote";
  cacheTag(CATALOG_TAG);
  return fetched("getProductPhoto", HOURS, async () => {
    const { data } = await wooRequest("wc/v3/products", {
      // meta_data: the supplier photos of a product without its own (see productImages).
      query: { ...SHOP, slug, status: "publish", _fields: "id,slug,name,images,meta_data" },
      schema: z.array(wcProductSchema.pick({ id: true, slug: true, name: true, images: true, meta_data: true })),
    });
    const product = data[0];
    if (!product) return null;
    cacheTag(productTag(product.id));
    return { id: product.id, slug: product.slug, name: decodeEntities(product.name), image: productImages(product)[0] ?? null };
  });
}

export type RelatedProducts = { accessories: ProductSummary[]; similar: ProductSummary[] };

/**
 * "Relevant tilbehør" and "Lignende produkter" for a product page.
 *
 * - Accessories: products in the accessory categories (ACCESSORY_CATEGORY_SLUGS) with one of
 *   the product's themes; if there are too few, accessories from the product's other
 *   categories. One of each kind first (see rankAccessories).
 * - Similar: products in the product's most specific category, those with its themes first.
 *
 * Both prefer the product's target group and leave out the other season (the shop's hidden
 * categories and off-season names, see seasonFilter). A failure only hides the rows.
 */
export async function getRelatedProducts(product: Pick<Product, "id" | "name" | "tags" | "audience" | "categories">): Promise<RelatedProducts> {
  const result = await readRelatedProducts(product).catch(orFailure);
  return result.ok ? result.data : { accessories: [], similar: [] };
}

async function readRelatedProducts(product: Pick<Product, "id" | "name" | "tags" | "audience" | "categories">): Promise<Read<RelatedProducts>> {
  "use cache: remote";
  cacheTag(CATALOG_TAG, productTag(product.id));
  return fetched("getRelatedProducts", HOURS, async () => {
    const [categories, plugin] = await Promise.all([getCategories(), getPluginFeatures()]);
    if (!categories.ok) throw new Error(categories.error);
    const tree = categories.data;
    const season = seasonFilter(product, tree.filter((c) => merchandising.hidden.includes(c.slug)).map((c) => c.id), merchandising.offSeasonWords);
    // Plugin 1.4 leaves the hidden categories out in WooCommerce already (more candidates that fit).
    const notIn: Record<string, string> = plugin.categoryFilters && season.hiddenCategoryIds.length > 0 ? { wchc_not_in_category: season.hiddenCategoryIds.join(",") } : {};
    const candidates = async (query: Record<string, string | number>) => (await relatedQuery({ ...query, ...notIn }, product.id)).filter(season.fits);
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
      const byTheme = tagIds ? await candidates({ category: [...rootIds].join(","), tag: tagIds, per_page: 48 }) : [];
      accessories = rankAccessories(product, byTheme, accessoryKind, RELATED_LIMIT);
      if (accessories.length < RELATED_LIMIT / 2) {
        // Too few with the same themes: accessories from the product's other categories (e.g. its
        // costume category), with the same season filter.
        const others = product.categories.filter((c) => !kindOf.has(c.id)).map((c) => c.id);
        if (others.length > 0) {
          const nearby = (await candidates({ category: others.join(","), per_page: 100 })).filter(isAccessory);
          accessories = rankAccessories(product, [...byTheme, ...nearby], accessoryKind, RELATED_LIMIT);
        }
      }
    }

    const primary = primaryCategory(tree, product.categories);
    let similar: ProductSummary[] = [];
    if (primary) {
      const shown = new Set(accessories.map((p) => p.id));
      const byTheme = tagIds ? await candidates({ category: primary.id, tag: tagIds, per_page: 24 }) : [];
      similar = rankSimilar(product, byTheme, RELATED_LIMIT, shown);
      if (similar.length < RELATED_LIMIT) {
        const sameCategory = await candidates({ category: primary.id, per_page: 24 });
        similar = rankSimilar(product, [...byTheme, ...sameCategory], RELATED_LIMIT, shown);
      }
    }

    return { accessories, similar };
  });
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
  return loadable(await readCategories().catch(orFailure));
}

async function readCategories(): Promise<Read<ProductCategory[]>> {
  "use cache: remote";
  cacheTag(CATALOG_TAG);
  return fetched("getCategories", CATEGORY_LIFE, async () => {
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
    const counts = await shopCategoryCounts(categories);
    return categories
      .map((c, i) => ({ ...mapCategory(c), count: counts[i] ?? 0 }))
      .filter((c) => c.slug !== "uncategorized" && c.count > 0);
  });
}

/** This shop's number of published products per category (subcategories included), in the order given. */
async function shopCategoryCounts(categories: { id: number; count: number }[]): Promise<number[]> {
  // Not knowing the plugin's version fails the refresh (keeping the last menu) rather than
  // falling back to one request per category.
  const plugin = await readPluginFeatures();
  if (!plugin.ok) throw new Error("The plugin's version could not be read");
  if (plugin.data.categoryFilters) {
    const { data } = await wooRequest(`wc-headless/v1/shops/${encodeURIComponent(storeConfig.id)}/category-counts`, {
      schema: z.record(z.string(), z.number()),
    });
    return categories.map((c) => data[String(c.id)] ?? 0);
  }
  // A count that can't be read uses WooCommerce's own (all webshops'; nearly every product is
  // in both shops, so it is close) instead of failing the whole menu.
  let failed = 0;
  const counts = await mapWithLimit(categories, 3, (c) =>
    countProducts(c.id).catch(() => {
      failed++;
      return c.count;
    }),
  );
  if (failed > 0) console.error(`[catalog] ${failed} of ${categories.length} category counts failed; used WooCommerce's own counts for them`);
  return counts;
}

/** Number of this shop's published products in a category (subcategories included). */
async function countProducts(categoryId: number): Promise<number> {
  const { headers } = await wooRequest("wc/v3/products", {
    query: { ...SHOP, status: "publish", category: categoryId, per_page: 1, _fields: "id" },
    schema: z.array(z.object({ id: z.number() })),
  });
  return Number(headers.get("x-wp-total") ?? 0);
}

/**
 * Like Promise.all(items.map(fn)), but at most `limit` requests at a time. After a failure no
 * further items are started (the result is a failure anyway).
 */
async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let failed = false;
  async function worker() {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index]!);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
