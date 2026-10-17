import { describe, expect, it } from "vitest";
import type { ProductCategory, ProductSummary } from "@/types/commerce";
import {
  buildSuggestions,
  matchingLinks,
  normalizeQuery,
  oneEditApart,
  rankProducts,
  SEARCH_EXAMPLES,
  searchedOtherWords,
  searchPlan,
  searchProducts,
  searchVariants,
  spellingFix,
  stems,
  SUGGESTED_PRODUCTS,
} from "./search";

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

const category = (id: number, name: string, slug: string, parent = 0): ProductCategory => ({ id, name, slug, description: "", count: 10, image: null, parent, menuOrder: 0 });

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

describe("Danish search words", () => {
  it("takes Danish plural and definite endings off a word", () => {
    expect(stems("parykker")).toEqual(["paryk"]);
    expect(stems("masker")).toEqual(["maske", "mask"]);
    expect(stems("kostumerne")).toEqual(["kostume", "kostum"]);
    expect(stems("hekse")).toEqual(["heks"]);
    expect(stems("skeletter")).toEqual(["skelet"]);
    expect(stems("hattene")).toEqual(["hat"]);
    expect(stems("masken")).toEqual(["maske", "mask"]);
    expect(stems("tiaraer")).toEqual(["tiara"]);
    expect(stems("kat")).toEqual([]);
    expect(stems("eller")).toEqual([]);
    expect(stems("make-up")).toEqual([]);
  });

  it("searches known plurals as their base form, which also finds the plural", () => {
    expect(searchPlan("parykker", "halloween")[0]).toBe("paryk");
    expect(searchPlan("Masker", "halloween")[0]).toBe("maske");
    expect(searchPlan("kostumer", "fastelavn")[0]).toBe("kostume");
    expect(searchPlan("sorte parykker", "halloween")[0]).toBe("sorte paryk");
    expect(searchPlan("vampyrer", "halloween")).toEqual(["vampyr"]);
    // Not every plural contains its base ("tand" / "tænder"): those words stay.
    expect(searchPlan("tænder", "halloween")[0]).toBe("tænder");
  });

  it("leaves out the shop's own holiday, which few product names say", () => {
    expect(searchPlan("halloweenkostume", "halloween")[0]).toBe("kostume");
    expect(searchPlan("Halloweenkostumer", "halloween")[0]).toBe("kostume");
    expect(searchPlan("halloweenmaske", "halloween")[0]).toBe("maske");
    expect(searchPlan("halloween paryk", "halloween")[0]).toBe("paryk");
    expect(searchPlan("halloween kostume børn", "halloween")[0]).toBe("kostume børn");
    expect(searchPlan("halloween-kostume", "halloween")[0]).toBe("kostume");
    expect(searchPlan("halloweenheksekostume", "halloween").slice(0, 2)).toEqual(["heksekostume", "heks kostume"]);
    expect(searchPlan("fastelavnskostume til piger", "fastelavn")[0]).toBe("kostume til piger");
    expect(searchPlan("fastelavn kostumer", "fastelavn")[0]).toBe("kostume");
    // All there is, or no catalogue word after it: kept.
    expect(searchPlan("halloween", "halloween")[0]).toBe("halloween");
    expect(searchPlan("halloween til", "halloween")[0]).toBe("halloween til");
    expect(searchPlan("halloweenpynt", "halloween")[0]).toBe("halloweenpynt");
    expect(searchPlan("fastelavn", "fastelavn")).toEqual(["fastelavn", "kostume"]);
    // Only the shop's own holiday: in the Fastelavn shop "halloween" narrows the search.
    expect(searchPlan("halloweenmaske", "fastelavn")[0]).toBe("halloweenmaske");
    expect(searchPlan("halloween paryk", "fastelavn")[0]).toBe("halloween paryk");
  });

  it("splits compounds of the catalogue's words", () => {
    expect(searchVariants("zombiemaske", "halloween")).toContain("zombie maske");
    expect(searchVariants("vampyrtænder", "halloween")[0]).toBe("vampyr tænder");
    expect(searchVariants("heksekostume", "halloween")[0]).toBe("heks kostume");
    expect(searchVariants("kattekostume", "fastelavn")[0]).toBe("kat kostume");
    expect(searchVariants("zombiemasker", "halloween")[0]).toBe("zombie maske");
    expect(searchVariants("piratkostume til drenge", "fastelavn")[0]).toBe("pirat kostume til drenge");
  });

  it("finds Danish products for common misspellings and English words", () => {
    expect(searchVariants("vampir", "halloween")[0]).toBe("vampyr");
    expect(searchVariants("vampire", "halloween")[0]).toBe("vampyr");
    expect(searchVariants("Witch", "halloween")[0]).toBe("heks");
    expect(searchVariants("pirate", "fastelavn")[0]).toBe("pirat");
    expect(searchVariants("piraat", "fastelavn")[0]).toBe("pirat");
    expect(searchVariants("prinsese", "fastelavn")[0]).toBe("prinsesse");
    expect(searchVariants("zombi maske", "halloween")[0]).toBe("zombie maske");
  });

  it("fixes a typo only when it is one letter from exactly one catalogue word", () => {
    expect(oneEditApart("piraat", "pirat")).toBe(true);
    expect(oneEditApart("vampir", "vampyr")).toBe(true);
    expect(oneEditApart("sekelt", "skelet")).toBe(false);
    expect(oneEditApart("skelte", "skelet")).toBe(true);
    expect(oneEditApart("pirat", "pirat")).toBe(false);
    expect(spellingFix("klovne")).toBeNull(); // a known word
    expect(spellingFix("hekz")).toBeNull(); // too short to tell
    expect(spellingFix("skeltet")).toBe("skelet");
    expect(spellingFix("børnene")).toBeNull();
  });

  it("tries the shop's own synonyms first", () => {
    expect(searchVariants("kattekonge", "fastelavn")[0]).toBe("konge krone");
    expect(searchVariants("kattedronning", "fastelavn")[0]).toBe("dronning krone");
    expect(searchVariants("fastelavnskostumer", "fastelavn")[0]).toBe("kostume");
    expect(searchVariants("fastelavn", "fastelavn")).toEqual(["kostume"]);
    expect(searchVariants("kunstigt blod", "halloween")[0]).toBe("blod");
    expect(searchVariants("kunstigt blod", "fastelavn")[0]).toBe("blod");
    // Each shop has its own.
    expect(searchVariants("kattekonge", "halloween")).not.toContain("konge krone");
  });

  it("never repeats the query or a variant", () => {
    for (const q of ["kat", "zombiemaske", "heks til piger", "fastelavnskostume"]) {
      const plan = searchPlan(q, "fastelavn");
      expect(new Set(plan).size).toBe(plan.length);
    }
    expect(searchVariants("kat", "fastelavn")).toEqual([]);
  });

  it("has example words for both shops", () => {
    expect(SEARCH_EXAMPLES.fastelavn[0]).toBe("prinsesse");
    expect(SEARCH_EXAMPLES.halloween[0]).toBe("heks");
  });

  it("tells when other words than the customer's were searched", () => {
    expect(searchedOtherWords("Heks ", "heks")).toBe(false);
    expect(searchedOtherWords("parykker", "paryk")).toBe(true);
  });
});

