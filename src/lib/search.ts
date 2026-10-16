import { merchandising, type Merchandising } from "@/config/merchandising";
import { storeConfig, type Season } from "@/config/store";
import type { Loadable, ProductCategory, ProductList, ProductSummary } from "@/types/commerce";

/** A category or theme page that fits the search. */
export type SuggestedLink = { label: string; href: string; kind: "Kategori" | "Tema" };

/** What the search field suggests while the customer types. */
export type Suggestions = {
  products: { id: number; name: string; slug: string; image: ProductSummary["image"]; price: string | null; from: boolean; adult: boolean }[];
  links: SuggestedLink[];
  /** The words the products were found by, when not the customer's own (e.g. "paryk" for "parykker"). */
  searched: string | null;
};

export const SUGGESTED_PRODUCTS = 6;
export const SUGGESTED_LINKS = 4;

/** Words the search page suggests trying, per shop (each finds plenty). */
export const SEARCH_EXAMPLES: Record<Season, string[]> = {
  fastelavn: ["prinsesse", "kat", "pirat", "superhelt"],
  halloween: ["heks", "vampyr", "zombie", "maske"],
};

/** "Heks!" -> "heks" (what the search compares). */
export function normalizeQuery(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
}

const fold = (text: string) => text.toLocaleLowerCase("da-DK");

/*
 * Danish search. WooCommerce's `search` finds products whose title or text contains every
 * word of the query as written, so Danish plurals ("parykker"), compounds ("zombiemaske")
 * and the customer's own words ("kattekonge") find little or nothing, although the
 * products are there under "Paryk", "Zombie … maske" and "Kongekrone".
 */

/**
 * Words from the catalogue with their plural and definite forms, base form first. A form
 * that contains its base is searched as the base, which finds everything the form finds and
 * more ("paryk" also matches every "parykker"). Compounds are split at them ("heksekostume").
 */
const WORDS: string[][] = [
  ["kostume", "kostumer", "kostumerne", "kostumet"],
  ["maske", "masker", "maskerne", "masken"],
  ["paryk", "parykker", "parykkerne", "parykken"],
  ["hat", "hatte", "hattene", "hatten"],
  ["kappe", "kapper", "kapperne", "kappen"],
  ["kjole", "kjoler", "kjolerne", "kjolen"],
  ["krone", "kroner", "kronerne", "kronen"],
  ["tiara", "tiaraer", "tiaraen"],
  ["handske", "handsker", "handskerne"],
  ["vinge", "vinger", "vingerne"],
  ["hale", "haler", "halen"],
  ["horn", "hornene"],
  ["dragt", "dragter", "dragten"],
  ["sæt", "sættet"],
  ["gebis", "gebisser", "gebisset"],
  ["tænder", "tænderne"],
  ["blod", "blodet"],
  ["sminke", "sminken"],
  ["heks", "hekse", "heksene", "heksen"],
  ["vampyr", "vampyrer", "vampyrerne", "vampyren"],
  ["zombie", "zombier", "zombierne", "zombien"],
  ["skelet", "skeletter", "skeletterne", "skelettet"],
  ["spøgelse", "spøgelser", "spøgelserne", "spøgelset"],
  ["pirat", "pirater", "piraterne", "piraten"],
  ["prinsesse", "prinsesser", "prinsesserne", "prinsessen"],
  ["superhelt", "superhelte", "superheltene", "superhelten"],
  ["klovn", "klovne", "klovnene", "klovnen"],
  ["ridder", "riddere", "ridderne", "ridderen"],
  ["viking", "vikinger", "vikingerne", "vikingen"],
  ["cowboy", "cowboys", "cowboyen"],
  ["indianer", "indianere", "indianerne"],
];

const BASE = new Map(WORDS.flatMap(([base, ...forms]) => [base!, ...forms].map((form) => [form, base!] as const)));
/** Compound heads, longest first ("kostumerne" before "kostume"). */
const HEADS = [...BASE.keys()].sort((a, b) => b.length - a.length);

/**
 * What customers search for that the catalogue says differently (folded), tried when a
 * search finds nothing. No "tønde": the shops sell no fastelavnstønde, only a beer-barrel
 * costume, so that search ends on the theme tiles instead.
 */
