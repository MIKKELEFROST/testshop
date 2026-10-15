import type { MetadataRoute } from "next";
import { INFO_LINKS } from "@/components/content/info-page";
import { merchandising } from "@/config/merchandising";
import { absoluteUrl } from "@/lib/seo";
import { getAllProductSlugs, getCategories } from "@/lib/woocommerce/products";

/** The shop's pages for search engines: front page, themes, categories, products and information pages. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [categories, products] = await Promise.all([getCategories(), getAllProductSlugs()]);
  return [
    { url: absoluteUrl("/"), changeFrequency: "daily", priority: 1 },
    { url: absoluteUrl("/produkter"), changeFrequency: "daily", priority: 0.6 },
    ...merchandising.collections.map((c) => ({ url: absoluteUrl(`/tema/${c.slug}`), changeFrequency: "weekly" as const, priority: 0.8 })),
    ...(categories.ok ? categories.data : []).map((c) => ({ url: absoluteUrl(`/kategori/${c.slug}`), changeFrequency: "weekly" as const, priority: 0.7 })),
    ...products.map((slug) => ({ url: absoluteUrl(`/produkter/${slug}`), changeFrequency: "weekly" as const, priority: 0.5 })),
    ...INFO_LINKS.map((l) => ({ url: absoluteUrl(l.href), changeFrequency: "monthly" as const, priority: 0.3 })),
  ];
}
