import { describe, expect, it, vi } from "vitest";
import type { ProductCategory } from "@/types/commerce";
import { categoryHomeStore, homeSeasonFor, homeStoreFor, storeUrl } from "./home-store";
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
});

describe("homeSeasonFor", () => {
  // The tests run as the default shop (piece-dk).
  it("names this shop's holiday for its own season products only", () => {
    expect(homeSeasonFor([pigekostumer], tree)).toBe("fastelavn");
    // A Santa suit belongs to the Fastelavn shop, but is not for fastelavn.
    expect(homeSeasonFor([jul], tree)).toBeNull();
    // The Halloween shop's products: none in this shop's copy.
    expect(homeSeasonFor([pigekostumer, halloween], tree)).toBeNull();
  });

  it("in the Halloween shop: halloween for its Halloween products, none for 18+ products and the Fastelavn shop's", async () => {
    vi.stubEnv("NEXT_PUBLIC_STORE_ID", "halloween-kostumer-dk");
    vi.resetModules();
    const shop = await import("./home-store");
    expect(shop.homeSeasonFor([halloweenpynt], tree)).toBe("halloween");
    expect(shop.homeSeasonFor([polterabend], tree)).toBeNull();
    expect(shop.homeSeasonFor([pigekostumer], tree)).toBeNull();
    vi.unstubAllEnvs();
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
  it("sends a hidden category to its home shop, and keeps every other category here", () => {
    const hidden = ["halloween", "jul-og-nytaar"];
    expect(categoryHomeStore(halloween, tree, hidden)).toBe("halloween-kostumer-dk");
    expect(categoryHomeStore(jul, tree, hidden)).toBe("piece-dk");
    // Shown in this shop: its page stays here, even when its home is another shop.
    expect(categoryHomeStore(halloween, tree, [])).toBe("piece-dk");
    expect(categoryHomeStore(kostumer, tree, hidden)).toBe("piece-dk");
  });
});
