import { describe, expect, it } from "vitest";
import { mapCategory, mapProduct, mapProductSummary, productImages } from "./mappers";
import { wcCategorySchema, wcProductSchema } from "./schemas";

function product(overrides: Record<string, unknown> = {}) {
  return wcProductSchema.parse({
    id: 1,
    name: "Mørk enhjørning – kostume til piger",
    slug: "moerk-enhjoerning",
    type: "variable",
    status: "publish",
    ...overrides,
  });
}

const supplierPhotos = {
  meta_data: [
    {
      key: "_wchc_external_images",
      value: [
        "https://marketing.guirca.com/78224/78224.jpg",
        "http://marketing.guirca.com/78224/78224_02.jpg", // not https
        "https://evil.example.com/x.jpg", // host not allowed
        42,
      ],
    },
    { key: "_wchc_size_chart", value: "https://static.guirca.com/media/mailing/tallas/UK/Size%20chart_CHILD_TEEN.jpg" },
    { key: "_wchc_safety_info", value: "javascript:alert(1)" },
  ],
};

describe("product images", () => {
  it("uses the product's own WooCommerce images first", () => {
    const p = product({ images: [{ src: "https://test.piece.dk/a.jpg", alt: "A" }], ...supplierPhotos });
    expect(productImages(p)).toEqual([{ src: "https://test.piece.dk/a.jpg", alt: "A" }]);
  });

  it("falls back to linked supplier photos from allowed hosts, shown whole", () => {
    const p = product(supplierPhotos);
    expect(productImages(p)).toEqual([
      { src: "https://marketing.guirca.com/78224/78224.jpg", alt: "Mørk enhjørning – kostume til piger", fit: "contain" },
    ]);
    expect(mapProductSummary(p).image?.src).toBe("https://marketing.guirca.com/78224/78224.jpg");
  });

  it("has no image when there are neither", () => {
    expect(mapProductSummary(product()).image).toBeNull();
  });
});

describe("mapProduct", () => {
  it("passes on https links to the size chart and safety label, nothing else", () => {
    const p = mapProduct(product(supplierPhotos), []);
    expect(p.sizeChart).toBe("https://static.guirca.com/media/mailing/tallas/UK/Size%20chart_CHILD_TEEN.jpg");
    expect(p.safetyInfo).toBeNull();
    expect(mapProduct(product(), []).sizeChart).toBeNull();
  });
});

describe("mapCategory", () => {
  it("keeps the parent and the order set in WooCommerce", () => {
    const category = mapCategory(wcCategorySchema.parse({ id: 7, name: "Pigekostumer", slug: "pigekostumer", parent: 16, menu_order: 3 }));
    expect(category).toMatchObject({ id: 7, parent: 16, menuOrder: 3 });
  });
});
