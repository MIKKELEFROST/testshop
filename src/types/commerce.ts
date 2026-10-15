/** Storefront domain types. Prices are decimal strings in the shop currency, as displayed. */

/**
 * `fit: "contain"`: a supplier photo on a white background, shown whole instead of cropped.
 */
export type ProductImage = { src: string; alt: string; fit?: "contain" };

export type StockStatus = "instock" | "outofstock" | "onbackorder";

export type ProductCategory = {
  id: number;
  name: string;
  slug: string;
  description: string;
  /** Number of this shop's products in the category, including its subcategories. */
  count: number;
  image: ProductImage | null;
  /** Parent category ID (0 for a top-level category). */
  parent: number;
  /** Position set in WooCommerce (Products → Categories). */
  menuOrder: number;
};

export type ProductSummary = {
  id: number;
  slug: string;
  name: string;
  type: "simple" | "variable" | "other";
  price: string | null;
  regularPrice: string | null;
  salePrice: string | null;
  onSale: boolean;
  /** For variable products: cheapest and most expensive variation. */
  priceRange: { min: string; max: string } | null;
  image: ProductImage | null;
  stockStatus: StockStatus;
  categories: { id: number; name: string; slug: string }[];
};

export type ProductAttribute = { name: string; slug: string; options: string[] };

export type ProductVariation = {
  id: number;
  sku: string;
  price: string | null;
  regularPrice: string | null;
  salePrice: string | null;
  onSale: boolean;
  purchasable: boolean;
  stockStatus: StockStatus;
  /** Null when stock is not tracked. */
  stockQuantity: number | null;
  /** attribute slug -> option */
  attributes: Record<string, string>;
  image: ProductImage | null;
};

export type Product = ProductSummary & {
  sku: string;
  description: string[];
  shortDescription: string[];
  images: ProductImage[];
  purchasable: boolean;
  stockQuantity: number | null;
  attributes: ProductAttribute[];
  variations: ProductVariation[];
  /** Link to the supplier's size chart (image), if any. */
  sizeChart: string | null;
  /** Link to the supplier's product safety label with warnings (EU GPSR), if any. */
  safetyInfo: string | null;
};

/** One page of a product listing. */
export type ProductList = {
  products: ProductSummary[];
  total: number;
  totalPages: number;
  page: number;
};

/** Result wrapper so pages can render a friendly message when WooCommerce is down. */
export type Loadable<T> = { ok: true; data: T } | { ok: false; error: string };
