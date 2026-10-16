import { describe, expect, it } from "vitest";
import { discountPercent } from "@/lib/pricing";
import { mapCategory, mapProduct, mapProductSummary, productImages, youtubeIds } from "./mappers";
import { wcCategorySchema, wcProductSchema, wcVariationSchema } from "./schemas";

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

  it("leaves out a costume's main photo with the inset when its catalogue photo is there", () => {
    const photos = (...links: string[]) => product({ meta_data: [{ key: "_wchc_external_images", value: links }] });
    const g = (path: string) => `https://marketing.guirca.com/${path}`;
    const costume = photos(g("80031/80031.jpg"), g("80031/80031_01.jpg"), g("80031/80031_02.jpg"), g("80031/80031_04.jpg"));
    expect(productImages(costume).map((i) => i.src)).toEqual([g("80031/80031_01.jpg"), g("80031/80031_02.jpg"), g("80031/80031_04.jpg")]);
    expect(mapProductSummary(costume).image?.src).toBe(g("80031/80031_01.jpg"));
    // An accessory (catalogue photo _07), a main photo on its own, and another article's
    // catalogue photo keep the main photo.
    expect(productImages(photos(g("18347/18347.jpg"), g("18347/18347_07.jpg"))).map((i) => i.src)).toEqual([g("18347/18347.jpg"), g("18347/18347_07.jpg")]);
    expect(productImages(photos(g("27766/27766.jpg"))).map((i) => i.src)).toEqual([g("27766/27766.jpg")]);
    expect(productImages(photos(g("1/1.jpg"), g("2/2_01.jpg"))).map((i) => i.src)).toEqual([g("1/1.jpg"), g("2/2_01.jpg")]);
  });
});

describe("mapProduct", () => {
  it("passes on https links to the size chart and safety label, nothing else", () => {
    const p = mapProduct(product(supplierPhotos), []);
    expect(p.sizeChart).toBe("https://static.guirca.com/media/mailing/tallas/UK/Size%20chart_CHILD_TEEN.jpg");
    expect(p.safetyInfo).toBeNull();
    expect(mapProduct(product(), []).sizeChart).toBeNull();
  });

  it("reads the EAN of the product and its sizes, and drops values that are not a GTIN", () => {
    const variation = (id: number, ean: string) => wcVariationSchema.parse({ id, global_unique_id: ean });
    const p = mapProduct(product({ type: "simple", global_unique_id: " 8434077902042 " }), [variation(2, "8434077865255"), variation(3, "GU-80031")]);
    expect(p.gtin).toBe("8434077902042");
    expect(p.variations.map((v) => v.gtin)).toEqual(["8434077865255", ""]);
    expect(mapProduct(product(), []).gtin).toBe("");
  });

  it("knows the products that can come with a hygiene seal from their category", () => {
    const inCategory = (slug: string) => product({ categories: [{ id: 1, name: slug, slug }] });
    expect(mapProduct(inCategory("blod-og-effekter"), []).hygiene).toBe(true);
    expect(mapProduct(inCategory("sminke-og-ansigtsmaling"), []).hygiene).toBe(true);
    expect(mapProduct(inCategory("negle-og-oejenvipper"), []).hygiene).toBe(true);
    expect(mapProduct(inCategory("masker"), []).hygiene).toBe(false);
    expect(mapProduct(product(), []).hygiene).toBe(false);
  });
});

describe("product card facts", () => {
  const sizes = { id: 1, name: "Størrelse", slug: "pa_storrelse", variation: true, options: ["3-4 år", "5-6 år", "7-9 år"] };
  const audience = { id: 2, name: "Målgruppe", slug: "pa_maalgruppe", variation: false, options: ["Piger"] };

  it("counts the sizes (or other variants) and reads the target group", () => {
    const summary = mapProductSummary(product({ attributes: [sizes, audience] }));
    expect(summary.variantSummary).toBe("3 størrelser");
    expect(summary.audience).toEqual(["Piger"]);
    expect(mapProductSummary(product({ attributes: [{ ...sizes, options: ["One size"] }] })).variantSummary).toBe("1 størrelse");
    expect(mapProductSummary(product({ attributes: [{ ...sizes, name: "Farve", options: ["Rød", "Blå"] }] })).variantSummary).toBe("2 varianter");
    expect(mapProductSummary(product({ type: "simple", attributes: [audience] })).variantSummary).toBeNull();
  });

  it("knows the discount on simple products only", () => {
    const sale = { type: "simple", price: "199", regular_price: "249", sale_price: "199", on_sale: true };
    expect(mapProductSummary(product(sale)).discountPercent).toBe(20);
    expect(mapProductSummary(product({ ...sale, type: "variable" })).discountPercent).toBeNull();
    expect(discountPercent("199.00", "199.00", true)).toBeNull();
    expect(discountPercent("199", "249", false)).toBeNull();
    expect(discountPercent("249", "199", true)).toBeNull();
  });

  it("finds YouTube videos in the import's links", () => {
    expect(
      youtubeIds([
        "https://www.youtube.com/watch?v=iCih5sZbxhE",
        "https://youtu.be/ZD33COusHX4",
        "https://www.youtube.com/embed/iCih5sZbxhE", // duplicate
        "http://www.youtube.com/watch?v=aaaaaaaaaaa", // not https
        "https://vimeo.com/123",
        "https://www.youtube.com/watch?v=<script>",
        7,
      ]),
    ).toEqual(["iCih5sZbxhE", "ZD33COusHX4"]);
    expect(youtubeIds("https://youtu.be/ZD33COusHX4")).toEqual([]);
    const withVideo = product({ meta_data: [{ key: "_wchc_videos", value: ["https://youtu.be/ZD33COusHX4"] }] });
    expect(mapProductSummary(withVideo).hasVideo).toBe(true);
    expect(mapProduct(withVideo, []).videos).toEqual(["ZD33COusHX4"]);
    expect(mapProductSummary(product()).hasVideo).toBe(false);
  });
});

describe("mapCategory", () => {
  it("keeps the parent and the order set in WooCommerce", () => {
    const category = mapCategory(wcCategorySchema.parse({ id: 7, name: "Pigekostumer", slug: "pigekostumer", parent: 16, menu_order: 3 }));
    expect(category).toMatchObject({ id: 7, parent: 16, menuOrder: 3 });
  });
});
