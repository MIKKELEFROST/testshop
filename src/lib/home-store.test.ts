import { describe, expect, it, vi } from "vitest";
import { merchandisingByStore } from "@/config/merchandising";
import type { ProductCategory } from "@/types/commerce";
import { categoryHomeStore, homeSeasonFor, homeStoreFor, storeName, storeUrl } from "./home-store";
import { SITE_URL } from "./seo";

function category(id: number, slug: string, parent = 0): ProductCategory {
  return { id, name: slug, slug, description: "", count: 1, image: null, parent, menuOrder: 0 };
}

const tree = [
  category(1, "kostumer"),
  category(2, "pigekostumer", 1),
  category(5, "halloween"),
  category(6, "halloweenpynt", 5),
  category(7, "jul-og-nytaar"),
  category(8, "polterabend-18"),
];
const [kostumer, pigekostumer, halloween, halloweenpynt, jul, polterabend] = tree as [ProductCategory, ProductCategory, ProductCategory, ProductCategory, ProductCategory, ProductCategory];

describe("homeStoreFor", () => {
  it("gives Halloween products and adult-only (18+) products to the Halloween shop", () => {
    expect(homeStoreFor([pigekostumer, halloween], tree)).toBe("halloween-kostumer-dk");
    expect(homeStoreFor([polterabend], tree)).toBe("halloween-kostumer-dk");
  });

  it("counts a subcategory of Halloween as Halloween", () => {
    expect(homeStoreFor([{ id: halloweenpynt.id }], tree)).toBe("halloween-kostumer-dk");
  });

  it("gives every other product, Christmas included, to the default (Fastelavn) shop", () => {
    expect(homeStoreFor([pigekostumer], tree)).toBe("piece-dk");
    expect(homeStoreFor([jul], tree)).toBe("piece-dk");
    expect(homeStoreFor([], tree)).toBe("piece-dk");
  });

  it("uses the product's own category slugs when the category tree can't be read", () => {
    expect(homeStoreFor([{ id: 5, slug: "halloween" }], [])).toBe("halloween-kostumer-dk");
    expect(homeStoreFor([{ id: 6 }], [])).toBe("piece-dk");
  });

  it("is always a shop that sells the product: the crude jokes for adults only sold in the Halloween shop belong there", () => {
    const onlyHalloween = ["halloween-kostumer-dk"];
    // A crude costume or apron outside Halloween, and the naked Christmas apron.
    expect(homeStoreFor([pigekostumer], tree, onlyHalloween)).toBe("halloween-kostumer-dk");
    expect(homeStoreFor([jul], tree, onlyHalloween)).toBe("halloween-kostumer-dk");
    expect(homeStoreFor([], tree, onlyHalloween)).toBe("halloween-kostumer-dk");
    // And the other way round: a Halloween product only the Fastelavn shop sells.
    expect(homeStoreFor([halloween], tree, ["piece-dk"])).toBe("piece-dk");
    // Sold in both, or webshops unknown (none, or none of the shops here): the categories decide.
    for (const webshops of [["piece-dk", "halloween-kostumer-dk"], [], ["ukendt"]]) {
      expect(homeStoreFor([pigekostumer], tree, webshops), webshops.join()).toBe("piece-dk");
      expect(homeStoreFor([pigekostumer, halloween], tree, webshops), webshops.join()).toBe("halloween-kostumer-dk");
    }
  });
});

describe("homeSeasonFor", () => {
  // The tests run as the default shop (piece-dk).
  it("names this shop's holiday for its own season products only", () => {
    expect(homeSeasonFor([pigekostumer], tree)).toBe("fastelavn");
    // A Santa suit belongs to the Fastelavn shop, but is not for fastelavn.
    expect(homeSeasonFor([jul], tree)).toBeNull();
    // The Halloween shop's products: none in this shop's copy.
    expect(homeSeasonFor([pigekostumer, halloween], tree)).toBeNull();
    // Nor for a product only the Halloween shop sells.
    expect(homeSeasonFor([pigekostumer], tree, ["halloween-kostumer-dk"])).toBeNull();
  });

  it("in the Halloween shop: halloween for its Halloween products, none for 18+ products and the Fastelavn shop's", async () => {
    vi.stubEnv("NEXT_PUBLIC_STORE_ID", "halloween-kostumer-dk");
    vi.resetModules();
    const shop = await import("./home-store");
    expect(shop.homeSeasonFor([halloweenpynt], tree)).toBe("halloween");
    expect(shop.homeSeasonFor([polterabend], tree)).toBeNull();
    expect(shop.homeSeasonFor([pigekostumer], tree)).toBeNull();
    // A crude costume only this shop sells is at home here, but is no Halloween costume.
    expect(shop.homeSeasonFor([pigekostumer], tree, ["halloween-kostumer-dk"])).toBeNull();
    expect(shop.homeSeasonFor([pigekostumer, halloween], tree, ["halloween-kostumer-dk"])).toBe("halloween");
    vi.unstubAllEnvs();
  });
});