const SYNONYMS: Record<Season | "both", Record<string, string>> = {
  both: {
    "kunstigt blod": "blod",
    "falsk blod": "blod",
    kunstblod: "blod",
    teaterblod: "blod",
    "falske tænder": "tænder",
    udklædningstøj: "kostume",
  },
  fastelavn: {
    fastelavn: "kostume",
    fastelavnskostume: "kostume",
    fastelavnsudklædning: "kostume",
    kattekonge: "konge krone",
    kattedronning: "dronning krone",
  },
  halloween: {
    halloweenudklædning: "kostume",
    hugtand: "hugtænder",
    vampyrtand: "vampyrtænder",
    vampyrgebis: "gebis",
  },
};

/** Words that say nothing about the product ("heks til piger"). */
const STOPWORDS = new Set(["og", "i", "til", "med", "af", "på", "for", "fra", "en", "et", "str"]);

/**
 * The shop's own holiday as a search word, or the start of one ("halloweenmaske"). Nearly every
 * product in the shop is for it, but few names say so, and WooCommerce only finds products with
 * every word.
 */
const SEASON_WORDS: Record<Season, string[]> = { fastelavn: ["fastelavns", "fastelavn"], halloween: ["halloween"] };

const CONSONANT_PAIR = /([bcdfghjklmnpqrstvwxz])\1$/;
const undouble = (stem: string) => (CONSONANT_PAIR.test(stem) ? stem.slice(0, -1) : stem);

/** A catalogue word's base form when it contains it ("masker" → "maske"); otherwise the word. */
function baseForm(word: string): string {
  const base = BASE.get(word);
  return base && word.includes(base) ? base : word;
}

/**
 * The word without a Danish plural or definite ending, the likeliest first ("masker" →
 * "maske", "mask"; "parykker" → "paryk"; "hekse" → "heks"). Empty for short words and words
 * without such an ending.
 */
export function stems(word: string): string[] {
  if (word.length < 4 || !/^\p{L}+$/u.test(word)) return [];
  const ending = ["erne", "ene", "er", "en", "et", "e"].find((e) => word.endsWith(e) && word.length - e.length >= 3);
  if (!ending) return [];
  const base = word.slice(0, -ending.length);
  let found: string[];
  if (CONSONANT_PAIR.test(base)) found = [undouble(base)]; // parykker → paryk, skelettet → skelet
  else if (ending === "ene" || ending === "e") found = [base]; // heksene → heks
  else if (ending === "en" || ending === "et") found = [word.slice(0, -1), base]; // masken → maske, mask
  else found = /[aeiouyæøå]$/.test(base) ? [base] : [`${base}e`, base]; // masker → maske, mask; tiaraer → tiara
  return [...new Set(found)].filter((stem) => stem.length >= 3 && stem !== word);
}

/** The first part of a compound without its joining letter: "fastelavns" → "fastelavn", "katte" → "kat", "hekse" → "heks". */
function modifier(part: string): string {
  if (BASE.has(part)) return baseForm(part);
  if (part.length >= 6 && part.endsWith("s")) return part.slice(0, -1);
  if (part.length >= 4 && part.endsWith("e")) return undouble(part.slice(0, -1));
  return part;
}

/** "zombiemaske" → "zombie maske", "heksekostumer" → "heks kostume"; null when the word is no compound of a catalogue word. */
function splitCompound(word: string): string | null {
  if (BASE.has(word)) return null;
  const head = HEADS.find((h) => word.length - h.length >= 3 && word.endsWith(h));
  return head ? `${modifier(word.slice(0, -head.length))} ${baseForm(head)}` : null;
}

function withSynonyms(words: string[], season: Season): string {
  const table = new Map(Object.entries({ ...SYNONYMS.both, ...SYNONYMS[season] }));
  let text = ` ${words.join(" ")} `;
  for (const [phrase, replacement] of table) if (phrase.includes(" ")) text = text.replace(` ${phrase} `, ` ${replacement} `);
  return text
    .trim()
    .split(" ")
    .map((word) => {
      const key = [word, ...stems(word)].find((form) => table.has(form));
      return key ? table.get(key)! : word;
    })
    .join(" ");
}