describe("searching with fallbacks", () => {
  const list = (total: number, ids: number[] = []) => ({ ok: true as const, data: { products: ids.map((id) => product(id, `P${id}`)), total, totalPages: 1, page: 1 } });

  it("searches once when the query finds something", async () => {
    const searched: string[] = [];
    const result = await searchProducts("heks", async (q) => (searched.push(q), list(3, [1, 2, 3])), { season: "halloween" });
    expect(searched).toEqual(["heks"]);
    expect(result).toMatchObject({ ok: true, data: { searched: "heks", fallback: false } });
  });

  it("tries the variants in order until one finds something", async () => {
    const searched: string[] = [];
    const result = await searchProducts("kattekonge", async (q) => (searched.push(q), q === "konge krone" ? list(8, [7]) : list(0)), { season: "fastelavn" });
    expect(searched).toEqual(["kattekonge", "konge krone"]);
    expect(result).toMatchObject({ ok: true, data: { searched: "konge krone", fallback: true, list: { total: 8 } } });
  });

  it("stops after a few tries and reports the query's own empty result", async () => {
    const searched: string[] = [];
    const result = await searchProducts("kattedronning", async (q) => (searched.push(q), list(0)), { tries: 2, season: "fastelavn" });
    expect(searched).toEqual(["kattedronning", "dronning krone"]);
    expect(result).toMatchObject({ ok: true, data: { searched: "kattedronning", fallback: false, list: { total: 0 } } });
  });

  it("searches for the product words when the query names the shop's holiday", async () => {
    const searched: string[] = [];
    const result = await searchProducts("halloweenmaske", async (q) => (searched.push(q), list(360, [1])), { season: "halloween" });
    expect(searched).toEqual(["maske"]);
    expect(result).toMatchObject({ ok: true, data: { searched: "maske", fallback: false } });
    // The page then says which words it searched for.
    expect(searchedOtherWords("halloweenmaske", "maske")).toBe(true);
  });

  it("checks the variants with the cheaper probe, and reads only the one that finds something", async () => {
    const reads: string[] = [];
    const probes: string[] = [];
    const run = async (q: string) => (reads.push(q), q === "dronning krone" ? list(8, [7]) : list(0));
    const probe = async (q: string) => (probes.push(q), q === "dronning krone" ? list(8) : list(0));
    const result = await searchProducts("kattedronning", run, { season: "fastelavn", probe });
    expect(reads).toEqual(["kattedronning", "dronning krone"]);
    expect(probes).toEqual(["dronning krone"]);
    expect(result).toMatchObject({ ok: true, data: { searched: "dronning krone", fallback: true, list: { total: 8 } } });

    // Nothing found: one full read (the query) and a probe per variant.
    reads.length = 0;
    probes.length = 0;
    const plan = searchPlan("vampyrerne kattekongerne", "halloween");
    await searchProducts("vampyrerne kattekongerne", async (q) => (reads.push(q), list(0)), { season: "halloween", probe: async (q) => (probes.push(q), list(0)) });
    expect(reads).toEqual([plan[0]]);
    expect(probes).toEqual(plan.slice(1, 4));
    expect(await searchProducts("zombiemaske", async () => list(0), { season: "halloween", probe: async () => ({ ok: false, error: "nede" }) })).toEqual({ ok: false, error: "nede" });
  });

  it("passes on a failed read", async () => {
    const failed = { ok: false as const, error: "nede" };
    expect(await searchProducts("heks", async () => failed)).toEqual(failed);
    expect(await searchProducts("zombiemaske", async (q) => (q === "zombiemaske" ? list(0) : failed), { season: "halloween" })).toEqual(failed);
  });
});

