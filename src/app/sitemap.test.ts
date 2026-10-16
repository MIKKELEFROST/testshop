import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductCategory } from "@/types/commerce";

const category = (id: number, slug: string, parent = 0): ProductCategory => ({ id, name: slug, slug, description: "", count: 5, image: null, parent, menuOrder: 0 });

// The category tree as in WooCommerce: the decorations and effects are not under "Halloween".
const tree = [
  category(1, "kostumer"),
  category(2, "pigekostumer", 1),
  category(5, "halloween"),
  category(7, "jul-og-nytaar"),
  category(8, "polterabend-18"),
  category(90, "make-up"),
  category(91, "blod-og-effekter", 90),
  category(92, "sminke-og-ansigtsmaling", 90),
  category(94, "pynt-og-fest"),
  category(95, "halloweenpynt", 94),
  category(96, "figurer-og-animatronics", 94),
  category(101, "slik-eller-ballade", 94),
  category(102, "julepynt", 94),
];

// Products as WooCommerce lists them for a shop. In reality each shop gets only the ones it
// sells; here both get all, so a shop must also leave out those it doesn't sell.
const products = [
  { slug: "pirat", categoryIds: [2], webshops: ["halloween-kostumer-dk", "piece-dk"] },
  { slug: "heks", categoryIds: [2, 5], webshops: ["halloween-kostumer-dk", "piece-dk"] },
  { slug: "nisse", categoryIds: [7], webshops: [] },
  // The crude jokes for adults only, in their own categories, sold only in the Halloween shop.
  { slug: "penisforklaede", categoryIds: [1], webshops: ["halloween-kostumer-dk"] },
  { slug: "noegen-juleforklaede", categoryIds: [7], webshops: ["halloween-kostumer-dk"] },
  { slug: "ball-gag", categoryIds: [8], webshops: ["halloween-kostumer-dk"] },
];

vi.mock("@/components/content/info-page", () => ({ INFO_LINKS: [{ label: "Kontakt", href: "/kontakt" }] }));
vi.mock("@/lib/woocommerce/products", () => ({
  getCategories: async () => ({ ok: true, data: tree }),
  getAllProductSlugs: async () => ({ ok: true, data: products }),
}));

const SHOPS = ["piece-dk", "halloween-kostumer-dk"];

/** The shop's sitemap (its category slugs) and where its category pages point (slug -> store ID). */
async function shop(storeId: string) {
  vi.stubEnv("NEXT_PUBLIC_STORE_ID", storeId);
  vi.resetModules();
  const [{ default: sitemap }, { categoryHomeStore }] = await Promise.all([import("./sitemap"), import("@/lib/home-store")]);
  const urls = (await sitemap()).map((entry) => new URL(entry.url).pathname);
  return {
    urls,
    categories: urls.filter((path) => path.startsWith("/kategori/")).map((path) => path.slice("/kategori/".length)),
    products: urls.filter((path) => path.startsWith("/produkter/")).map((path) => path.slice("/produkter/".length)),
    homes: new Map(tree.map((c) => [c.slug, categoryHomeStore(c, tree)])),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sitemap", () => {
  it("lists the front page, all products, the themes overview and the information pages", async () => {
    for (const id of SHOPS) {
      const { urls } = await shop(id);
      for (const path of ["/", "/produkter", "/tema", "/kontakt"]) expect(urls, `${id}: ${path}`).toContain(path);
      expect(new Set(urls).size, id).toBe(urls.length);
    }
  });

  it("lists each product in one shop only, a shop that sells it: the crude jokes for adults in the Halloween shop", async () => {
    const piece = await shop("piece-dk");
    const halloween = await shop("halloween-kostumer-dk");
    expect(piece.products).toEqual(["pirat", "nisse"]);
    expect(halloween.products).toEqual(["heks", "penisforklaede", "noegen-juleforklaede", "ball-gag"]);
  });

  it("lists no category page whose home is the other shop, and lists each one in its home shop", async () => {
    const shops = new Map<string, Awaited<ReturnType<typeof shop>>>();
    for (const id of SHOPS) shops.set(id, await shop(id));
    for (const [id, { categories, homes }] of shops) {
      for (const c of tree) {
        const home = homes.get(c.slug)!;
        if (home === id) expect(categories, `${id}: ${c.slug}`).toContain(c.slug);
        else {
          expect(categories, `${id}: ${c.slug}`).not.toContain(c.slug);
          expect(shops.get(home)?.categories, `${home}: ${c.slug}`).toContain(c.slug);
        }
      }
    }
    for (const slug of ["halloween", "halloweenpynt", "slik-eller-ballade", "figurer-og-animatronics", "blod-og-effekter"]) {
      expect(shops.get("piece-dk")?.categories, slug).not.toContain(slug);
      expect(shops.get("halloween-kostumer-dk")?.categories, slug).toContain(slug);
    }
    for (const slug of ["jul-og-nytaar", "julepynt"]) {
      expect(shops.get("piece-dk")?.categories, slug).toContain(slug);
      expect(shops.get("halloween-kostumer-dk")?.categories, slug).not.toContain(slug);
    }
  });
});
