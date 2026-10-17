/**
 * Catalogue reads through the storefront's WooCommerce client (lib/woocommerce/client.ts),
 * against the local Docker WooCommerce:
 *
 *   ./scripts/local-woocommerce/setup.sh && npm run test:integration
 *
 * What product pages read when nothing is cached: the product and its sizes and the menu
 * (critical reads), and the related rows (background reads), for several pages at once, so
 * the read slots (4 per server instance, one kept for critical reads) queue them.
 */
import { describe, expect, it, vi } from "vitest";
import { configureLocalWooEnv, productBySku } from "../support/woo-admin";

// The reads' "use cache: remote" lifetimes and tags only mean something inside Next.js.
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {} }));

const enabled = Boolean(process.env.WC_INTEGRATION);
if (enabled) configureLocalWooEnv();

const { getCategories, getProductBySlug, getProducts, getRelatedProducts } = await import("@/lib/woocommerce/products");

describe.skipIf(!enabled)("catalogue reads", () => {
  it("serves several cold product pages at once: every product, its sizes, the menu and the related rows", async () => {
    const hoodie = await productBySku("HOOD");
    const tshirt = await productBySku("TS-001");
    const page = async (slug: string) => {
      const [product, categories] = await Promise.all([getProductBySlug(slug), getCategories()]);
      const related = product.ok && product.data ? await getRelatedProducts(product.data) : null;
      return { product, categories, related };
    };
    const pages = await Promise.all([hoodie, tshirt, hoodie, tshirt, hoodie, tshirt, hoodie, tshirt].map((p) => page(p.slug)));
    for (const [i, { product, categories, related }] of pages.entries()) {
      expect(product.ok && product.data?.id).toBe(i % 2 === 0 ? hoodie.id : tshirt.id);
      expect(categories.ok).toBe(true);
      expect(related).not.toBeNull();
    }
    const sizes = pages[0]!.product;
    expect(sizes.ok && sizes.data?.variations.length).toBe(3);
  });

  it("reads a listing while background reads take the other slots", async () => {
    const hoodie = await getProductBySlug((await productBySku("HOOD")).slug);
    if (!hoodie.ok || !hoodie.data) throw new Error("No hoodie");
    const product = hoodie.data;
    const [listing, ...rows] = await Promise.all([getProducts({ perPage: 5 }), ...Array.from({ length: 6 }, () => getRelatedProducts(product))]);
    expect(listing.ok && listing.data.products.length).toBeGreaterThan(0);
    expect(rows).toHaveLength(6);
  });
});
