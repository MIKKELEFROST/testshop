import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductQuery } from "./products";

// The Fastelavn shop: 7 products outside Halloween and Christmas (ids 1-7, its season) and 5
// in them (ids 101-105), 5 per page.
const SEASON = [1, 2, 3, 4, 5, 6, 7];
const REST = [101, 102, 103, 104, 105];
const fastelavnCatalog = [...SEASON.map((id) => ({ id, categories: [50] })), ...REST.map((id) => ({ id, categories: [50, 103] }))];
let catalog: { id: number; categories: number[] }[] = fastelavnCatalog;
const calls: ProductQuery[] = [];
let pluginFilters = true;

vi.mock("./products", () => ({
  PAGE_SIZE: 5,
  getCategories: async () => ({
    ok: true,
    data: [
      { id: 50, slug: "pigekostumer", name: "Pigekostumer", parent: 0 },
      { id: 103, slug: "halloween", name: "Halloween", parent: 0 },
      { id: 104, slug: "jul-og-nytaar", name: "Jul og nytår", parent: 0 },
    ],
  }),
  getPluginFeatures: async () => ({ categoryFilters: pluginFilters }),
  getProducts: async (query: ProductQuery) => {
    calls.push(query);
    const ids = catalog
      .filter((p) => !query.categoryIds || p.categories.some((c) => query.categoryIds!.includes(c)))
      .filter((p) => !query.inAnyCategoryIds || p.categories.some((c) => query.inAnyCategoryIds!.includes(c)))
      .filter((p) => !query.notInCategoryIds || !p.categories.some((c) => query.notInCategoryIds!.includes(c)))
      .map((p) => p.id);
    const start = query.offset ?? ((query.page ?? 1) - 1) * (query.perPage ?? 5);
    const page = ids.slice(start, start + (query.perPage ?? 5));
    // Like WooCommerce: an empty result reports a total of 0, unless it is a page past the
    // end (page > 1, no offset), which WooCommerce counts again.
    const total = page.length > 0 || (query.offset === undefined && (query.page ?? 1) > 1) ? ids.length : 0;
    return { ok: true, data: { products: page.map((id) => ({ id })), total, totalPages: 0, page: query.page ?? 1 } };
  },
  collectionQuery: async () => ({ ok: true, data: null }),
  getProductBySlug: async () => ({ ok: true, data: null }),
}));

const { getSeasonalProducts, seasonalParts } = await import("./collections");

const ids = async (page: number, sort: "anbefalet" | "nyeste" = "anbefalet", categoryIds = [50]) => {
  const result = await getSeasonalProducts({ categoryIds, page, sort });
  if (!result.ok) throw new Error(result.error);
  return { ids: result.data.products.map((p) => p.id), total: result.data.total, totalPages: result.data.totalPages };
};

describe("getSeasonalProducts (Fastelavn: Halloween and Christmas last)", () => {
  beforeEach(() => {
    calls.length = 0;
    pluginFilters = true;
    catalog = fastelavnCatalog;
  });

  it("lists the season's products first and then the rest, page by page, each once", async () => {
    expect(await ids(1)).toEqual({ ids: [1, 2, 3, 4, 5], total: 12, totalPages: 3 });
    expect(await ids(2)).toEqual({ ids: [6, 7, 101, 102, 103], total: 12, totalPages: 3 });
    expect(await ids(3)).toEqual({ ids: [104, 105], total: 12, totalPages: 3 });
    expect((await ids(4)).ids).toEqual([]);
  });

  it("asks WooCommerce for the season's page first, then the rest from the right offset", async () => {
    await ids(2);
    expect(calls[0]).toMatchObject({ categoryIds: [50], notInCategoryIds: [103, 104], page: 2, perPage: 5 });
    expect(calls[0]).not.toHaveProperty("offset");
    expect(calls[1]).toMatchObject({ categoryIds: [50], inAnyCategoryIds: [103, 104], page: 1, offset: 0, perPage: 3 });
  });

  it("keeps the right total on pages wholly past the season's products", async () => {
    await ids(3);
    // The season's page 3 is empty, but WooCommerce still reports its 7 products, so the rest starts at 3.
    expect(calls[0]).toMatchObject({ notInCategoryIds: [103, 104], page: 3, perPage: 5 });
    expect(calls[1]).toMatchObject({ inAnyCategoryIds: [103, 104], page: 1, offset: 3, perPage: 5 });
  });

  it("uses the plain listing for other sortings, the season's own categories and an older plugin", async () => {
    expect((await ids(1, "nyeste")).ids).toEqual([1, 2, 3, 4, 5]);
    expect(calls.at(-1)).not.toHaveProperty("notInCategoryIds");
    await ids(1, "anbefalet", [103]);
    expect(calls.at(-1)).not.toHaveProperty("notInCategoryIds");
    pluginFilters = false;
    await ids(1);
    expect(calls.at(-1)).not.toHaveProperty("notInCategoryIds");
    expect(calls).toHaveLength(3);
  });
});