describe("storeName", () => {
  it("is this shop's own name, and the other shops' brand names", () => {
    // The tests run as the default shop (piece-dk).
    expect(storeName("piece-dk")).toBe("Fastelavnskostumer.dk");
    expect(storeName("halloween-kostumer-dk")).toBe("Halloweenkostumer.dk");
    expect(storeName("ukendt")).toBe("Fastelavnskostumer.dk");
  });
});

describe("storeUrl", () => {
  it("is this shop's own address, and the other shops' domains", () => {
    // The tests run as the default shop (piece-dk).
    expect(storeUrl("piece-dk")).toBe(SITE_URL);
    expect(storeUrl("halloween-kostumer-dk")).toBe("https://halloweenkostumer.dk");
    expect(storeUrl("ukendt")).toBe(SITE_URL);
  });
});

describe("categoryHomeStore", () => {
  // As in WooCommerce: the decorations and effects are not under "Halloween".
  const shopTree = [
    category(1, "kostumer"),
    category(5, "halloween"),
    category(7, "jul-og-nytaar"),
    category(90, "make-up"),
    category(91, "blod-og-effekter", 90),
    category(94, "pynt-og-fest"),
    category(95, "halloweenpynt", 94),
    category(96, "figurer-og-animatronics", 94),
    category(101, "slik-eller-ballade", 94),
    category(102, "julepynt", 94),
  ];
  const slug = (s: string) => shopTree.find((c) => c.slug === s)!;
  const halloweenOnly = ["halloweenpynt", "slik-eller-ballade", "figurer-og-animatronics", "blod-og-effekter"];

  it("in the Fastelavn shop: sends Halloween's categories to the Halloween shop, and keeps its own and Christmas", () => {
    // The tests run as the default shop (piece-dk).
    expect(categoryHomeStore(slug("halloween"), shopTree)).toBe("halloween-kostumer-dk");
    for (const s of halloweenOnly) expect(categoryHomeStore(slug(s), shopTree), s).toBe("halloween-kostumer-dk");
    // Neither shop shows Christmas: its products' home, the Fastelavn shop.
    expect(categoryHomeStore(slug("jul-og-nytaar"), shopTree)).toBe("piece-dk");
    expect(categoryHomeStore(slug("julepynt"), shopTree)).toBe("piece-dk");
    for (const s of ["kostumer", "make-up", "pynt-og-fest"]) expect(categoryHomeStore(slug(s), shopTree), s).toBe("piece-dk");
  });

  it("in the Halloween shop: sends Christmas to the Fastelavn shop, and keeps the rest", async () => {
    vi.stubEnv("NEXT_PUBLIC_STORE_ID", "halloween-kostumer-dk");
    vi.resetModules();
    const shop = await import("./home-store");
    expect(shop.categoryHomeStore(slug("julepynt"), shopTree)).toBe("piece-dk");
    expect(shop.categoryHomeStore(slug("jul-og-nytaar"), shopTree)).toBe("piece-dk");
    for (const s of ["halloween", ...halloweenOnly, "kostumer", "pynt-og-fest"]) {
      expect(shop.categoryHomeStore(slug(s), shopTree), s).toBe("halloween-kostumer-dk");
    }
    vi.unstubAllEnvs();
  });

  it("only moves category pages: the products in them keep their home", () => {
    // Halloween decorations are also in "Halloween", which gives them the Halloween shop.
    expect(homeStoreFor([slug("halloweenpynt"), slug("halloween")], shopTree)).toBe("halloween-kostumer-dk");
    // A Christmas figure in "Figurer og animatronics" stays in the Fastelavn shop.
    expect(homeStoreFor([slug("figurer-og-animatronics"), slug("jul-og-nytaar")], shopTree)).toBe("piece-dk");
  });

  it("keeps a category shown in this shop here, even when its products' home is another shop", () => {
    const shops = { "piece-dk": { ...merchandisingByStore["piece-dk"]!, hidden: [], navHidden: [] } };
    expect(categoryHomeStore(slug("halloween"), shopTree, shops)).toBe("piece-dk");
    expect(categoryHomeStore(kostumer, tree, shops)).toBe("piece-dk");
  });
});
