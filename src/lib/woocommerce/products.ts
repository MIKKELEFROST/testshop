import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";
import { describeError } from "@/lib/log";
import type { Loadable, Product, ProductCategory, ProductSummary } from "@/types/commerce";
import { wooRequest } from "./client";
import { mapCategory, mapProduct, mapProductSummary } from "./mappers";
import { wcCategorySchema, wcProductSchema, wcVariationSchema } from "./schemas";

/**
 * Catalogue reads. Cached with `use cache` (short lifetime + tags) and revalidated on
 * demand by WooCommerce webhooks (see /api/revalidate). Prices and stock shown here are
 * informational: the checkout always re-validates them against WooCommerce.
 *
 * Failures are cached only briefly, so a WooCommerce outage never sticks.
 */

export const CATALOG_TAG = "wc-catalog";
export const productTag = (id: number) => `wc-product-${id}`;

const UNAVAILABLE = "Vi kan ikke hente produkterne lige nu. Prøv igen om lidt.";

/**
 * Lifetime for a failed read: retried after 30 s. (Kept at the 5-minute "expire" minimum so
 * Next.js can still prerender the friendly error state, e.g. when building without access.)
 */
const FAILURE_LIFE = { stale: 30, revalidate: 30, expire: 300 };

export async function getProducts(options: { categoryId?: number; perPage?: number } = {}): Promise<Loadable<ProductSummary[]>> {
  "use cache";
  cacheTag(CATALOG_TAG);

  try {
    const { data } = await wooRequest("wc/v3/products", {
      query: {
        status: "publish",
        per_page: options.perPage ?? 50,
        orderby: "date",
        order: "desc",
        category: options.categoryId,
      },
      schema: z.array(wcProductSchema),
    });
    cacheLife("minutes");
    return { ok: true, data: data.map(mapProductSummary) };
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
      query: { slug, status: "publish" },
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

export async function getCategories(): Promise<Loadable<ProductCategory[]>> {
  "use cache";
  cacheTag(CATALOG_TAG);

  try {
    const { data } = await wooRequest("wc/v3/products/categories", {
      query: { per_page: 100, hide_empty: true, orderby: "name" },
      schema: z.array(wcCategorySchema),
    });
    cacheLife("minutes");
    return { ok: true, data: data.filter((c) => c.slug !== "uncategorized").map(mapCategory) };
  } catch (error) {
    logCatalogError("getCategories", error);
    cacheLife(FAILURE_LIFE);
    return { ok: false, error: UNAVAILABLE };
  }
}

function logCatalogError(operation: string, error: unknown) {
  // Messages from our client never contain credentials or customer data.
  console.error(`[catalog] ${operation} failed:`, describeError(error));
}
