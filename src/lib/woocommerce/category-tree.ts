import type { ProductCategory } from "@/types/commerce";

/** Navigation helpers for the category tree (top level → subcategories). */

function byMenuOrder(a: ProductCategory, b: ProductCategory) {
  return a.menuOrder - b.menuOrder || a.name.localeCompare(b.name, "da");
}

/** Top-level categories in the order set in WooCommerce. */
export function topLevelCategories(categories: ProductCategory[]): ProductCategory[] {
  return categories.filter((c) => c.parent === 0).sort(byMenuOrder);
}

export function subcategories(categories: ProductCategory[], parentId: number): ProductCategory[] {
  return categories.filter((c) => c.parent === parentId).sort(byMenuOrder);
}

/** The category and its ancestors, top level first. Stops at categories that are missing (e.g. empty in this shop). */
export function categoryPath(categories: ProductCategory[], category: ProductCategory): ProductCategory[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const path = [category];
  for (let parent = byId.get(category.parent); parent && !path.includes(parent); parent = byId.get(parent.parent)) {
    path.unshift(parent);
  }
  return path;
}

/**
 * The category a product page is filed under: the deepest of the product's categories that
 * the shop shows (a subcategory beats a top-level theme such as "Halloween").
 */
export function primaryCategory(
  categories: ProductCategory[],
  productCategories: { id: number }[],
): ProductCategory | undefined {
  const known = productCategories
    .map((pc) => categories.find((c) => c.id === pc.id))
    .filter((c): c is ProductCategory => c !== undefined);
  return known.sort((a, b) => categoryPath(categories, b).length - categoryPath(categories, a).length)[0];
}