const queryWords = (query: string) => fold(normalizeQuery(query)).split(" ").filter(Boolean);

/**
 * The words without the shop's own holiday: "halloween paryk" → "paryk" and "halloweenmaske" →
 * "maske" in the Halloween shop, "fastelavnskostume" → "kostume" in the Fastelavn shop. Kept
 * when it is all there is ("halloween") or the rest is no catalogue word ("halloweenpynt").
 */
function withoutSeason(words: string[], season: Season): string[] {
  const seasonWords = SEASON_WORDS[season];
  const others = words.filter((w) => !seasonWords.includes(w) && !STOPWORDS.has(w));
  return words.flatMap((w) => {
    if (seasonWords.includes(w)) return others.length > 0 ? [] : [w];
    const prefix = seasonWords.find((s) => w.startsWith(s));
    const rest = prefix ? w.slice(prefix.length).replace(/^-/, "") : "";
    return rest.length >= 3 && (BASE.has(rest) || splitCompound(rest)) ? [rest] : [w];
  });
}

/**
 * Other ways to search for the same thing, best first, for when a search finds nothing:
 * the shop's synonyms ("kattekonge" → "konge krone"), compounds split ("zombiemaske" →
 * "zombie maske"), then the words without their endings ("vampyrerne" → "vampyre", "vampyr").
 */
export function searchVariants(query: string, season: Season = storeConfig.season): string[] {
  const words = queryWords(query);
  const stemmed = (pick: (found: string[]) => string | undefined) => words.map((w) => (BASE.has(w) ? w : (pick(stems(w)) ?? w))).join(" ");
  const variants = [
    withSynonyms(words, season),
    words.map((w) => splitCompound(w) ?? w).join(" "),
    stemmed((found) => found[0]),
    stemmed((found) => found.at(-1)),
  ];
  const original = words.join(" ");
  return variants.filter((v, i) => v !== original && variants.indexOf(v) === i);
}

/**
 * What to search for, in order: the query without the shop's own holiday ("halloweenmaske" →
 * "maske") and with known plurals as their base form ("masker" → "maske", which finds every
 * "masker" too), then its variants for when that finds nothing.
 */
export function searchPlan(query: string, season: Season = storeConfig.season): string[] {
  const primary = withoutSeason(queryWords(query), season).map(baseForm).join(" ");
  return [primary, ...searchVariants(primary, season)];
}

export type SearchResult = {
  list: ProductList;
  /** What found the products (see searchPlan). */
  searched: string;
  /** True when the query itself found nothing and a variant was used. */
  fallback: boolean;
};

/**
 * Search along the plan (see searchPlan) until something is found, with at most `tries`
 * searches: each one is a WooCommerce read, cached but new for every new word.
 */
export async function searchProducts(
  query: string,
  run: (search: string) => Promise<Loadable<ProductList>>,
  { tries = 4, season = storeConfig.season }: { tries?: number; season?: Season } = {},
): Promise<Loadable<SearchResult>> {
  const [primary, ...variants] = searchPlan(query, season);
  const first = await run(primary!);
  if (!first.ok) return first;
  if (first.data.total === 0) {
    for (const variant of variants.slice(0, Math.max(0, tries - 1))) {
      const result = await run(variant);
      if (!result.ok) return result;
      if (result.data.total > 0) return { ok: true, data: { list: result.data, searched: variant, fallback: true } };
    }
  }
  return { ok: true, data: { list: first.data, searched: primary!, fallback: false } };
}

/** True when the search used other words than the customer's (shown as "Viser resultater for …"). */
export function searchedOtherWords(query: string, searched: string): boolean {
  return queryWords(query).join(" ") !== queryWords(searched).join(" ");
}

/** The words worth matching on: not "til", "med" … (unless that is all there is). */
function keywords(query: string): string[] {
  const words = queryWords(query);
  const kept = words.filter((w) => !STOPWORDS.has(w));
  return [...new Set(kept.length > 0 ? kept : words)];
}

