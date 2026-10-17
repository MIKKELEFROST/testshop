import { describe, expect, it } from "vitest";
import doublePhotos from "@/config/guirca-double-photos.json";
import { discountPercent } from "@/lib/pricing";
import { mapCategory, mapProduct, mapProductSummary, productImages, withoutDoublePhotos, withoutUploadedDoublePhotos, youtubeIds } from "./mappers";
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
    const costume = photos(g("80031/80031.jpg"), g("80031/80031_01.jpg"), g("80031/80031_02.jpg"), g("80031/80031_04.jpg"));
    expect(productImages(costume).map((i) => i.src)).toEqual([g("80031/80031_01.jpg"), g("80031/80031_02.jpg"), g("80031/80031_04.jpg")]);
    expect(mapProductSummary(costume).image?.src).toBe(g("80031/80031_01.jpg"));
  });

  it("leaves out other main photos that show the product twice, unless they are the only photo", () => {
    const none = new Set<string>();
    const wig = [g("4778/4778.jpg"), g("4778/4778_07.jpg"), g("4778/4778_09.jpg")];
    expect(withoutDoublePhotos(wig, none)).toEqual(wig);
    expect(withoutDoublePhotos(wig, new Set(["4778"]))).toEqual(wig.slice(1));
    expect(withoutDoublePhotos([g("4778/4778.jpg")], new Set(["4778"]))).toEqual([g("4778/4778.jpg")]);
    // Another article's catalogue photo and other hosts don't count.
    expect(withoutDoublePhotos([g("1/1.jpg"), g("2/2_01.jpg")], none)).toEqual([g("1/1.jpg"), g("2/2_01.jpg")]);
    expect(withoutDoublePhotos(["https://test.piece.dk/4778/4778.jpg", g("4778/4778_07.jpg")], new Set(["4778"]))).toEqual(["https://test.piece.dk/4778/4778.jpg", g("4778/4778_07.jpg")]);
  });

  it("leaves out a Guirca main photo uploaded as the product's own image, by the same rule", () => {
    const up = (file: string) => ({ src: `https://test.piece.dk/wp-content/uploads/2026/10/${file}`, alt: "" });
    const files = (images: { src: string }[]) => images.map((i) => i.src.split("/").pop());
    // The costume's catalogue photo among its own images (product 65 on test.piece.dk).
    const vampire = product({ images: [up("78339-scaled.jpg"), up("78339_01.jpg"), up("78339_02.jpg")] });
    expect(files(productImages(vampire))).toEqual(["78339_01.jpg", "78339_02.jpg"]);
    // … or only among its supplier photos (product 54).
    const unicorn = product({ images: [up("78224-scaled.jpg"), up("78224_02.jpg")], meta_data: [{ key: "_wchc_external_images", value: [g("78224/78224.jpg"), g("78224/78224_01.jpg")] }] });
    expect(files(productImages(unicorn))).toEqual(["78224_02.jpg"]);
    // In the list of doubles, with another photo of the article.
    expect(files(withoutUploadedDoublePhotos([up("4778-1.jpg"), up("4778_07-scaled.jpg")], [], new Set(["4778"])))).toEqual(["4778_07-scaled.jpg"]);
  });

  it("keeps own images that only look like a Guirca main photo, and a lone main photo", () => {
    const up = (file: string) => ({ src: `https://test.piece.dk/wp-content/uploads/${file}`, alt: "" });
    const doubles = new Set(["2176"]);
    // A number in the list of doubles, but no other photo of that article: the shop's own photo.
    expect(withoutUploadedDoublePhotos([up("2176.jpg"), up("IMG_0001.jpg")], [], doubles)).toHaveLength(2);
    expect(withoutUploadedDoublePhotos([up("78339-scaled.jpg")], [g("78339/78339_01.jpg")])).toHaveLength(1);
    expect(withoutUploadedDoublePhotos([up("pirat.jpg"), up("78339_01.jpg")], [])).toHaveLength(2);
  });

  it("reads the list of main photos that show the product twice", () => {
    const all = [...doublePhotos.codes, ...doublePhotos.by_eye];
    expect(doublePhotos.codes.length).toBeGreaterThan(0);
    expect(all.every((code) => /^\d+$/.test(code))).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  });
});

function g(path: string) {
  return `https://marketing.guirca.com/${path}`;
}

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
