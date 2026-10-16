import { describe, expect, it } from "vitest";
import { merchandisingByStore } from "@/config/merchandising";
import type { ProductSummary } from "@/types/commerce";
import { rankAccessories, rankSimilar, relevance, seasonFilter } from "./related";

function item(id: number, tags: number[], audience: string[] = [], kind = "x", stock: ProductSummary["stockStatus"] = "instock"): ProductSummary {
  return {
    id,
    slug: `p${id}`,
    name: `P${id}`,
    type: "simple",
    price: "99",
    regularPrice: "99",
    salePrice: null,
    onSale: false,
    priceRange: null,
    image: null,
    stockStatus: stock,
    stockQuantity: null,
    categories: [{ id: kind.charCodeAt(0), name: kind, slug: kind }],
    tags: tags.map((t) => ({ id: t, name: `T${t}` })),
    audience,
    variantSummary: null,
    discountPercent: null,
    hasVideo: false,
    adult: false,
  };
}

// A girls' witch costume: themes 1 (Hekse) and 2 (Halloween).
const costume = { id: 100, tags: [{ id: 1, name: "Hekse" }, { id: 2, name: "Halloween" }], audience: ["Piger"] };

describe("relevance", () => {
  it("counts shared themes first, then the target group", () => {
    expect(relevance(costume, item(1, [1, 2], ["Piger"]))).toBe(8);
    expect(relevance(costume, item(2, [1], ["Drenge"]))).toBe(3);
    expect(relevance(costume, item(3, [1], ["Damer"]))).toBe(1);
    expect(relevance(costume, item(4, []))).toBe(0);
  });
});

describe("rankAccessories", () => {
  it("shows one of each kind before a second of any kind", () => {
    const hats = [item(1, [1, 2], [], "h"), item(2, [1, 2], [], "h"), item(3, [1, 2], [], "h")];
    const wig = item(4, [1], [], "w");
    const broom = item(5, [1], [], "b");
    const ranked = rankAccessories(costume, [...hats, wig, broom], (p) => p.categories[0]!.slug, 4);
    expect(ranked.map((p) => p.id)).toEqual([1, 4, 5, 2]);
  });

  it("leaves out the product itself and sold-out items, and puts unrelated adult items last", () => {
    const ranked = rankAccessories(
      costume,
      [item(6, [], ["Damer"], "w"), item(100, [1]), item(7, [1], [], "h", "outofstock"), item(8, [], [], "m"), item(9, [1, 2], ["Damer"], "w")],
      (p) => p.categories[0]!.slug,
      10,
    );
    // An adult wig with both themes still beats an unrelated mask; an unrelated adult wig comes last.
    expect(ranked.map((p) => p.id)).toEqual([9, 8, 6]);
  });
});

describe("rankSimilar", () => {
  it("ranks by relevance, keeps WooCommerce's order on ties and skips excluded products", () => {
    const candidates = [item(1, []), item(2, [1]), item(3, [1, 2], ["Piger"]), item(4, [])];
    expect(rankSimilar(costume, candidates, 3, new Set([2])).map((p) => p.id)).toEqual([3, 1, 4]);
  });
});

describe("seasonFilter (Fastelavn: no Halloween or Christmas)", () => {
  const HALLOWEEN = 103;
  const CHRISTMAS = 104;
  const ANIMALS = 20; // An accessory category; Guirca's bat items are tagged "Dyr" like the animal costumes.
  const words = merchandisingByStore["piece-dk"]!.offSeasonWords;
  const named = (id: number, name: string, categories: number[]): ProductSummary => ({
    ...item(id, []),
    name,
    categories: categories.map((c) => ({ id: c, name: `C${c}`, slug: `c${c}` })),
  });
  const dino = { name: "Dino – kostume til baby", categories: [{ id: 7 }] };

  it("leaves out the hidden categories and products named like the other seasons", () => {
    const { fits, hiddenCategoryIds } = seasonFilter(dino, [HALLOWEEN, CHRISTMAS], words);
    expect(hiddenCategoryIds).toEqual([HALLOWEEN, CHRISTMAS]);
    expect(fits(named(1, "Ring med edderkop", [ANIMALS, HALLOWEEN]))).toBe(false);
    expect(fits(named(2, "Nissehue", [ANIMALS, CHRISTMAS]))).toBe(false);
    expect(fits(named(3, "Sorte flagermusvinger", [ANIMALS]))).toBe(false);
    expect(fits(named(4, "Hårspænde med kranie", [ANIMALS]))).toBe(false);
    expect(fits(named(5, "Julemandshue", [ANIMALS]))).toBe(false);
    expect(fits(named(6, "Dinosaurhale", [ANIMALS]))).toBe(true);
    expect(fits(named(7, "Hjul til bil", [ANIMALS]))).toBe(true);
  });

  it("lets a product that is off-season itself keep its own kind", () => {
    const witch = seasonFilter({ name: "Heks – kostume til piger", categories: [{ id: 50 }, { id: HALLOWEEN }] }, [HALLOWEEN, CHRISTMAS], words);
    expect(witch.hiddenCategoryIds).toEqual([CHRISTMAS]);
    expect(witch.fits(named(1, "Edderkoppehalskæde", [ANIMALS, HALLOWEEN]))).toBe(true);
    expect(witch.fits(named(2, "Nissehue", [ANIMALS, CHRISTMAS]))).toBe(false);
    const skeleton = seasonFilter({ name: "Skeletkostume til drenge", categories: [{ id: 51 }] }, [HALLOWEEN, CHRISTMAS], words);
    expect(skeleton.fits(named(3, "Kraniemaske", [ANIMALS]))).toBe(true);
  });

  it("filters only by category in a shop without off-season words", () => {
    const { fits } = seasonFilter(dino, [CHRISTMAS], merchandisingByStore["halloween-kostumer-dk"]!.offSeasonWords);
    expect(fits(named(1, "Sorte flagermusvinger", [ANIMALS]))).toBe(true);
    expect(fits(named(2, "Nissehue", [ANIMALS, CHRISTMAS]))).toBe(false);
  });
});
