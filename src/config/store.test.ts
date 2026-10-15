import { describe, expect, it } from "vitest";
import { brands, brandStyle, isDark, resolveStoreConfig, themeStyle } from "./store";

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
    expect(style["--font-display"]).toBe('"Bebas Neue", var(--font-sans)');
    expect(brandStyle(brands["piece-dk"]!)["--display-case"]).toBe("none");
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
});
