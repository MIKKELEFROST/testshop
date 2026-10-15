import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";
import { storeConfig } from "@/config/store";
import { describeError } from "@/lib/log";
import type { Loadable, Product, ProductCategory, ProductList } from "@/types/commerce";
import { wooRequest } from "./client";
import { mapCategory, mapProduct, mapProductSummary } from "./mappers";
import { wcCategorySchema, wcProductSchema, wcVariationSchema } from "./schemas";

/**
 * Catalogue reads. Cached with `use cache` (short lifetime + tags) and revalidated on
 * demand by WooCommerce webhooks (see /api/revalidate). Prices and stock shown here are
 * informational: the checkout always re-validates them against WooCommerce.
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

/** Products per listing page (fills 2, 3 and 4 columns). */
export const PAGE_SIZE = 24;

/** What a product card needs; keeps listing responses small (no descriptions). */
const SUMMARY_FIELDS = [
  "id", "name", "slug", "type", "status", "price", "regular_price", "sale_price", "on_sale", "purchasable",
  "stock_status", "stock_quantity", "manage_stock", "backorders_allowed", "categories", "images", "headless_prices", "meta_data",
].join(",");

/**
 * Category counts are recounted every 15 minutes (one small request per category), not
 * every minute like product lists.
 */
const CATEGORY_LIFE = { stale: 300, revalidate: 900, expire: 86400 };

/** Newest first. A category includes its subcategories' products. */
export async function getProducts(
  options: { categoryId?: number; page?: number; perPage?: number; search?: string } = {},
): Promise<Loadable<ProductList>> {
  "use cache";
  cacheTag(CATALOG_TAG);

  const page = options.page ?? 1;
  try {
    const { data, headers } = await wooRequest("wc/v3/products", {
      query: {
        ...SHOP,
        status: "publish",
        per_page: options.perPage ?? PAGE_SIZE,
        page,
        orderby: "date",
        order: "desc",
        category: options.categoryId,
        search: options.search || undefined,
        _fields: SUMMARY_FIELDS,
      },
      schema: z.array(wcProductSchema),
    });
    cacheLife("minutes");
    return {
      ok: true,
      data: {
        products: data.map(mapProductSummary),
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

export async function getProductBySlug(slug: string): Promise<Loadable<Product | null>> {
  "use cache";
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

/** This shop's categories (with products), each with the shop's own product count. */
export async function getCategories(): Promise<Loadable<ProductCategory[]>> {
  "use cache";
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
    // WooCommerce counts every webshop's products; count (and show) only this shop's.
    const counts = await mapWithLimit(categories, 6, (c) => countProducts(c.id));
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
