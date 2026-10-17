import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";

type Route = (path: string, query: Record<string, unknown>) => unknown;

let route: Route = () => [];
const requests: { path: string; query: Record<string, unknown>; priority?: string }[] = [];

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {} }));
vi.mock("./client", () => ({
  wooRequest: async (path: string, options: { query?: Record<string, unknown>; schema: z.ZodType; priority?: string }) => {
    const query = options.query ?? {};
    requests.push({ path, query, priority: options.priority });
    return { status: 200, data: options.schema.parse(await route(path, query)), headers: new Headers() };
  },
}));

const { filteredListing, getFilterOptions, resolveFilters } = await import("./filters");

const TERMS = [
  { id: 21, name: "3-4 år" },
  { id: 22, name: "5-6 år" },
  { id: 26, name: "7-9 år" },
  { id: 31, name: "S (36-38)" },
  { id: 36, name: "L (52-54)" },
];

/** WooCommerce: the size attribute and its terms, and a listing's facets from the Store API. */
function shop(facets: unknown = null): Route {
  return (path) => {
    if (path === "wc/v3/products/attributes") return [{ id: 3, slug: "pa_farve" }, { id: 1, slug: "pa_storrelse" }];
    if (path === "wc/v3/products/attributes/1/terms") return TERMS;
    if (path === "wc/store/v1/products/collection-data") {
      if (facets === null) throw new Error("WooCommerce is unreachable");
      return facets;
    }
    throw new Error(`unexpected ${path}`);
  };
}

const facets = (terms: number[], min: number, max: number, outOfStock = 0, count = 4) => ({
  price_range: { min_price: String(min * 100), max_price: String(max * 100), currency_minor_unit: 2 },
  attribute_counts: terms.map((term) => ({ term, count })),
  stock_status_counts: [
    { status: "instock", count: "40" },
    { status: "outofstock", count: String(outOfStock) },
  ],
});

beforeEach(() => {
  requests.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveFilters", () => {
  it("turns the chosen size, price band and stock filter into a product query", async () => {
    route = shop();
    expect(await resolveFilters({ size: "5-6-aar", price: "100-250", inStock: true })).toEqual({
      query: { sizeTermIds: [22], minPrice: 100, maxPrice: 249.99, inStockOnly: true },
      selection: { size: "5-6-aar", price: "100-250", inStock: true },
    });
    expect((await resolveFilters({ price: "under-100" })).query).toEqual({ maxPrice: 99.99 });
    expect((await resolveFilters({ price: "over-500" })).query).toEqual({ minPrice: 500 });
    expect(requests.find((r) => r.path === "wc/v3/products/attributes/1/terms")?.query).toMatchObject({ hide_empty: true });
    // Critical reads: a chosen size can't be applied without them (not "background", which fails
    // at once while the breaker is open).
    expect(requests.filter((r) => r.path.startsWith("wc/v3/products/attributes")).map((r) => r.priority)).toEqual([undefined, undefined]);
  });

  it("drops a size the shop doesn't have, and asks nothing without a size", async () => {
    route = shop();
    expect(await resolveFilters({ size: "xl", price: "under-100" })).toEqual({ query: { maxPrice: 99.99 }, selection: { price: "under-100" } });
    requests.length = 0;
    expect(await resolveFilters({})).toEqual({ query: {}, selection: {} });
    expect(requests).toEqual([]);
  });

  it("says so when a chosen size can't be looked up, so the page doesn't show every size as if filtered", async () => {
    route = () => {
      throw new Error("WooCommerce is unreachable");
    };
    const filters = await resolveFilters({ size: "5-6-aar", price: "under-100" });
    expect(filters.error).toBe("Vi kan ikke hente produkterne lige nu. Prøv igen om lidt.");
    const read = vi.fn(async () => ({ ok: true as const, data: [] }));
    expect(await filteredListing(filters, read)).toEqual({ ok: false, error: filters.error });
    expect(read).not.toHaveBeenCalled();
    // Without a size the terms aren't needed: the listing is read with the other filters.
    const priced = await resolveFilters({ price: "under-100" });
    expect(priced.error).toBeUndefined();
    expect(await filteredListing(priced, read)).toEqual({ ok: true, data: [] });
    expect(read).toHaveBeenCalledWith({ maxPrice: 99.99 });
  });
});

describe("getFilterOptions", () => {
  it("offers only the sizes, prices and stock filter the listing has", async () => {
    route = shop(facets([21, 22], 39, 229));
    const options = await getFilterOptions({ categoryIds: [61, 16] }, {});
    expect(options).toEqual({
      sizes: [{ key: "boern", label: "Børn", options: [{ key: "2-4-aar", label: "2-4 år" }, { key: "5-6-aar", label: "5-6 år" }] }],
      prices: [{ key: "under-100", label: "Under 100 kr." }, { key: "100-250", label: "100-250 kr." }],
      stock: false,
    });
    expect(requests.find((r) => r.path === "wc/store/v1/products/collection-data")?.query).toMatchObject({
      "calculate_attribute_counts[0][taxonomy]": "pa_storrelse",
      category: "16,61",
      tag: undefined,
    });
  });

  it("keeps what is chosen, and offers 'Kun på lager' when something is sold out", async () => {
    route = shop(facets([21], 39, 99, 3));
    const options = await getFilterOptions({ tagIds: [7] }, { size: "l", price: "over-500" });
    expect(options.sizes.map((g) => g.options.map((o) => o.key))).toEqual([["2-4-aar"], ["l"]]);
    expect(options.prices.map((p) => p.key)).toEqual(["under-100", "over-500"]);
    expect(options.stock).toBe(true);
  });

  it("leaves out sizes only a couple of the listing's products have", async () => {
    route = shop(facets([21, 36], 9, 899, 0, 2));
    expect((await getFilterOptions({ categoryIds: [17] }, {})).sizes).toEqual([]);
    route = shop({ price_range: null, attribute_counts: [{ term: 21, count: 3 }, { term: 22, count: 1 }, { term: 36, count: 0 }], stock_status_counts: null });
    expect((await getFilterOptions({ categoryIds: [17] }, {})).sizes.map((g) => g.options.map((o) => o.key))).toEqual([["2-4-aar"]]);
  });

  it("offers every size and price band when the listing's facets can't be read", async () => {
    route = shop(null);
    const options = await getFilterOptions({ categoryIds: [61] }, {});
    expect(options.sizes.map((g) => g.options.length)).toEqual([3, 2]);
    expect(options.prices).toHaveLength(4);
    expect(options.stock).toBe(false);
  });
});
