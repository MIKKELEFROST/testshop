/**
 * Filters on product listings (category, theme and "Alle produkter" pages): size, price and
 * "Kun på lager". They live in the URL like the sorting (`?str=5-6-aar&pris=under-100&lager=ja`),
 * so pagination and sharing keep them. Used by the server and by the mobile filter sheet.
 */

/** A listing's chosen filters: a size option's key, a price band's key, in stock only. */
export type FilterSelection = { size?: string; price?: string; inStock?: boolean };

/** The choices a listing's filters offer (only those with products in the listing). */
export type FilterOptions = {
  sizes: { key: SizeGroupKey; label: string; options: { key: string; label: string }[] }[];
  prices: { key: string; label: string }[];
  /** Whether to offer "Kun på lager" (only when some of the listing's products are not in stock). */
  stock: boolean;
};

/** The URL parameters of the filters (the sorting is `sorter`, the page `side`). */
export const FILTER_PARAMS = { size: "str", price: "pris", inStock: "lager" } as const;

/** Price bands in kr. (incl. VAT, as shown). Each band ends just below the next one's start. */
export const PRICE_BANDS = [
  { key: "under-100", label: "Under 100 kr.", max: 99.99 },
  { key: "100-250", label: "100-250 kr.", min: 100, max: 249.99 },
  { key: "250-500", label: "250-500 kr.", min: 250, max: 499.99 },
  { key: "over-500", label: "Over 500 kr.", min: 500 },
] as const satisfies readonly { key: string; label: string; min?: number; max?: number }[];

export type PriceBand = (typeof PRICE_BANDS)[number];

export function priceBand(key: string | undefined): PriceBand | undefined {
  return PRICE_BANDS.find((band) => band.key === key);
}

/** The bands that can match products priced between `min` and `max` kr. */
export function priceBandsBetween(min: number, max: number): PriceBand[] {
  return PRICE_BANDS.filter((band) => ("min" in band ? band.min : 0) <= max && ("max" in band ? band.max : Infinity) >= min);
}

/** The filters in a listing's URL. Unknown values are left out. */
export function parseFilters(query: Record<string, string | string[] | undefined>): FilterSelection {
  const first = (name: string) => {
    const value = query[name];
    return Array.isArray(value) ? value[0] : value;
  };
  const size = first(FILTER_PARAMS.size);
  const price = first(FILTER_PARAMS.price);
  const selection: FilterSelection = {};
  if (size && /^[a-z0-9-]{1,24}$/.test(size)) selection.size = size;
  if (priceBand(price)) selection.price = price;
  if (first(FILTER_PARAMS.inStock) === "ja") selection.inStock = true;
  return selection;
}

/** The URL parameters for a selection (none for filters not chosen). */
export function filterParams(selection: FilterSelection): Record<string, string> {
  const params: Record<string, string> = {};
  if (selection.size) params[FILTER_PARAMS.size] = selection.size;
  if (selection.price) params[FILTER_PARAMS.price] = selection.price;
  if (selection.inStock) params[FILTER_PARAMS.inStock] = "ja";
  return params;
}

/** Number of chosen filters (shown on the "Filtrér" button). */
export function activeFilterCount(selection: FilterSelection): number {
  return Object.keys(filterParams(selection)).length;
}

/**
 * The listing's first page with these filters, keeping its other parameters (the sorting):
 * changing a filter starts again from page 1.
 */
export function filteredHref(path: string, params: Record<string, string>, selection: FilterSelection): string {
  const query = new URLSearchParams(params);
  for (const name of Object.values(FILTER_PARAMS)) query.delete(name);
  query.delete("side");
  for (const [name, value] of Object.entries(filterParams(selection))) query.set(name, value);
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}

// ---------------------------------------------------------------- sizes

/** A size term of WooCommerce's size attribute (pa_storrelse), e.g. "5-6 år" or "L (52-54)". */
export type SizeTerm = { id: number; name: string };

