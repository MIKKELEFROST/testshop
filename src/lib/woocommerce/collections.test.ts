import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductQuery } from "./products";

// 7 products of the shop's season (ids 1-7) and 5 others (ids 101-105), 5 per page.
const SEASON = [1, 2, 3, 4, 5, 6, 7];
const REST = [101, 102, 103, 104, 105];
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
    // The Fastelavn shop prefers products outside Halloween and Christmas.
    const ids = query.notInCategoryIds ? SEASON : query.inAnyCategoryIds ? REST : [...SEASON, ...REST];
    const start = query.offset ?? ((query.page ?? 1) - 1) * (query.perPage ?? 5);
    const page = ids.slice(start, start + (query.perPage ?? 5));
    return { ok: true, data: { products: page.map((id) => ({ id })), total: ids.length, totalPages: 0, page: query.page ?? 1 } };
  },
  collectionQuery: async () => null,
  getProductBySlug: async () => ({ ok: true, data: null }),
}));

const { getSeasonalProducts } = await import("./collections");

const ids = async (page: number, sort: "anbefalet" | "nyeste" = "anbefalet", categoryIds = [50]) => {
  const result = await getSeasonalProducts({ categoryIds, page, sort });
  if (!result.ok) throw new Error(result.error);
  return { ids: result.data.products.map((p) => p.id), total: result.data.total, totalPages: result.data.totalPages };
};

describe("getSeasonalProducts (Fastelavn: Halloween and Christmas last)", () => {
  beforeEach(() => {
    calls.length = 0;
    pluginFilters = true;
  });

  it("lists the season's products first and then the rest, page by page, each once", async () => {
    expect(await ids(1)).toEqual({ ids: [1, 2, 3, 4, 5], total: 12, totalPages: 3 });
    expect(await ids(2)).toEqual({ ids: [6, 7, 101, 102, 103], total: 12, totalPages: 3 });
    expect(await ids(3)).toEqual({ ids: [104, 105], total: 12, totalPages: 3 });
    expect((await ids(4)).ids).toEqual([]);
  });

  it("asks WooCommerce for the season first, then the rest, from the right offset", async () => {
    await ids(2);
    expect(calls[0]).toMatchObject({ categoryIds: [50], notInCategoryIds: [103, 104], offset: 5, perPage: 5 });
    expect(calls[1]).toMatchObject({ categoryIds: [50], inAnyCategoryIds: [103, 104], offset: 0, perPage: 3 });
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
