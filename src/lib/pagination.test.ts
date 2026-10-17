import { describe, expect, it } from "vitest";
import { pageHref } from "@/components/ui/pagination";
import { productCount } from "./format";
import { MAX_PAGE, pageItems, parsePage } from "./pagination";

describe("parsePage", () => {
  it("reads ?side= and falls back to page 1", () => {
    expect(parsePage("3")).toBe(3);
    expect(parsePage(["4", "5"])).toBe(4);
    for (const bad of [undefined, "", "0", "-2", "2.5", "abc", "1e3"]) expect(parsePage(bad)).toBe(1);
    expect(parsePage("9999")).toBe(MAX_PAGE);
  });
});

describe("pageItems", () => {
  it("shows the first, last and neighbouring pages with gaps", () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(2, 4)).toEqual([1, 2, 3, 4]);
    expect(pageItems(6, 40)).toEqual([1, null, 5, 6, 7, null, 40]);
    expect(pageItems(1, 40)).toEqual([1, 2, null, 40]);
    // A gap of a single page shows that page instead of "…".
    expect(pageItems(4, 40)).toEqual([1, 2, 3, 4, 5, null, 40]);
  });
});

describe("pageHref", () => {
  it("leaves page 1 without a parameter and keeps other parameters", () => {
    expect(pageHref("/produkter", 1)).toBe("/produkter");
    expect(pageHref("/produkter", 2)).toBe("/produkter?side=2");
    expect(pageHref("/soeg", 3, { q: "heks hat" })).toBe("/soeg?q=heks+hat&side=3");
  });
});

describe("productCount", () => {
  it("uses Danish number formatting and grammar", () => {
    expect(productCount(1)).toBe("1 vare");
    expect(productCount(8623)).toBe("8.623 varer");
  });
});
