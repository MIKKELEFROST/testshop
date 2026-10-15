import { describe, expect, it } from "vitest";
import { sizeHeights, splitProductText } from "./product-text";

describe("splitProductText", () => {
  it("separates the sizes and the producer from the description", () => {
    const text = splitProductText([
      "Et mørkt og glitrende enhjørningekostume til halloween.",
      "Indhold: kjole, hårbøjle og vinger.",
      "Størrelser: 3-4 år (109 cm), 5-6 år (123 cm) og 7-9 år (137 cm).",
      "Producent: Fiestas Guirca, S.L., Spanien.",
    ]);
    expect(text.about).toEqual(["Et mørkt og glitrende enhjørningekostume til halloween.", "Indhold: kjole, hårbøjle og vinger."]);
    expect(text.sizes).toBe("Størrelser: 3-4 år (109 cm), 5-6 år (123 cm) og 7-9 år (137 cm).");
    expect(text.producer).toBe("Producent: Fiestas Guirca, S.L., Spanien.");
    expect(text.heights).toEqual({ "3-4 år": "109 cm", "5-6 år": "123 cm", "7-9 år": "137 cm" });
  });

  it("keeps descriptions written another way as they are", () => {
    expect(splitProductText(["Bare en tekst."])).toEqual({ about: ["Bare en tekst."], sizes: null, producer: null, heights: {} });
  });
});

describe("sizeHeights", () => {
  it("reads sizes with brackets of their own and skips sizes without a height", () => {
    expect(sizeHeights("Størrelser: L (42-44) (180 cm), XL (44-46) og One size.")).toEqual({ "L (42-44)": "180 cm" });
    expect(sizeHeights("Størrelser: S, M og L.")).toEqual({});
  });
});
