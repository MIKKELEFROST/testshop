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
  /** Null when stock is not tracked. */
  stockQuantity: number | null;
  categories: { id: number; name: string; slug: string }[];
  /** Themes (WooCommerce tags), e.g. "Pirater". Only in listings that ask for them. */
  tags: { id: number; name: string }[];
  /** Target groups (attribute "Målgruppe"), e.g. ["Piger"]. */
  audience: string[];
  /** "6 størrelser" for a product with sizes, or "3 varianter". */
  variantSummary: string | null;
  /** Percentage off the regular price, when known (simple products on sale). */
  discountPercent: number | null;
  /** Whether the product has a video (shown on its page). */
  hasVideo: boolean;
  /** For adults only (18+): in an ADULT_CATEGORY_SLUGS category. */
  adult: boolean;
};

export type ProductAttribute = { name: string; slug: string; options: string[] };

export type ProductVariation = {
  id: number;
  sku: string;
  /** Barcode number (EAN-13 for Guirca), "" when unknown. */
  gtin: string;
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
  /** Barcode number (EAN-13 for Guirca), "" when unknown; a variable product's are on its variations. */
  gtin: string;
  description: string[];
  shortDescription: string[];
  images: ProductImage[];
  purchasable: boolean;
  attributes: ProductAttribute[];
  variations: ProductVariation[];
  /** Link to the supplier's size chart (image), if any. */
  sizeChart: string | null;
  /** Link to the supplier's product safety label with warnings (EU GPSR), if any. */
  safetyInfo: string | null;
  /** YouTube video IDs (from the import's `_wchc_videos` links). */
  videos: string[];
  /** Can come with a hygiene seal (HYGIENE_CATEGORY_SLUGS): no return once the seal is broken. */
  hygiene: boolean;
  /**
   * Store IDs of the webshops that sell it (WooCommerce's "Webshops"), e.g. only
   * "halloween-kostumer-dk" for the products for adults only. Empty when unknown.
   */
  webshops: string[];
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
