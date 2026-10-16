import { ADULT_CATEGORY_SLUGS, HYGIENE_CATEGORY_SLUGS } from "@/config/catalog";
import { SUPPLIER_IMAGE_HOSTS } from "@/config/images";
import { discountPercent } from "@/lib/pricing";
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

function meta(product: Pick<WcProduct, "meta_data">, key: string): unknown {
  return product.meta_data.find((m) => m.key === key)?.value;
}

/** An https link to an allowed supplier host, or null. */
function supplierUrl(value: unknown, hosts: readonly string[] | null = SUPPLIER_IMAGE_HOSTS): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (hosts === null || hosts.includes(url.hostname)) ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The product's photos: its WooCommerce images, or else the supplier photos an import
 * linked to (meta `_wchc_external_images`, only from SUPPLIER_IMAGE_HOSTS).
 */
export function productImages(product: Pick<WcProduct, "name" | "images" | "meta_data">): ProductImage[] {
  const own = product.images.map((i) => image(i)).filter((i): i is ProductImage => i !== null);
  if (own.length > 0) return own;
  const external = meta(product, "_wchc_external_images");
  if (!Array.isArray(external)) return [];
  const alt = decodeEntities(product.name);
  return external
    .map((src) => supplierUrl(src))
    .filter((src): src is string => src !== null)
    .map((src) => ({ src, alt, fit: "contain" as const }));
}

function prices(source: WcProduct | WcVariation) {
  const display = source.headless_prices;
  return {
    price: emptyToNull(display ? display.price : source.price),
    regularPrice: emptyToNull(display ? display.regular_price : source.regular_price),
    salePrice: emptyToNull(display ? display.sale_price : source.sale_price),
  };
}

/** "6 størrelser" (or "3 varianter") from a variable product's variation attribute. */
function variantSummary(product: WcProduct): string | null {
  if (product.type !== "variable") return null;
  const attribute = product.attributes.find((a) => a.variation && a.options.length > 0);
  if (!attribute) return null;
  const count = attribute.options.length;
  if (/^st(ø|oe?)rrelse$/i.test(decodeEntities(attribute.name).trim())) return count === 1 ? "1 størrelse" : `${count} størrelser`;
  return count === 1 ? "1 variant" : `${count} varianter`;
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** YouTube video IDs from links (youtube.com/watch?v=…, youtu.be/…, /embed/…, /shorts/…). */
export function youtubeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.map((link) => {
    try {
      const url = new URL(String(link));
      if (url.protocol !== "https:") return null;
      const host = url.hostname.replace(/^(www|m)\./, "");
      const id =
        host === "youtu.be"
          ? url.pathname.slice(1)
          : host === "youtube.com" || host === "youtube-nocookie.com"
            ? url.pathname === "/watch"
              ? url.searchParams.get("v")
              : (/^\/(?:embed|shorts)\/([^/]+)/.exec(url.pathname)?.[1] ?? null)
            : null;
      return id && YOUTUBE_ID.test(id) ? id : null;
    } catch {
      return null;
    }
  });
  return [...new Set(ids.filter((id): id is string => id !== null))];
}

export function mapProductSummary(product: WcProduct): ProductSummary {
  const display = product.headless_prices;
  const min = emptyToNull(display?.min_price);
  const max = emptyToNull(display?.max_price);
  const productPrices = prices(product);

  return {
    id: product.id,
    slug: product.slug,
    name: decodeEntities(product.name),
    type: product.type === "simple" || product.type === "variable" ? product.type : "other",
    ...productPrices,
    onSale: product.on_sale,
    priceRange: min && max ? { min, max } : null,
    image: productImages(product)[0] ?? null,
    stockStatus: stockStatus(product.stock_status),
    stockQuantity: product.manage_stock === true && !product.backorders_allowed ? product.stock_quantity : null,
    categories: product.categories.map((c) => ({ ...c, name: decodeEntities(c.name) })),
    tags: product.tags.map((t) => ({ id: t.id, name: decodeEntities(t.name) })),
    audience: product.attributes.find((a) => /^m(å|aa)lgruppe$/i.test(decodeEntities(a.name).trim()))?.options ?? [],
    variantSummary: variantSummary(product),
    discountPercent: product.type === "simple" ? discountPercent(productPrices.price, productPrices.regularPrice, product.on_sale) : null,
    hasVideo: youtubeIds(meta(product, "_wchc_videos")).length > 0,
    adult: product.categories.some((c) => ADULT_CATEGORY_SLUGS.includes(c.slug)),
  };
}

/** A GTIN (EAN-13, UPC …) of 8, 12, 13 or 14 digits, else "". */
function gtin(value: string): string {
  const digits = value.trim();
  return /^(\d{8}|\d{12,14})$/.test(digits) ? digits : "";
}

export function mapVariation(variation: WcVariation): ProductVariation {
  return {
    id: variation.id,
    sku: variation.sku,
    gtin: gtin(variation.global_unique_id),
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
    gtin: gtin(product.global_unique_id),
    description: htmlToParagraphs(product.description),
    shortDescription: htmlToParagraphs(product.short_description),
    images: productImages(product),
    purchasable: product.purchasable,
    attributes: product.attributes
      .filter((a) => a.variation)
      .map((a) => ({ name: decodeEntities(a.name), slug: attributeKey(a), options: a.options })),
    variations: variations.map(mapVariation),
    // Links only; any https host is fine (they are not passed to the image optimizer).
    sizeChart: supplierUrl(meta(product, "_wchc_size_chart"), null),
    safetyInfo: supplierUrl(meta(product, "_wchc_safety_info"), null),
    videos: youtubeIds(meta(product, "_wchc_videos")),
    hygiene: product.categories.some((c) => HYGIENE_CATEGORY_SLUGS.includes(c.slug)),
  };
}

export function mapCategory(category: WcCategory): ProductCategory {
  return {
    id: category.id,
    name: decodeEntities(category.name),
    slug: category.slug,
    description: htmlToParagraphs(category.description).join(" "),
    count: category.count,
    image: image(category.image),
    parent: category.parent,
    menuOrder: category.menu_order,
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
