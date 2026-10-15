import { merchandising } from "@/config/merchandising";
import type { ProductCategory, ProductSummary } from "@/types/commerce";

/** What the search field suggests while the customer types. */
export type Suggestions = {
  products: { id: number; name: string; slug: string; image: ProductSummary["image"]; price: string | null; from: boolean; adult: boolean }[];
  links: { label: string; href: string; kind: "Kategori" | "Tema" }[];
};

export const SUGGESTED_PRODUCTS = 6;
export const SUGGESTED_LINKS = 4;

/** "Heks!" -> "heks" (what the search compares). */
export function normalizeQuery(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
}

const fold = (text: string) => text.toLocaleLowerCase("da-DK");

/**
 * Products whose name has the words first (WooCommerce also matches descriptions), then
 * the shop's categories and themes whose names contain the words.
 */
export function buildSuggestions(query: string, products: ProductSummary[], categories: ProductCategory[]): Suggestions {
  const words = fold(query).split(" ").filter(Boolean);
  const matches = (name: string) => words.every((w) => fold(name).includes(w));
  const ranked = [...products.filter((p) => matches(p.name)), ...products.filter((p) => !matches(p.name))];

  const links: Suggestions["links"] = [
    ...categories.filter((c) => matches(c.name)).map((c) => ({ label: c.name, href: `/kategori/${c.slug}`, kind: "Kategori" as const })),
    ...merchandising.collections.filter((c) => matches(c.title)).map((c) => ({ label: c.title, href: `/tema/${c.slug}`, kind: "Tema" as const })),
  ];

  return {
    products: ranked.slice(0, SUGGESTED_PRODUCTS).map((p) => {
      const range = p.priceRange && p.priceRange.min !== p.priceRange.max ? p.priceRange : null;
      return { id: p.id, name: p.name, slug: p.slug, image: p.image, price: range ? range.min : (p.price ?? p.priceRange?.min ?? null), from: Boolean(range), adult: p.adult };
    }),
    links: links.filter((l, i) => links.findIndex((x) => x.href === l.href) === i).slice(0, SUGGESTED_LINKS),
  };
}
