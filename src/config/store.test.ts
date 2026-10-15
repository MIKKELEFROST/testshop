import { describe, expect, it } from "vitest";
import { brands, isDark, resolveStoreConfig, themeStyle } from "./store";

describe("store config", () => {
  it("picks the brand of the store ID, with name and support e-mail from the environment", () => {
    const shop = resolveStoreConfig({ storeId: "halloween-kostumer-dk", supportEmail: "hej@example.com" });
    expect(shop).toMatchObject({ id: "halloween-kostumer-dk", name: "Maskerade", supportEmail: "hej@example.com" });
    expect(shop.theme.action).toBe("#5b2b82");
    expect(resolveStoreConfig({ storeId: "halloween-kostumer-dk", storeName: "Gys" }).name).toBe("Gys");
  });

  it("defaults to piece-dk, and an unknown store keeps its ID but uses the default brand", () => {
    expect(resolveStoreConfig({})).toMatchObject({ id: "piece-dk", name: "Hverdag", theme: {} });
    expect(resolveStoreConfig({ storeId: "ny-shop" })).toMatchObject({ id: "ny-shop", name: "Hverdag" });
  });

  it("turns a theme into CSS variables", () => {
    expect(themeStyle({ accent: "#123456", "accent-soft": "#abcdef" })).toEqual({ "--color-accent": "#123456", "--color-accent-soft": "#abcdef" });
  });

  it("knows when a hero colour needs light text", () => {
    expect(isDark(brands["halloween-kostumer-dk"]!.theme.hero)).toBe(true);
    expect(isDark("#e9e2d8")).toBe(false);
    expect(isDark(undefined)).toBe(false);
  });
});
