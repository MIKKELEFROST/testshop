import { describe, expect, it } from "vitest";
import { DELIVERY_FACTS, formatThreshold, HYGIENE_RETURN_PROMISE, RETURN_PROMISE, resolveTexts, resolveUsps, USP_BAR, USP_PRODUCT, USP_STRIP, withoutRating } from "./usps";

/** Every selling point as one text (title and text together). */
const ALL_TEXTS = [...[...USP_STRIP, ...USP_PRODUCT].map((u) => [u.title, u.text].filter(Boolean).join(" ")), ...DELIVERY_FACTS, ...USP_BAR];

describe("selling points", () => {
  it("fills in the free shipping amount from WooCommerce", () => {
    expect(formatThreshold("599.00")).toBe("599 kr.");
    expect(formatThreshold("1499.50")).toBe("1.499,50 kr.");
    expect(resolveUsps(USP_STRIP, "599.00")[0]).toEqual({ icon: "gift", title: "Fri fragt til pakkeshop v/ 599 kr." });
    expect(resolveUsps(USP_PRODUCT, "599.00").find((u) => u.icon === "box")).toEqual({ icon: "box", title: "Gratis fragt", text: "til pakkeshop ved 599 kr." });
    expect(resolveTexts(USP_BAR, "599.00")).toEqual(["Fri fragt til pakkeshop v/ 599 kr.", "1-dags levering", "Gratis retur i 30 dage"]);
  });

  it("leaves out the promises about free shipping when no method has it", () => {
    expect(resolveUsps(USP_STRIP, null).map((u) => u.title)).not.toContain(expect.stringContaining("fragt"));
    expect(resolveUsps(USP_STRIP, null)).toHaveLength(USP_STRIP.length - 1);
    expect(resolveUsps(USP_PRODUCT, null).some((u) => u.icon === "box")).toBe(false);
    expect(resolveTexts(["Fri fragt v/ {fri_fragt}", "30 dages returret"], null)).toEqual(["30 dages returret"]);
  });

  // Door delivery keeps its price, so a free shipping promise without "pakkeshop" would mislead.
  it("promises free shipping to a parcel shop only", () => {
    const free = ALL_TEXTS.filter((t) => t.includes("{fri_fragt}"));
    expect(free).toHaveLength(4);
    for (const text of free) expect(text, text).toContain("til pakkeshop");
  });

  it("writes the delivery promise one way everywhere, without a date", () => {
    for (const text of ALL_TEXTS) {
      expect(text, text).not.toMatch(/\b1 dags\b/);
      expect(text, text).not.toMatch(/\d\.\s?(januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december)/i);
    }
    expect(ALL_TEXTS.filter((t) => t.includes("1-dags levering"))).toHaveLength(4);
  });

  it("leaves the text-only rating out where a Trustpilot TrustBox shows the real one", () => {
    expect(withoutRating(USP_PRODUCT).map((u) => u.icon)).toEqual(["clock-truck", "denmark", "box"]);
    expect(withoutRating(USP_STRIP)).toEqual(USP_STRIP);
    // Without a TrustBox the rating stays exactly as the owner wrote it.
    expect(USP_PRODUCT.find((u) => u.icon === "trophy")).toEqual({ icon: "trophy", title: "Bedømt som Fremragende", text: "+30.000 femstjernede anmeldelser" });
  });

  it("has a return promise with the hygiene condition for sealed products", () => {
    expect(DELIVERY_FACTS).toContain(RETURN_PROMISE);
    expect(HYGIENE_RETURN_PROMISE.startsWith(`${RETURN_PROMISE} – `)).toBe(true);
    expect(HYGIENE_RETURN_PROMISE).toContain("forseglingen er brudt");
  });
});
