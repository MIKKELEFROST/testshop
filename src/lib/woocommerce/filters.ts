import "server-only";
import { cacheTag } from "next/cache";
import { z } from "zod";
import {
  PRICE_BANDS,
  findSizeOption,
  priceBand,
  priceBandsBetween,
  sizeGroups,
  type FilterOptions,
  type FilterSelection,
  type SizeTerm,
} from "@/lib/listing-filters";
import { HOURS, fetched, orFailure, type Read } from "./cache";
import { wooRequest } from "./client";
import { decodeEntities } from "./mappers";
import { CATALOG_TAG, SIZE_ATTRIBUTE, type ProductFilters } from "./products";

/**
 * What the listing filters need from WooCommerce, cached for an hour so the filters add almost
 * nothing to the load on the WordPress host: the size terms (one list for the shop) and, per
 * listing, which sizes, prices and stock statuses it has (one request to WooCommerce's Store
 * API, which counts them in the database). The filtered products themselves are read through
 * the cached getProducts like any listing page.
 */

/** The products a listing shows, as far as its filter choices go: its categories and themes. */
export type ListingScope = { categoryIds?: number[]; tagIds?: number[] };

/**
 * The chosen filters as a product query, and the selection without what this shop doesn't
 * know (e.g. a size that no longer exists).
 */
export async function resolveFilters(selection: FilterSelection): Promise<{ query: ProductFilters; selection: FilterSelection }> {
  const query: ProductFilters = {};
  const known: FilterSelection = {};
  if (selection.size) {
    const option = findSizeOption(sizeGroups(await getSizeTerms()), selection.size);
    if (option) {
      query.sizeTermIds = [...option.termIds].sort((a, b) => a - b);
      known.size = option.key;
    }
  }
  const band = priceBand(selection.price);
  if (band) {
    if ("min" in band) query.minPrice = band.min;
    if ("max" in band) query.maxPrice = band.max;
    known.price = band.key;
  }
  if (selection.inStock) {
    query.inStockOnly = true;
    known.inStock = true;
  }
  return { query, selection: known };
}

/**
 * A size is offered when at least this many of the listing's products have it: a lone sized
 * set among thousands of accessories doesn't make a size filter.
 */
const MIN_SIZED_PRODUCTS = 3;

/**
 * The filter choices for a listing: the sizes and price bands its products have, and "Kun på
 * lager" when some are sold out. Chosen ones are always offered (so they can be removed).
 * Without the listing's facets (null scope, or WooCommerce can't say), every size and band.
 */
export async function getFilterOptions(scope: ListingScope | null, selection: FilterSelection): Promise<FilterOptions> {
  const [terms, facets] = await Promise.all([getSizeTerms(), scope ? getFacets(scope) : null]);
  const counts = new Map(facets?.sizeCounts.map((c) => [c.term, c.count]));
  // Products with the option's sizes (a product with two of them counts twice; close enough).
  const offered = (termIds: number[]) => !facets || termIds.reduce((sum, id) => sum + (counts.get(id) ?? 0), 0) >= MIN_SIZED_PRODUCTS;
  const sizes = sizeGroups(terms)
    .map((group) => ({
      key: group.key,
      label: group.label,
      options: group.options.filter((option) => option.key === selection.size || offered(option.termIds)).map(({ key, label }) => ({ key, label })),
    }))
    .filter((group) => group.options.length > 0);
  const inRange = new Set<string>((facets?.prices ? priceBandsBetween(facets.prices.min, facets.prices.max) : PRICE_BANDS).map((b) => b.key));
  const prices = PRICE_BANDS.filter((band) => band.key === selection.price || inRange.has(band.key)).map(({ key, label }) => ({ key, label }));
  return { sizes, prices, stock: Boolean(selection.inStock) || (facets?.notInStock ?? 0) > 0 };
}

/** The shop's size terms that have products; none when WooCommerce can't be read. */
async function getSizeTerms(): Promise<SizeTerm[]> {
  const result = await readSizeTerms().catch(orFailure);
  return result.ok ? result.data : [];
}

