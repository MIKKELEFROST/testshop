import { describe, expect, it } from "vitest";
import { brands, brandStyle, isDark, resolveStoreConfig, sellsAdultProducts, themeStyle } from "./store";

/** WCAG contrast ratio of two "#rrggbb" colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

const SURFACE = "#ffffff"; // --color-surface, the same in every brand

describe("store config", () => {
  it("picks the brand of the store ID, with name and support e-mail from the environment", () => {
    const shop = resolveStoreConfig({ storeId: "halloween-kostumer-dk", supportEmail: "hej@example.com" });
    expect(shop).toMatchObject({ id: "halloween-kostumer-dk", name: "Halloweenkostumer.dk", season: "halloween", supportEmail: "hej@example.com" });
    expect(shop.theme.action).toBe("#f2690d");
    expect(resolveStoreConfig({ storeId: "halloween-kostumer-dk", storeName: "Gys" }).name).toBe("Gys");
  });

  it("defaults to piece-dk, and an unknown store keeps its ID but uses the default brand", () => {
    expect(resolveStoreConfig({})).toMatchObject({ id: "piece-dk", name: "Fastelavnskostumer.dk", season: "fastelavn" });
    expect(resolveStoreConfig({ storeId: "ny-shop" })).toMatchObject({ id: "ny-shop", name: "Fastelavnskostumer.dk" });
  });

  it("turns a theme into CSS variables", () => {
    expect(themeStyle({ accent: "#123456", "accent-soft": "#abcdef" })).toEqual({ "--color-accent": "#123456", "--color-accent-soft": "#abcdef" });
  });

  it("sets the brand's heading font next to its colours", () => {
    const style = brandStyle(brands["halloween-kostumer-dk"]!);
    expect(style).toMatchObject({ "--color-chrome": "#130f19", "--display-case": "uppercase", "--display-weight": "400" });
    expect(style["--font-display"]).toBe("var(--font-bebas-neue), var(--font-sans)");
    expect(brandStyle(brands["piece-dk"]!)["--display-case"]).toBe("none");
  });

  it("gives each brand a front page title that search results show in full, with the shop's name", () => {
    for (const brand of Object.values(brands)) {
      expect(brand.homeTitle.length, brand.homeTitle).toBeLessThanOrEqual(60);
      expect(brand.homeTitle).toContain(brand.name);
    }
  });

  it("tells which shops sell products for adults only", () => {
    expect(sellsAdultProducts(brands["halloween-kostumer-dk"]!)).toBe(true);
    expect(sellsAdultProducts(brands["piece-dk"]!)).toBe(false);
  });

  it("gives each brand a card statement suffix Stripe accepts", () => {
    // The shortened descriptor (2–10 characters) + "* " + the suffix must fit 22 characters.
    for (const brand of Object.values(brands)) {
      expect(brand.statementDescriptorSuffix).toMatch(/^[A-Z0-9 .-]{2,10}$/);
      expect(brand.statementDescriptorSuffix).toMatch(/[A-Z]/);
    }
    expect(new Set(Object.values(brands).map((b) => b.statementDescriptorSuffix)).size).toBe(Object.keys(brands).length);
  });

  it("gives text fields an edge with at least 3:1 contrast on the light pages", () => {
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const contrast = (a: string, b: string) => {
      const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (high! + 0.05) / (low! + 0.05);
    };
    for (const brand of Object.values(brands)) {
      for (const background of ["#ffffff", brand.theme.paper!, brand.theme.canvas!]) {
        expect(contrast(brand.theme.field!, background)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("knows when a hero colour needs light text", () => {
    expect(isDark(brands["halloween-kostumer-dk"]!.theme.hero)).toBe(true);
    expect(isDark("#e9e2d8")).toBe(false);
    expect(isDark(undefined)).toBe(false);
  });

  it.each(Object.entries(brands))("keeps small text and focus rings readable in %s (WCAG AA)", (_, brand) => {
    const t = brand.theme;
    // Text: 4.5:1. Prices are small in the buy bar, the search suggestions and "fra" (on white
    // cards and panels, and the product page's paper).
    for (const background of [SURFACE, t.paper!]) expect(contrast(t.price!, background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.muted!, SURFACE)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["on-action"]!, t.action!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["chrome-ink"]!, t.chrome!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["footer-ink"]!, t.footer!)).toBeGreaterThanOrEqual(4.5);
    // Focus rings (globals.css): 3:1 against what they are drawn on.
    for (const background of [SURFACE, t.paper!, t.canvas!]) expect(contrast(t.accent!, background)).toBeGreaterThanOrEqual(3);
  });
});
