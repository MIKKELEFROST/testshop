/** Storefront domain types. Prices are decimal strings in the shop currency, as displayed. */

export type ProductImage = { src: string; alt: string };

export type StockStatus = "instock" | "outofstock" | "onbackorder";

export type ProductCategory = {
  id: number;
  name: string;
  slug: string;
  description: string;
  count: number;
  image: ProductImage | null;
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
};

/** Result wrapper so pages can render a friendly message when WooCommerce is down. */
export type Loadable<T> = { ok: true; data: T } | { ok: false; error: string };
