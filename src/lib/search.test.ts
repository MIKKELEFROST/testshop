import { describe, expect, it } from "vitest";
import type { ProductCategory, ProductSummary } from "@/types/commerce";
import { buildSuggestions, normalizeQuery, SUGGESTED_PRODUCTS } from "./search";

function product(id: number, name: string, extra: Partial<ProductSummary> = {}): ProductSummary {
  return {
    id,
    slug: `p${id}`,
    name,
    type: "simple",
    price: "99",
    regularPrice: "99",
    salePrice: null,
    onSale: false,
    priceRange: null,
    image: null,
    stockStatus: "instock",
    stockQuantity: null,
    categories: [],
    tags: [],
    audience: [],
    variantSummary: null,
    discountPercent: null,
    hasVideo: false,
    adult: false,
    ...extra,
  };
}

const category = (id: number, name: string, slug: string): ProductCategory => ({ id, name, slug, description: "", count: 10, image: null, parent: 0, menuOrder: 0 });

describe("search suggestions", () => {
  it("normalises the query", () => {
    expect(normalizeQuery("  Heks   til  piger ")).toBe("Heks til piger");
    expect(normalizeQuery(null)).toBe("");
    expect(normalizeQuery("x".repeat(150))).toHaveLength(100);
  });

  it("puts products with the words in their name first", () => {
    const result = buildSuggestions("pirat", [product(1, "Papegøje til skulderen"), product(2, "Pirat – kostume til drenge"), product(3, "Piratsabel, 60 cm")], []);
    expect(result.products.map((p) => p.id)).toEqual([2, 3, 1]);
  });

  it("matches every word, in any case", () => {
    const result = buildSuggestions("KOSTUME pirat", [product(1, "Piratsabel"), product(2, "Pirat – kostume til drenge")], []);
    expect(result.products[0]!.id).toBe(2);
  });

  it("suggests categories and the shop's themes", () => {
    const result = buildSuggestions("prinse", [], [category(1, "Pigekostumer", "pigekostumer")]);
    expect(result.links).toContainEqual({ label: "Prinsesser og prinser", href: "/tema/prinsesser", kind: "Tema" });
    expect(buildSuggestions("pige", [], [category(1, "Pigekostumer", "pigekostumer")]).links).toEqual([
      { label: "Pigekostumer", href: "/kategori/pigekostumer", kind: "Kategori" },
    ]);
  });

  it("shows prices from the cheapest size and at most a few products", () => {
    const many = Array.from({ length: 12 }, (_, i) => product(i + 1, `Heks ${i}`));
    expect(buildSuggestions("heks", many, []).products).toHaveLength(SUGGESTED_PRODUCTS);
    const ranged = buildSuggestions("heks", [product(1, "Heks", { price: null, priceRange: { min: "129", max: "159" } })], []);
    expect(ranged.products[0]).toMatchObject({ price: "129", from: true });
  });
});