async function readSizeTerms(): Promise<Read<SizeTerm[]>> {
  "use cache: remote";
  cacheTag(CATALOG_TAG);
  return fetched("getSizeTerms", HOURS, async () => {
    const { data: attributes } = await wooRequest("wc/v3/products/attributes", {
      query: { _fields: "id,slug" },
      schema: z.array(z.object({ id: z.number(), slug: z.string() })),
    });
    const attribute = attributes.find((a) => a.slug === SIZE_ATTRIBUTE);
    if (!attribute) return [];
    const terms: SizeTerm[] = [];
    for (let page = 1; page <= 5; page++) {
      const { data, headers } = await wooRequest(`wc/v3/products/attributes/${attribute.id}/terms`, {
        query: { per_page: 100, page, hide_empty: true, _fields: "id,name" },
        schema: z.array(z.object({ id: z.number(), name: z.string() })),
      });
      terms.push(...data.map((t) => ({ id: t.id, name: decodeEntities(t.name) })));
      if (page >= Number(headers.get("x-wp-totalpages") ?? 1)) break;
    }
    return terms;
  });
}

type Facets = {
  /** How many of the listing's products have each size term (those with none are left out). */
  sizeCounts: { term: number; count: number }[];
  /** The listing's lowest and highest price in kr. (null when it has no products). */
  prices: { min: number; max: number } | null;
  /** Number of the listing's products that are sold out or on backorder. */
  notInStock: number;
};

const facetsSchema = z.object({
  price_range: z.object({ min_price: z.string(), max_price: z.string(), currency_minor_unit: z.number() }).nullable().optional(),
  attribute_counts: z.array(z.object({ term: z.number(), count: z.number() })).nullable().optional(),
  stock_status_counts: z.array(z.object({ status: z.string(), count: z.coerce.number() })).nullable().optional(),
});

/** A listing's facets; null when WooCommerce can't be read (the filters then offer everything). */
async function getFacets(scope: ListingScope): Promise<Facets | null> {
  // The same scope always gives the same cache entry (IDs sorted, no empty lists).
  const ids = (list: number[] | undefined) => (list && list.length > 0 ? [...new Set(list)].sort((a, b) => a - b) : undefined);
  const key: ListingScope = {};
  const categoryIds = ids(scope.categoryIds);
  const tagIds = ids(scope.tagIds);
  if (categoryIds) key.categoryIds = categoryIds;
  if (tagIds) key.tagIds = tagIds;
  const result = await readFacets(key).catch(orFailure);
  return result.ok ? result.data : null;
}

async function readFacets(scope: ListingScope): Promise<Read<Facets>> {
  "use cache: remote";
  cacheTag(CATALOG_TAG);
  return fetched("getListingFacets", HOURS, async () => {
    // The Store API counts all of WooCommerce's products, not only this webshop's, and knows
    // nothing of the plugin's category filters; close enough to tell which choices make sense.
    const { data } = await wooRequest("wc/store/v1/products/collection-data", {
      query: {
        "calculate_attribute_counts[0][taxonomy]": SIZE_ATTRIBUTE,
        "calculate_attribute_counts[0][query_type]": "or",
        calculate_price_range: true,
        calculate_stock_status_counts: true,
        category: scope.categoryIds?.join(","),
        tag: scope.tagIds?.join(","),
      },
      schema: facetsSchema,
    });
    // Prices come in the currency's minor unit (øre): "900" is 9 kr.
    const range = data.price_range;
    const unit = 10 ** (range?.currency_minor_unit ?? 2);
    const [min, max] = [range?.min_price, range?.max_price].map((price) => (price ? Number(price) / unit : NaN));
    return {
      sizeCounts: (data.attribute_counts ?? []).filter((c) => c.count > 0),
      prices: Number.isFinite(min) && Number.isFinite(max) ? { min: min!, max: max! } : null,
      notInStock: (data.stock_status_counts ?? []).filter((c) => c.status !== "instock").reduce((sum, c) => sum + c.count, 0),
    };
  });
}
