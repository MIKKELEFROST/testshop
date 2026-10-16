import { describe, expect, it } from "vitest";
import { DELIVERY_FACTS, formatThreshold, HYGIENE_RETURN_PROMISE, RETURN_PROMISE, resolveTexts, resolveUsps, USP_PRODUCT, USP_STRIP } from "./usps";

describe("selling points", () => {
  it("fills in the free shipping amount from WooCommerce", () => {
    expect(formatThreshold("599.00")).toBe("599 kr.");
    expect(formatThreshold("1499.50")).toBe("1.499,50 kr.");
    expect(resolveUsps(USP_STRIP, "599.00")[0]).toEqual({ icon: "gift", title: "Fri fragt v/ 599 kr." });
    expect(resolveUsps(USP_PRODUCT, "599.00").find((u) => u.icon === "box")).toEqual({ icon: "box", title: "Gratis fragt", text: "ved 599 kr." });
  });

  it("leaves out the promises about free shipping when no method has it", () => {
    expect(resolveUsps(USP_STRIP, null).map((u) => u.title)).not.toContain(expect.stringContaining("fragt"));
    expect(resolveUsps(USP_STRIP, null)).toHaveLength(USP_STRIP.length - 1);
    expect(resolveUsps(USP_PRODUCT, null).some((u) => u.icon === "box")).toBe(false);
    expect(resolveTexts(["Fri fragt v/ {fri_fragt}", "30 dages returret"], null)).toEqual(["30 dages returret"]);
  });

  it("has a return promise with the hygiene condition for sealed products", () => {
    expect(DELIVERY_FACTS).toContain(RETURN_PROMISE);
    expect(HYGIENE_RETURN_PROMISE.startsWith(`${RETURN_PROMISE} – `)).toBe(true);
    expect(HYGIENE_RETURN_PROMISE).toContain("forseglingen er brudt");
  });
});
