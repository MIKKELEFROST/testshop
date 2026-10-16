import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";

/** A WooCommerce answer: the JSON body and the paging headers. */
type Answer = { body: unknown; total?: number; totalPages?: number };
type Route = (path: string, query: Record<string, unknown>) => Answer | Promise<Answer>;

let route: Route = () => ({ body: [] });
const requests: { path: string; query: Record<string, unknown> }[] = [];

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {} }));
vi.mock("./client", () => ({
  wooRequest: async (path: string, options: { query?: Record<string, unknown>; schema: z.ZodType }) => {
    const query = options.query ?? {};
    requests.push({ path, query });
    const answer = await route(path, query);
    const headers = new Headers();
    if (answer.total !== undefined) headers.set("x-wp-total", String(answer.total));
    if (answer.totalPages !== undefined) headers.set("x-wp-totalpages", String(answer.totalPages));
    return { status: 200, data: options.schema.parse(answer.body), headers };
  },
}));

const { getAllProductSlugs, getCategories, getProducts, getRelatedProducts } = await import("./products");

const category = (id: number, slug: string, count: number, parent = 0) => ({ id, name: slug, slug, parent, count });
const product = (id: number, name: string, categories: number[]) => ({
  id,
  name,
  slug: `p${id}`,
  type: "simple",
  status: "publish",
  categories: categories.map((c) => ({ id: c, name: `C${c}`, slug: `c${c}` })),
  tags: [{ id: 114, name: "Dyr", slug: "dyr" }],
});

beforeEach(() => {
  requests.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getProducts", () => {
  it("sorts 'Anbefalet' by the shop's merchandising order and 'Nyeste' by date", async () => {
    route = () => ({ body: [], total: 0, totalPages: 0 });
    await getProducts();
    expect(requests[0]?.query).toMatchObject({ orderby: "menu_order", order: "asc" });
    await getProducts({ sort: "nyeste" });
    expect(requests[1]?.query).toMatchObject({ orderby: "date", order: "desc" });
  });

  it("answers with the friendly error when WooCommerce can't be read", async () => {
    route = () => Promise.reject(new Error("WooCommerce is unreachable"));
    expect(await getProducts()).toEqual({ ok: false, error: "Vi kan ikke hente produkterne lige nu. Prøv igen om lidt." });
  });
});

describe("getAllProductSlugs", () => {
  it("reads every page, a few at a time, and keeps the products in page order", async () => {
    let active = 0;
    let most = 0;
    route = async (_path, query) => {
      active++;
      most = Math.max(most, active);
      // Later pages answer first, to show the order does not depend on timing.
      await new Promise((resolve) => setTimeout(resolve, 20 - Number(query.page)));
      active--;
      return { body: [{ slug: `p${query.page}a`, categories: [{ id: 5, name: "Halloween", slug: "halloween" }] }, { slug: `p${query.page}b` }], totalPages: 8 };
    };
    const products = await getAllProductSlugs();
    expect(products.ok && products.data.map((p) => p.slug)).toEqual(Array.from({ length: 8 }, (_, i) => [`p${i + 1}a`, `p${i + 1}b`]).flat());
    expect(products.ok && products.data.slice(0, 2)).toEqual([{ slug: "p1a", categoryIds: [5] }, { slug: "p1b", categoryIds: [] }]);
    expect(requests[0]?.query._fields).toBe("slug,categories");
    expect(most).toBeLessThanOrEqual(3);
  });

  it("stops reading after a failure, and fails (the sitemap then keeps its last version)", async () => {
    route = (_path, query) => (query.page === 3 ? Promise.reject(new Error("HTTP 508")) : { body: [{ slug: "x" }], totalPages: 40 });
    expect((await getAllProductSlugs()).ok).toBe(false);
    expect(requests.length).toBeLessThan(10);
  });
});

describe("getCategories", () => {
  it("counts this shop's products per category, and uses WooCommerce's own count when one count fails (plugin 1.3)", async () => {
    route = (path, query) => {
      if (path === "wc-headless/v1/status") return { body: { version: "1.3.1" } };
      if (path === "wc/v3/products/categories") return { body: [category(1, "damekostumer", 500), category(2, "hatte", 90)], totalPages: 1 };
      if (query.category === 2) return Promise.reject(new Error("HTTP 508"));
      return { body: [{ id: 7 }], total: 420 };
    };
    const result = await getCategories();
    expect(result.ok && result.data.map((c) => [c.slug, c.count])).toEqual([
      ["damekostumer", 420],
      ["hatte", 90],
    ]);
  });
});

describe("getRelatedProducts (Fastelavn shop)", () => {
  // Babykostumer 7; Tilbehør 10 with Hatte 11; Halloween 103 and Jul og nytår 104 are hidden in this shop.
  const tree = [category(7, "babykostumer", 50), category(10, "tilbehoer", 90), category(11, "hatte", 40, 10), category(103, "halloween", 30), category(104, "jul-og-nytaar", 20)];
  const answer = (plugin: string): Route => (path, query) => {
    if (path === "wc-headless/v1/status") return { body: { version: plugin } };
    if (path === "wc/v3/products/categories") return { body: tree, totalPages: 1 };
    if (path.endsWith("/category-counts")) return { body: Object.fromEntries(tree.map((c) => [String(c.id), c.count])) };
    if (query.per_page === 1) return { body: [{ id: 1 }], total: 10 };
    if (query.category === "10") {
      // Accessories with the costume's theme ("Dyr"), the way Guirca tags them.
      return { body: [product(21, "Ring med edderkop", [11, 103]), product(22, "Nissehue", [11, 104]), product(23, "Sorte flagermusvinger", [11]), product(24, "Dinohue", [11])] };
    }
    if (query.category === "7" && query.tag === undefined && query.per_page === 100) {
      // The fallback: accessories from the costume's own category.
      return { body: [product(31, "Flagermus-hårbøjle", [11, 7]), product(32, "Løvemanke", [11, 7])] };
    }
    return { body: [product(41, "Krokodille – kostume til baby", [7]), product(42, "Skelet – kostume til baby", [7]), product(43, "Rensdyr til jul", [7, 104])] };
  };
  const dino = { id: 1, name: "Dino – kostume til baby", tags: [{ id: 114, name: "Dyr" }], audience: [], categories: [{ id: 7, name: "Babykostumer", slug: "babykostumer" }] };

  it("leaves out Halloween, Christmas and off-season names, also in the fallback", async () => {
    route = answer("1.3.1");
    const { accessories, similar } = await getRelatedProducts(dino);
    expect(accessories.map((p) => p.id)).toEqual([24, 32]);
    expect(similar.map((p) => p.id)).toEqual([41]);
    expect(requests.filter((r) => r.path === "wc/v3/products" && r.query.per_page !== 1).every((r) => r.query.wchc_not_in_category === undefined)).toBe(true);
  });

  it("asks WooCommerce to leave the hidden categories out with plugin 1.4", async () => {
    route = answer("1.4.0");
    await getRelatedProducts(dino);
    const reads = requests.filter((r) => r.path === "wc/v3/products");
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((r) => r.query.wchc_not_in_category === "103,104")).toBe(true);
  });
});
