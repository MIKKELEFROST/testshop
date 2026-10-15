import type {
  Product,
  ProductCategory,
  ProductImage,
  ProductSummary,
  ProductVariation,
  StockStatus,
} from "@/types/commerce";
import type { WcCategory, WcProduct, WcVariation } from "./schemas";

/** Map WooCommerce REST payloads to storefront types. Display prices come from the plugin when available. */

function emptyToNull(value: string | null | undefined): string | null {
  return value === undefined || value === null || value === "" ? null : value;
}

function stockStatus(value: string): StockStatus {
  return value === "outofstock" || value === "onbackorder" ? value : "instock";
}

function image(value: { src: string; alt: string } | null | undefined): ProductImage | null {
  return value?.src ? { src: value.src, alt: value.alt } : null;
}

function prices(source: WcProduct | WcVariation) {
  const display = source.headless_prices;
  return {
    price: emptyToNull(display ? display.price : source.price),
    regularPrice: emptyToNull(display ? display.regular_price : source.regular_price),
    salePrice: emptyToNull(display ? display.sale_price : source.sale_price),
  };
}

export function mapProductSummary(product: WcProduct): ProductSummary {
  const display = product.headless_prices;
  const min = emptyToNull(display?.min_price);
  const max = emptyToNull(display?.max_price);

  return {
    id: product.id,
    slug: product.slug,
    name: decodeEntities(product.name),
    type: product.type === "simple" || product.type === "variable" ? product.type : "other",
    ...prices(product),
    onSale: product.on_sale,
    priceRange: min && max ? { min, max } : null,
    image: image(product.images[0]),
    stockStatus: stockStatus(product.stock_status),
    categories: product.categories.map((c) => ({ ...c, name: decodeEntities(c.name) })),
  };
}

export function mapVariation(variation: WcVariation): ProductVariation {
  return {
    id: variation.id,
    sku: variation.sku,
    ...prices(variation),
    onSale: variation.on_sale,
    purchasable: variation.purchasable && variation.status === "publish",
    stockStatus: stockStatus(variation.stock_status),
    stockQuantity: variation.manage_stock === true && !variation.backorders_allowed ? variation.stock_quantity : null,
    attributes: Object.fromEntries(variation.attributes.map((a) => [attributeKey(a), a.option])),
    image: image(variation.image),
  };
}

export function mapProduct(product: WcProduct, variations: WcVariation[]): Product {
  return {
    ...mapProductSummary(product),
    sku: product.sku,
    description: htmlToParagraphs(product.description),
    shortDescription: htmlToParagraphs(product.short_description),
    images: product.images.map((i) => image(i)).filter((i): i is ProductImage => i !== null),
    purchasable: product.purchasable,
    stockQuantity: product.manage_stock === true && !product.backorders_allowed ? product.stock_quantity : null,
    attributes: product.attributes
      .filter((a) => a.variation)
      .map((a) => ({ name: decodeEntities(a.name), slug: attributeKey(a), options: a.options })),
    variations: variations.map(mapVariation),
  };
}

/**
 * Number of products per category, counting a product in its categories' parent categories
 * too (as WooCommerce does), and each product once per category.
 */
export function shopCategoryCounts(
  categories: { id: number; parent: number }[],
  products: { categories: { id: number }[] }[],
): Map<number, number> {
  const parents = new Map(categories.map((c) => [c.id, c.parent]));
  const counts = new Map<number, number>();
  for (const product of products) {
    const seen = new Set<number>();
    for (const category of product.categories) {
      for (let id: number | undefined = category.id; id && !seen.has(id); id = parents.get(id)) seen.add(id);
    }
    for (const id of seen) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export function mapCategory(category: WcCategory): ProductCategory {
  return {
    id: category.id,
    name: decodeEntities(category.name),
    slug: category.slug,
    description: htmlToParagraphs(category.description).join(" "),
    count: category.count,
    image: image(category.image),
  };
}

/** Attribute key shared by product attributes and variation attributes. */
function attributeKey(attribute: { id: number; name: string; slug?: string }): string {
  return attribute.id > 0 && attribute.slug ? attribute.slug : `custom:${attribute.name.toLowerCase()}`;
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", ndash: "–", mdash: "—",
  aelig: "æ", oslash: "ø", aring: "å", AElig: "Æ", Oslash: "Ø", Aring: "Å", times: "×",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1]?.toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity] ?? match;
  });
}

/**
 * Turn WooCommerce HTML descriptions into plain-text paragraphs. Rendering plain text
 * means no HTML from the backend is ever injected into the page.
 */
export function htmlToParagraphs(html: string): string[] {
  const text = html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|h[1-6])\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}
