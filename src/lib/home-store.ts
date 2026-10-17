import { merchandising, merchandisingByStore, shownInNav, type Merchandising } from "@/config/merchandising";
import { brands, DEFAULT_STORE_ID, storeConfig, type Season } from "@/config/store";
import { SITE_URL } from "@/lib/seo";
import { categoryPath } from "@/lib/woocommerce/category-tree";
import type { ProductCategory } from "@/types/commerce";

/**
 * Which shop search engines should show a product or category in (its "home").
 *
 * The shops sell nearly every product, with the same name, text and photos. Left alone, Google
 * would pick one of the copies at random, so a Halloween costume could rank as a
 * Fastelavnskostumer.dk page. Instead each product page names its home shop's page as the
 * original (its canonical address), and only the home shop's sitemap lists it. The product
 * can still be bought in every shop that sells it; its home is always one of them.
 */

/** The slugs of these categories and of all their parent categories. */
function withParents(categories: { id: number; slug?: string }[], tree: ProductCategory[]): Set<string> {
  const slugs = new Set<string>();
  for (const category of categories) {
    if (category.slug) slugs.add(category.slug);
    const known = tree.find((c) => c.id === category.id);
    if (known) for (const c of categoryPath(tree, known)) slugs.add(c.slug);
  }
  return slugs;
}

/**
 * The store ID of the home shop of a product (its categories) or of a category page: the
 * first shop whose `homeCategories` include one of the categories or a parent of one, else
 * the default shop. E.g. a witch costume in "Halloween" → Halloweenkostumer.dk, a pirate
 * costume or a Santa suit → Fastelavnskostumer.dk.
 *
 * A product's home sells it: when `webshops` (the store IDs that sell the product) leave that
 * shop out, its home is the first shop that does, e.g. Halloweenkostumer.dk for a crude apron
 * in "Tøj" that only it sells (the products for adults only). Without `webshops` (unknown),
 * the categories decide.
 */
export function homeStoreFor(categories: { id: number; slug?: string }[], tree: ProductCategory[], webshops: readonly string[] = []): string {
  const slugs = withParents(categories, tree);
  const home = Object.entries(brands).find(([, brand]) => brand.homeCategories?.some((slug) => slugs.has(slug)))?.[0] ?? DEFAULT_STORE_ID;
  if (webshops.length === 0 || webshops.includes(home)) return home;
  return Object.keys(brands).find((id) => webshops.includes(id)) ?? home;
}

/**
 * The holiday this shop's description of a product can name: its season, when this shop is
 * the product's home and the product is one of the season's (merchandising.seasonFirst). None
 * in the other shops' copies, nor e.g. for a Santa suit, whose home is the Fastelavn shop.
 */
export function homeSeasonFor(categories: { id: number; slug?: string }[], tree: ProductCategory[], webshops: readonly string[] = []): Season | null {
  if (homeStoreFor(categories, tree, webshops) !== storeConfig.id) return null;
  const { seasonFirst } = merchandising;
  const slugs = withParents(categories, tree);
  const inSeasonCategories = seasonFirst.categories.some((slug) => slugs.has(slug));
  return inSeasonCategories === (seasonFirst.prefer === "in") ? storeConfig.season : null;
}

/** A shop's name: this shop's own (storeConfig.name), another's brand name. */
export function storeName(storeId: string): string {
  if (storeId === storeConfig.id) return storeConfig.name;
  return brands[storeId]?.name ?? storeConfig.name;
}

/** A shop's address without a trailing slash: this shop's own (SITE_URL), another's domain. */
export function storeUrl(storeId: string): string {
  if (storeId === storeConfig.id) return SITE_URL;
  return (brands[storeId]?.siteUrl ?? SITE_URL).replace(/\/+$/, "");
}

/**
 * Where a category page's canonical address is. Every category this shop shows in its menu
 * and category chips is here. One it keeps out of them (merchandising.hidden and navHidden)
 * belongs to the other shop that shows it, e.g. "Halloween" and "Halloweenpynt" in the
 * Fastelavn shop; one that no shop shows to its products' home shop (homeStoreFor), e.g.
 * "Julepynt" to the Fastelavn shop. Products keep their own home either way.
 */
export function categoryHomeStore(
  category: ProductCategory,
  tree: ProductCategory[],
  shops: Record<string, Merchandising> = merchandisingByStore,
): string {
  const own = shops[storeConfig.id] ?? merchandising;
  if (shownInNav(category.slug, own)) return storeConfig.id;
  const shownElsewhere = Object.entries(shops).find(([id, shop]) => id !== storeConfig.id && shownInNav(category.slug, shop));
  return shownElsewhere?.[0] ?? homeStoreFor([category], tree);
}
