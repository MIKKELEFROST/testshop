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

  it("knows when a hero colour needs light text", () => {
    expect(isDark(brands["halloween-kostumer-dk"]!.theme.hero)).toBe(true);
    expect(isDark("#e9e2d8")).toBe(false);
    expect(isDark(undefined)).toBe(false);
  });
});