export type SizeGroupKey = "boern" | "voksne" | "sko";

/** A choice in the size filter: one or more size terms (e.g. "5-6 år" also finds "3-6 år"). */
export type SizeOption = { key: string; label: string; termIds: number[] };

export type SizeGroup = { key: SizeGroupKey; label: string; options: SizeOption[] };

/**
 * Children's sizes by age (whole years). A size is offered under every age it fits: "3-6 år"
 * under "2-4 år" and "5-6 år", so a parent picks the child's age and finds every costume that fits.
 */
const CHILD_AGES = [
  { key: "under-2-aar", label: "Under 2 år", from: 0, to: 1 },
  { key: "2-4-aar", label: "2-4 år", from: 2, to: 4 },
  { key: "5-6-aar", label: "5-6 år", from: 5, to: 6 },
  { key: "7-9-aar", label: "7-9 år", from: 7, to: 9 },
  { key: "10-12-aar", label: "10-12 år", from: 10, to: 12 },
  { key: "13-16-aar", label: "13-16 år", from: 13, to: 16 },
];

/** Adult sizes by letter: women's "L (42-44)" and men's "L (52-54)" are both "L". */
const LETTERS = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];

/** The ages a child's size fits: "5-6 år" → 5-6, "18-24 mdr." → 1-1. */
function childAges(name: string): { from: number; to: number } | null {
  const years = /^(\d+)-(\d+) år$/.exec(name);
  if (years) return { from: Number(years[1]), to: Number(years[2]) };
  const months = /^(\d+)-(\d+) mdr\.$/.exec(name);
  if (months) return { from: Math.floor(Number(months[1]) / 12), to: Math.floor(Math.max(Number(months[2]) - 1, 0) / 12) };
  return null;
}

/** The letters of an adult size: "S (36-38)" → S, "S-M" → S and M. */
function letters(name: string): string[] {
  const match = /^([A-Z]+(?:-[A-Z]+)?)(?: \(\d+-\d+\))?$/.exec(name);
  if (!match) return [];
  const found = match[1]!.split("-");
  return found.every((letter) => LETTERS.includes(letter)) ? found : [];
}

/** A shoe size range, as the Guirca import names them: "37-41". */
function isShoeSize(name: string): boolean {
  return /^\d+-\d+$/.test(name);
}

/**
 * The size filter's choices for these terms, grouped: children's ages, adult letters, shoe
 * sizes. Sizes the groups don't know (e.g. "Universal") are not offered.
 */
export function sizeGroups(terms: SizeTerm[]): SizeGroup[] {
  const children = CHILD_AGES.map((age) => ({
    key: age.key,
    label: age.label,
    termIds: terms.filter((t) => {
      const fits = childAges(t.name);
      return fits !== null && fits.from <= age.to && fits.to >= age.from;
    }).map((t) => t.id),
  }));
  const adults = LETTERS.map((letter) => ({
    key: letter.toLowerCase(),
    label: letter,
    termIds: terms.filter((t) => letters(t.name).includes(letter)).map((t) => t.id),
  }));
  const shoes = terms
    .filter((t) => isShoeSize(t.name))
    .sort((a, b) => parseInt(a.name, 10) - parseInt(b.name, 10))
    .map((t) => ({ key: `sko-${t.name}`, label: t.name, termIds: [t.id] }));
  const groups: SizeGroup[] = [
    { key: "boern", label: "Børn", options: children },
    { key: "voksne", label: "Voksne", options: adults },
    { key: "sko", label: "Sko", options: shoes },
  ];
  return groups.map((g) => ({ ...g, options: g.options.filter((o) => o.termIds.length > 0) })).filter((g) => g.options.length > 0);
}

/** The size option with this key, if any of the terms has it. */
export function findSizeOption(groups: SizeGroup[], key: string | undefined): SizeOption | undefined {
  return key ? groups.flatMap((g) => g.options).find((o) => o.key === key) : undefined;
}
