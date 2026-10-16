import { describe, expect, it } from "vitest";
import { resolveTrustBoxes, TRUSTBOX_TEMPLATES, trustpilotByStore, type TrustpilotBrand } from "./trustpilot";

const ID = "0123456789abcdef01234567";
const PAGE = "https://dk.trustpilot.com/review/halloweenkostumer.dk";

const brand: TrustpilotBrand = {
  businessUnitId: ID,
  profileUrl: PAGE,
  placements: {
    product: { ...TRUSTBOX_TEMPLATES.microStar, theme: "light" },
    footer: { ...TRUSTBOX_TEMPLATES.reviewCollector, theme: "dark", data: { token: "abc-123" } },
  },
};

describe("Trustpilot TrustBoxes", () => {
  it("are empty for both shops until the owner gives their Trustpilot details", () => {
    expect(Object.keys(trustpilotByStore).sort()).toEqual(["halloween-kostumer-dk", "piece-dk"]);
    for (const shop of Object.values(trustpilotByStore)) {
      expect(shop.businessUnitId).toBe("");
      expect(shop.profileUrl).toBe("");
      expect(Object.values(resolveTrustBoxes(shop)).every((box) => box === null)).toBe(true);
    }
  });

  it("gives each configured placement its template, theme, the shop's page and Danish", () => {
    const boxes = resolveTrustBoxes(brand);
    expect(boxes.product).toEqual({ templateId: "5419b732fbfb950b10de65e5", height: "24px", theme: "light", businessUnitId: ID, profileUrl: PAGE, locale: "da-DK" });
    expect(boxes.footer).toMatchObject({ templateId: "56278e9abfbbba0bdcd568bc", theme: "dark", data: { token: "abc-123" } });
    expect(boxes.strip).toBeNull();
    expect(boxes.cart).toBeNull();
  });

  it("takes the ID and the page from the environment (a Vercel project, or a local look)", () => {
    const empty = { ...brand, businessUnitId: "", profileUrl: "" };
    expect(resolveTrustBoxes(empty).product).toBeNull();
    expect(resolveTrustBoxes(empty, { businessUnitId: ` ${ID} `, profileUrl: PAGE }).product).toMatchObject({ businessUnitId: ID, profileUrl: PAGE });
    expect(resolveTrustBoxes(undefined, { businessUnitId: ID, profileUrl: PAGE }).product).toBeNull();
  });

  it("shows none rather than a broken box when the details are wrong", () => {
    const none = (changes: Partial<TrustpilotBrand>) => Object.values(resolveTrustBoxes({ ...brand, ...changes })).every((box) => box === null);
    expect(none({ businessUnitId: "12345" })).toBe(true);
    expect(none({ businessUnitId: "<script>alert(1)</script>" })).toBe(true);
    expect(none({ profileUrl: "https://www.trustpilot.com/" })).toBe(true);
    expect(none({ profileUrl: "http://dk.trustpilot.com/review/halloweenkostumer.dk" })).toBe(true);
    expect(none({ profileUrl: "https://trustpilot.com.example.dk/review/halloweenkostumer.dk" })).toBe(true);
    expect(none({ profileUrl: PAGE })).toBe(false);
    // One bad placement only loses that placement.
    const boxes = resolveTrustBoxes({
      ...brand,
      placements: { ...brand.placements, strip: { templateId: "Micro Star", height: "24px", theme: "light" }, cart: { ...TRUSTBOX_TEMPLATES.microStar, theme: "light", data: { "template-id": "x" } } },
    });
    expect(boxes.strip).toBeNull();
    expect(boxes.cart).toBeNull();
    expect(boxes.product).not.toBeNull();
  });
});
