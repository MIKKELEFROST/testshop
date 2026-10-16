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

const { getAllProductSlugs, getCategories, getProducts } = await import("./products");

const category = (id: number, slug: string, count: number) => ({ id, name: slug, slug, parent: 0, count });

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
      return { body: [{ slug: `p${query.page}a` }, { slug: `p${query.page}b` }], totalPages: 8 };
    };
    const slugs = await getAllProductSlugs();
    expect(slugs).toEqual({ ok: true, data: Array.from({ length: 8 }, (_, i) => [`p${i + 1}a`, `p${i + 1}b`]).flat() });
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
