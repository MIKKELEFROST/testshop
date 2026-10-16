import type { MetadataRoute } from "next";
import { INFO_LINKS } from "@/components/content/info-page";
import { merchandising } from "@/config/merchandising";
import { storeConfig } from "@/config/store";
import { categoryHomeStore, homeStoreFor } from "@/lib/home-store";
import { absoluteUrl } from "@/lib/seo";
import { isBuilding } from "@/lib/woocommerce/cache";
import { getAllProductSlugs, getCategories } from "@/lib/woocommerce/products";

/**
 * The shop's pages for search engines: front page, themes, categories, products and
 * information pages. Only the pages whose canonical address is in this shop: not the products
 * and hidden categories whose home is another shop (lib/home-store.ts), nor the theme pages
 * that stand in for a category page.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [categories, products] = await Promise.all([getCategories(), getAllProductSlugs()]);
  // Without WooCommerce, keep serving the last sitemap (a failed refresh keeps it) instead of
  // one without categories and products. Only a build without access gets that one.
  if ((!categories.ok || !products.ok) && !isBuilding()) throw new Error("WooCommerce unavailable: the sitemap keeps its last version");
  const tree = categories.ok ? categories.data : [];
  const own = (home: string) => home === storeConfig.id;
  return [
    { url: absoluteUrl("/"), changeFrequency: "daily", priority: 1 },
    { url: absoluteUrl("/produkter"), changeFrequency: "daily", priority: 0.6 },
    ...merchandising.collections
      .filter((c) => !c.canonical)
      .map((c) => ({ url: absoluteUrl(`/tema/${c.slug}`), changeFrequency: "weekly" as const, priority: 0.8 })),
    ...tree
      .filter((c) => own(categoryHomeStore(c, tree)))
      .map((c) => ({ url: absoluteUrl(`/kategori/${c.slug}`), changeFrequency: "weekly" as const, priority: 0.7 })),
    ...(products.ok ? products.data : [])
      .filter((p) => own(homeStoreFor(p.categoryIds.map((id) => ({ id })), tree)))
      .map((p) => ({ url: absoluteUrl(`/produkter/${p.slug}`), changeFrequency: "weekly" as const, priority: 0.5 })),
    ...INFO_LINKS.map((l) => ({ url: absoluteUrl(l.href), changeFrequency: "monthly" as const, priority: 0.3 })),
  ];
}
