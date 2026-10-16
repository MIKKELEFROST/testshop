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

const { getAllProductSlugs, getCategories, getProductBySlug, getProductPhoto, getProducts, getProductsByIds, getRelatedProducts, getSearchMatches } = await import("./products");

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

  it("asks WooCommerce for the listing filters: sizes, price band and stock", async () => {
    route = () => ({ body: [], total: 0, totalPages: 0 });
    await getProducts({ sizeTermIds: [22, 160], minPrice: 100, maxPrice: 249.99, inStockOnly: true });
    expect(requests[0]?.query).toMatchObject({ attribute: "pa_storrelse", attribute_term: "22,160", min_price: 100, max_price: 249.99, stock_status: "instock" });
    await getProducts();
    for (const name of ["attribute", "attribute_term", "min_price", "max_price", "stock_status"]) expect(requests[1]?.query[name]).toBeUndefined();
  });

  it("answers with the friendly error when WooCommerce can't be read", async () => {
    route = () => Promise.reject(new Error("WooCommerce is unreachable"));
    expect(await getProducts()).toEqual({ ok: false, error: "Vi kan ikke hente produkterne lige nu. Prøv igen om lidt." });
  });
});

describe("this shop's products only", () => {
  // The tests run as the Fastelavn shop (piece-dk). WooCommerce (Headless Checkout Bridge 1.2+)
  // answers `wchc_shop` with that webshop's products only, so a product only the Halloween
  // shop sells (the products for adults only) is never in it, nor its product page.
  it("asks for them in listings, search, favourites, the sitemap, product pages, photos and recommendations", async () => {
    route = (path, query) => {
      if (path === "wc-headless/v1/status") return { body: { version: "1.4.0" } };
      if (path === "wc/v3/products/categories") return { body: [category(7, "babykostumer", 5)], totalPages: 1 };
      if (path.endsWith("/category-counts")) return { body: { "7": 5 } };
      if (query.slug) return { body: [{ ...product(1, "Dino – kostume til baby", [7]), webshops: ["halloween-kostumer-dk", "piece-dk"] }] };
      return { body: [product(2, "Krokodille – kostume til baby", [7])], total: 1, totalPages: 1 };
    };
    await getProducts({ hideAdult: true });
    await getSearchMatches("krokodille");
    await getProductsByIds([2]);
    await getAllProductSlugs();
    const page = await getProductBySlug("p1");
    await getProductPhoto("p1");
    await getRelatedProducts({ id: 1, name: "Dino – kostume til baby", tags: [{ id: 114, name: "Dyr" }], audience: [], categories: [{ id: 7, name: "Babykostumer", slug: "babykostumer" }] });
    const reads = requests.filter((r) => r.path === "wc/v3/products");
    expect(reads.length).toBeGreaterThanOrEqual(7);
    for (const read of reads) expect(read.query.wchc_shop, JSON.stringify(read.query)).toBe("piece-dk");
    // The product page knows which webshops sell it (for its home shop, see lib/home-store.ts).
    expect(page.ok && page.data?.webshops).toEqual(["halloween-kostumer-dk", "piece-dk"]);
  });
});