describe("getSeasonalProducts (Halloween: Halloween first, Christmas last)", () => {
  // Halloween products 1-3, others 201-204, Christmas 301-303 (one Christmas product is Halloween too).
  const halloweenCatalog = [
    ...[1, 2, 3].map((id) => ({ id, categories: [50, 103] })),
    ...[201, 202, 203, 204].map((id) => ({ id, categories: [50] })),
    ...[301, 302].map((id) => ({ id, categories: [50, 104] })),
    { id: 303, categories: [50, 103, 104] },
  ];

  async function halloweenIds(page: number, categoryIds = [50]) {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_STORE_ID", "halloween-kostumer-dk");
    try {
      const { getSeasonalProducts: seasonal } = await import("./collections");
      const result = await seasonal({ categoryIds, page, sort: "anbefalet" });
      if (!result.ok) throw new Error(result.error);
      return { ids: result.data.products.map((p) => p.id), total: result.data.total, totalPages: result.data.totalPages };
    } finally {
      vi.unstubAllEnvs();
    }
  }

  beforeEach(() => {
    calls.length = 0;
    pluginFilters = true;
    catalog = halloweenCatalog;
  });

  it("puts the hidden Christmas products after everything else, each product once", async () => {
    expect(await halloweenIds(1)).toEqual({ ids: [1, 2, 3, 303, 201], total: 10, totalPages: 2 });
    expect(await halloweenIds(2)).toEqual({ ids: [202, 203, 204, 301, 302], total: 10, totalPages: 2 });
  });

  it("counts a part read wholly past its end, so the next part starts at the right product", async () => {
    // Page 5 at 2 per page: wholly past Halloween (4 products) and the others (4), so into Christmas.
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_STORE_ID", "halloween-kostumer-dk");
    const { getSeasonalProducts: seasonal } = await import("./collections");
    const result = await seasonal({ categoryIds: [50], page: 5, perPage: 2, sort: "anbefalet" });
    vi.unstubAllEnvs();
    if (!result.ok) throw new Error(result.error);
    expect(result.data.products.map((p) => p.id)).toEqual([301, 302]);
    expect(result.data.total).toBe(10);
  });

  it("lists a hidden category's own page without putting it last", async () => {
    expect((await halloweenIds(1, [104])).ids).toEqual([303, 301, 302]);
  });
});

describe("seasonalParts", () => {
  it("keeps the Fastelavn shop's two reads (its season categories are its hidden ones)", () => {
    expect(seasonalParts([103, 104], [103, 104], "out")).toEqual([{ notInCategoryIds: [103, 104] }, { inAnyCategoryIds: [103, 104] }]);
  });

  it("gives the Halloween shop the season, the rest and the hidden categories", () => {
    expect(seasonalParts([103], [104], "in")).toEqual([
      { inAnyCategoryIds: [103] },
      { notInCategoryIds: [103, 104] },
      { inAnyCategoryIds: [104], notInCategoryIds: [103] },
    ]);
    expect(seasonalParts([103], [], "in")).toEqual([{ inAnyCategoryIds: [103] }, { notInCategoryIds: [103] }]);
  });
});