describe("ranking search results", () => {
  const fastelavn = { categories: ["halloween", "jul-og-nytaar"], prefer: "out" as const };
  const halloween = { categories: ["halloween"], prefer: "in" as const };
  const tree = [category(1, "Halloween", "halloween"), category(2, "Halloweenpynt", "halloweenpynt", 1), category(3, "Pigekostumer", "pigekostumer")];
  const inCategory = (id: number) => ({ categories: [tree.find((c) => c.id === id)!] });

  it("puts names with more of the words first and keeps WooCommerce's order otherwise", () => {
    const products = [product(1, "Hævner – kostume til herrer"), product(2, "Halvmaske i latex"), product(3, "Ninja"), product(4, "Zombiemaske")];
    expect(rankProducts(products, "maske", [], fastelavn).map((p) => p.id)).toEqual([2, 4, 1, 3]);
    expect(rankProducts([product(1, "Zombiekirurg – kostume"), product(2, "Zombiemaske")], "zombie maske", [], halloween).map((p) => p.id)).toEqual([2, 1]);
    // The word on its own beats the word inside another.
    expect(rankProducts([product(1, "Katana-paraply"), product(2, "Plakat"), product(3, "Sort kat – kostume til piger")], "kat", [], fastelavn).map((p) => p.id)).toEqual([3, 1, 2]);
    // "til" says nothing.
    expect(rankProducts([product(1, "Sort kat"), product(2, "Kat til fest")], "kat til", [], fastelavn).map((p) => p.id)).toEqual([1, 2]);
  });

  it("puts the shop's season first among equal names", () => {
    const products = [product(1, "Skeletkat", inCategory(2)), product(2, "Kattekjole til piger", inCategory(3)), product(3, "Katteballon")];
    // Fastelavn: Halloween (and its subcategories) last.
    expect(rankProducts(products, "kat", tree, fastelavn).map((p) => p.id)).toEqual([2, 3, 1]);
    // Halloween: Halloween first.
    expect(rankProducts(products, "kat", tree, halloween).map((p) => p.id)).toEqual([1, 2, 3]);
  });

  it("puts the season before a better name, among names with the words", () => {
    // "Kat, 30 cm" (a Halloween figure) has the word on its own; "Kattekostume" inside a word.
    const products = [product(1, "Kat, 30 cm", inCategory(2)), product(2, "Halvmaske", inCategory(3)), product(3, "Kattekostume til piger", inCategory(3))];
    expect(rankProducts(products, "kat", tree, fastelavn).map((p) => p.id)).toEqual([3, 1, 2]);
    expect(rankProducts(products, "kat", tree, halloween).map((p) => p.id)).toEqual([1, 3, 2]);
    // The same season: the better name first.
    const costumes = [product(4, "Kattekostume til piger", inCategory(3)), product(5, "Sort kat – kostume til piger", inCategory(3))];
    expect(rankProducts(costumes, "kat", tree, fastelavn).map((p) => p.id)).toEqual([5, 4]);
  });

  it("puts categories the shop keeps out of its menu after links that fit as well", () => {
    // The tests run as the Fastelavn shop, which keeps Halloweenpynt, Julepynt and Jul og nytår out of its menu.
    const categories = [category(95, "Halloweenpynt", "halloweenpynt"), category(102, "Julepynt", "julepynt"), category(94, "Pynt og fest", "pynt-og-fest")];
    expect(matchingLinks("pynt", categories).map((l) => l.label)).toEqual(["Pynt og fest", "Halloweenpynt", "Julepynt"]);
    // But not after every weaker link: they still lead when they fit the words far better.
    const decorations = [
      category(98, "Bordpynt", "bordpynt"),
      category(97, "Festpynt", "festpynt"),
      category(80, "Hovedpynt", "hovedpynt"),
      category(94, "Pynt og fest", "pynt-og-fest"),
      category(102, "Julepynt", "julepynt"),
      category(104, "Jul og nytår", "jul-og-nytaar"),
    ];
    expect(matchingLinks("jule pynt", decorations).map((l) => l.label)).toEqual(["Julepynt", "Jul og nytår", "Bordpynt", "Festpynt"]);
  });

  it("links the most specific categories and themes", () => {
    const categories = [category(1, "Kostumer", "kostumer"), category(2, "Pigekostumer", "pigekostumer"), category(3, "Drengekostumer", "drengekostumer")];
    expect(matchingLinks("pirat kostume", categories)).toEqual([{ label: "Pirater", href: "/tema/pirater", kind: "Tema" }]);
    expect(matchingLinks("kostume", categories, undefined, 3).map((l) => l.label)).toEqual(["Kostumer", "Pigekostumer", "Drengekostumer"]);
    expect(matchingLinks("piger", categories)).toEqual([{ label: "Pigekostumer", href: "/kategori/pigekostumer", kind: "Kategori" }]);
    // The words that found the products count too.
    expect(matchingLinks("kattekonge", [category(4, "Kroner og tiaraer", "kroner-og-tiaraer")], "konge krone")).toEqual([
      { label: "Kroner og tiaraer", href: "/kategori/kroner-og-tiaraer", kind: "Kategori" },
    ]);
    expect(matchingLinks("tøndeslagning", categories)).toEqual([]);
  });

  it("says in the suggestions which words found the products", () => {
    expect(buildSuggestions("parykker", [product(1, "Paryk")], [], "paryk").searched).toBe("paryk");
    expect(buildSuggestions("Heks", [product(1, "Heks")], [], "heks").searched).toBeNull();
  });
});
