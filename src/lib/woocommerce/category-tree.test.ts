import { describe, expect, it } from "vitest";
import type { ProductCategory } from "@/types/commerce";
import { categoryPath, primaryCategory, subcategories, topLevelCategories } from "./category-tree";

function category(id: number, name: string, parent = 0, menuOrder = 0): ProductCategory {
  return { id, name, slug: name.toLowerCase(), description: "", count: 1, image: null, parent, menuOrder };
}

const tree = [
  category(5, "Halloween", 0, 40),
  category(1, "Kostumer", 0, 0),
  category(3, "Drengekostumer", 1, 4),
  category(2, "Pigekostumer", 1, 3),
  category(4, "Tilbehør", 0, 20),
];

describe("category tree", () => {
  it("lists the top level and subcategories in WooCommerce's order", () => {
    expect(topLevelCategories(tree).map((c) => c.name)).toEqual(["Kostumer", "Tilbehør", "Halloween"]);
    expect(subcategories(tree, 1).map((c) => c.name)).toEqual(["Pigekostumer", "Drengekostumer"]);
  });

  it("builds the path from the top level", () => {
    expect(categoryPath(tree, tree[2]!).map((c) => c.name)).toEqual(["Kostumer", "Drengekostumer"]);
    expect(categoryPath(tree, tree[0]!).map((c) => c.name)).toEqual(["Halloween"]);
  });

  it("survives circular parents", () => {
    const loop = [category(8, "A", 9), category(9, "B", 8)];
    expect(categoryPath(loop, loop[0]!).map((c) => c.name)).toEqual(["B", "A"]);
  });

  it("files a product under its most specific category the shop shows", () => {
    expect(primaryCategory(tree, [{ id: 5 }, { id: 2 }])?.name).toBe("Pigekostumer");
    expect(primaryCategory(tree, [{ id: 99 }, { id: 5 }])?.name).toBe("Halloween");
    expect(primaryCategory(tree, [{ id: 99 }])).toBeUndefined();
  });
});