describe("leaving out the 18+ products", () => {
  /** `count` products in "Polterabend (18+)" (category 8), IDs 1 … count, 100 per page. */
  const adult = (count: number): Route => (path, query) => {
    if (path === "wc-headless/v1/status") return { body: { version: "1.4.0" } };
    if (path === "wc/v3/products/categories") return { body: [category(8, "polterabend-18", count), category(1, "kostumer", 500)], totalPages: 1 };
    if (path.endsWith("/category-counts")) return { body: { "8": count, "1": 500 } };
    if (query.category === "8") {
      const page = Number(query.page);
      const ids = Array.from({ length: count }, (_, i) => i + 1).slice((page - 1) * 100, page * 100);
      return { body: ids.map((id) => ({ id })), total: count, totalPages: Math.ceil(count / 100) };
    }
    return { body: [], total: 0, totalPages: 0 };
  };
  const adultReads = () => requests.filter((r) => r.path === "wc/v3/products" && r.query.category === "8");
  const listing = () => requests.find((r) => r.path === "wc/v3/products" && r.query.category === undefined);

  it("leaves every one of them out of a listing, also more than a page of 100", async () => {
    route = adult(150);
    expect((await getProducts({ hideAdult: true })).ok).toBe(true);
    expect(adultReads().map((r) => r.query.page)).toEqual([1, 2]);
    expect(adultReads().every((r) => r.query.orderby === "id" && r.query.status === "publish" && r.query.wchc_shop === "piece-dk")).toBe(true);
    expect(String(listing()?.query.exclude).split(",").map(Number)).toEqual(Array.from({ length: 150 }, (_, i) => i + 1));
  });

  it("reads one page for up to 100 of them, and none where they are shown (their category, search)", async () => {
    route = adult(37);
    await getProducts({ hideAdult: true });
    expect(adultReads()).toHaveLength(1);
    requests.length = 0;
    await getProducts({ categoryIds: [8] });
    await getSearchMatches("penis");
    expect(requests).toHaveLength(2);
    expect(requests.every((r) => r.query.exclude === undefined)).toBe(true);
  });

  it("fails the listing (which keeps its last version) rather than show those past 1,000", async () => {
    route = adult(1001);
    expect((await getProducts({ hideAdult: true })).ok).toBe(false);
    expect(adultReads()).toHaveLength(10);
    expect(listing()).toBeUndefined();
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
      return {
        body: [{ slug: `p${query.page}a`, categories: [{ id: 5, name: "Halloween", slug: "halloween" }], webshops: ["halloween-kostumer-dk"] }, { slug: `p${query.page}b` }],
        totalPages: 8,
      };
    };
    const products = await getAllProductSlugs();
    expect(products.ok && products.data.map((p) => p.slug)).toEqual(Array.from({ length: 8 }, (_, i) => [`p${i + 1}a`, `p${i + 1}b`]).flat());
    // The webshops that sell it (none known without plugin 1.2), for its home shop.
    expect(products.ok && products.data.slice(0, 2)).toEqual([
      { slug: "p1a", categoryIds: [5], webshops: ["halloween-kostumer-dk"] },
      { slug: "p1b", categoryIds: [], webshops: [] },
    ]);
    expect(requests[0]?.query._fields).toBe("slug,categories,webshops");
    expect(most).toBeLessThanOrEqual(3);
  });

  it("stops reading after a failure, and fails (the sitemap then keeps its last version)", async () => {
    route = (_path, query) => (query.page === 3 ? Promise.reject(new Error("HTTP 508")) : { body: [{ slug: "x" }], totalPages: 40 });
    expect((await getAllProductSlugs()).ok).toBe(false);
    expect(requests.length).toBeLessThan(10);
  });
});

describe("getProductPhoto", () => {
  it("reads only the product's photos, in one request (no sizes)", async () => {
    route = () => ({ body: [{ id: 7, slug: "pirat", name: "Pirat &amp; papeg&oslash;je", images: [{ src: "https://shop.test/pirat.jpg", alt: "" }] }] });
    expect(await getProductPhoto("pirat")).toEqual({ id: 7, slug: "pirat", name: "Pirat & papegøje", image: { src: "https://shop.test/pirat.jpg", alt: "" } });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ path: "wc/v3/products", query: { slug: "pirat", status: "publish", _fields: "id,slug,name,images,meta_data" } });
  });

  it("uses the supplier's photo of a product without its own, and is null for an unknown product or a failed read", async () => {
    route = () => ({ body: [{ id: 8, slug: "heks", name: "Heks", meta_data: [{ key: "_wchc_external_images", value: ["https://marketing.guirca.com/heks.jpg"] }] }] });
    expect((await getProductPhoto("heks"))?.image?.src).toBe("https://marketing.guirca.com/heks.jpg");
    route = () => ({ body: [] });
    expect(await getProductPhoto("ukendt")).toBeNull();
    route = () => Promise.reject(new Error("HTTP 508"));
    expect(await getProductPhoto("pirat")).toBeNull();
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
