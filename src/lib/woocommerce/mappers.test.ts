import { describe, expect, it } from "vitest";
import { shopCategoryCounts } from "./mappers";

describe("shopCategoryCounts", () => {
  const categories = [
    { id: 1, parent: 0 }, // Kostumer
    { id: 2, parent: 1 }, // Kostumer › Børn
    { id: 3, parent: 0 }, // Tilbehør
    { id: 4, parent: 0 }, // Tom
  ];

  it("counts the shop's products per category, including parent categories, once each", () => {
    const counts = shopCategoryCounts(categories, [
      { categories: [{ id: 2 }] },
      { categories: [{ id: 1 }, { id: 2 }] },
      { categories: [{ id: 3 }] },
    ]);
    expect(Object.fromEntries(counts)).toEqual({ 1: 2, 2: 2, 3: 1 });
    expect(counts.get(4)).toBeUndefined();
  });

  it("survives unknown and circular parents", () => {
    const counts = shopCategoryCounts(
      [
        { id: 5, parent: 6 },
        { id: 6, parent: 5 },
      ],
      [{ categories: [{ id: 5 }, { id: 99 }] }],
    );
    expect(Object.fromEntries(counts)).toEqual({ 5: 1, 6: 1, 99: 1 });
  });
});