/** Whether a product comes after the season's products (merchandising.seasonFirst). */
function offSeason(categories: ProductCategory[], seasonFirst: Merchandising["seasonFirst"]) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  // The product's category or one above it (a subcategory of "Halloween" is Halloween too).
  const inSeason = (category: { id: number; slug: string }) => {
    let current: { slug: string; parent?: number } | undefined = byId.get(category.id) ?? category;
    for (let depth = 0; current && depth < 10; depth++) {
      if (seasonFirst.categories.includes(current.slug)) return true;
      current = current.parent ? byId.get(current.parent) : undefined;
    }
    return false;
  };
  return (product: Pick<ProductSummary, "categories">) => product.categories.some(inSeason) !== (seasonFirst.prefer === "in");
}

/** How well a name fits the words: 2 for each word on its own ("Sort kat"), 1 inside another ("Kattemaske", "Katana"). */
function nameScore(name: string, words: string[]): number {
  const folded = fold(name);
  const own = new Set(folded.split(/[^\p{L}\p{N}]+/u));
  return words.reduce((score, w) => score + (own.has(w) ? 2 : folded.includes(w) ? 1 : 0), 0);
}

/**
 * Search results in a better order, within the page WooCommerce returned (which matches
 * descriptions too and sorts by date): products with the words in their name first, then
 * in each group the shop's season first, otherwise as they came.
 */
export function rankProducts<T extends Pick<ProductSummary, "name" | "categories">>(
  products: T[],
  query: string,
  categories: ProductCategory[] = [],
  seasonFirst: Merchandising["seasonFirst"] = merchandising.seasonFirst,
): T[] {
  const words = keywords(query);
  const later = offSeason(categories, seasonFirst);
  return products
    .map((product, index) => ({ product, index, score: nameScore(product.name, words), later: later(product) ? 1 : 0 }))
    .sort((a, b) => b.score - a.score || a.later - b.later || a.index - b.index)
    .map((entry) => entry.product);
}

/**
 * The shop's categories and themes whose names have the words (in any form), most specific
 * first: a word that fits fewer of them counts for more, and links that fit only a far
 * commoner word than the best one are left out ("heks kostume" → Hekse, not every costume
 * category). `searched` adds the words that actually found the products.
 */
export function matchingLinks(query: string, categories: ProductCategory[], searched?: string, limit = SUGGESTED_LINKS): SuggestedLink[] {
  const all: SuggestedLink[] = [
    ...categories.map((c) => ({ label: c.name, href: `/kategori/${c.slug}`, kind: "Kategori" as const })),
    ...merchandising.collections.map((c) => ({ label: c.title, href: `/tema/${c.slug}`, kind: "Tema" as const })),
  ];
  const forms = keywords(`${query} ${searched ?? ""}`).map((w) => [w, baseForm(w), ...stems(w)]);
  const fits = forms.map((f) => new Set(all.filter((link) => f.some((form) => fold(link.label).includes(form))).map((link) => link.href)));
  const score = (link: SuggestedLink) => fits.reduce((sum, hrefs) => (hrefs.has(link.href) ? sum + 1 / hrefs.size : sum), 0);
  const scored = all.map((link, index) => ({ link, index, score: score(link) }));
  const best = Math.max(0, ...scored.map((entry) => entry.score));
  return scored
    .filter((entry, i, list) => entry.score > 0 && entry.score >= best / 4 && list.findIndex((x) => x.link.href === entry.link.href) === i)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.link);
}

/**
 * The search field's suggestions: products with the words in their name first (WooCommerce
 * also matches descriptions), and the categories and themes that fit. `searched` is what
 * found the products, when that differs from the query (see searchProducts).
 */
export function buildSuggestions(query: string, products: ProductSummary[], categories: ProductCategory[], searched = query): Suggestions {
  return {
    products: rankProducts(products, searched, categories)
      .slice(0, SUGGESTED_PRODUCTS)
      .map((p) => {
        const range = p.priceRange && p.priceRange.min !== p.priceRange.max ? p.priceRange : null;
        return { id: p.id, name: p.name, slug: p.slug, image: p.image, price: range ? range.min : (p.price ?? p.priceRange?.min ?? null), from: Boolean(range), adult: p.adult };
      }),
    links: matchingLinks(query, categories, searched),
    searched: searchedOtherWords(query, searched) ? searched : null,
  };
}
