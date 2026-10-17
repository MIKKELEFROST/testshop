import type { Season } from "@/config/store";
import { productCount } from "@/lib/format";
import { formatAmount } from "@/lib/money";
import type { Product, ProductCategory } from "@/types/commerce";

/**
 * Meta descriptions (the text under the title in search results). Most Guirca products have a
 * one-line supplier text ("Kostume til piger med kjole.") and most categories none, so the
 * shop builds its own from the facts it has. The promises are the shop's usual ones
 * (src/config/usps.ts): "1-dags levering" and "gratis retur i 30 dage", never a delivery date.
 */

/** About as long as search engines show in full. */
export const DESCRIPTION_LENGTH = 155;

const SIZE_ATTRIBUTE = /^st(ø|oe?)rrelse$/i;

/** Cut to at most `max` characters at a word boundary, ending in "…". */
export function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}

/** A sentence with a full stop at the end, unless it has one. */
function sentence(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return !trimmed || /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** "199 kr.", or "fra 149 kr." for sizes at different prices; "" without a price. */
function priceText(product: Pick<Product, "price" | "priceRange">): string {
  const range = product.priceRange;
  if (range && Number(range.min) !== Number(range.max)) return `fra ${formatAmount(range.min)} kr.`;
  const price = range?.min ?? product.price;
  return price ? `${formatAmount(price)} kr.` : "";
}

/** "Str. 3-4 år, 5-6 år." or, for more than three sizes, "Str. 3-4 år til 10-12 år."; "" without sizes. */
function sizesText(product: Pick<Product, "attributes">): string {
  const sizes = product.attributes.find((a) => SIZE_ATTRIBUTE.test(a.name.trim()))?.options ?? [];
  if (sizes.length === 0) return "";
  return `Str. ${sizes.length <= 3 ? sizes.join(", ") : `${sizes[0]} til ${sizes.at(-1)}`}.`;
}

/**
 * A product's description of about 155 characters: name and price, the short description,
 * the sizes, the holiday (when the name and text don't say it), the promises and the shop.
 * What doesn't fit is left out in this order: the shop (it is in the title too), the sizes,
 * then the end of the short description. E.g. "Piratkostume til drenge – 199 kr. Kostume
 * med hat. Str. 3-4 år til 10-12 år. Klar til fastelavn med 1-dags levering og gratis
 * retur i 30 dage."
 */
export function productDescription(
  product: Pick<Product, "name" | "price" | "priceRange" | "shortDescription" | "attributes">,
  options: { shop: string; season: Season | null },
): string {
  const price = priceText(product);
  const head = price ? `${product.name} – ${price}` : sentence(product.name);
  const short = sentence(product.shortDescription.join(" "));
  const sizes = sizesText(product);
  const named = `${product.name} ${short}`.toLowerCase();
  const promise = `${options.season && !named.includes(options.season) ? `Klar til ${options.season} med 1-dags` : "1-dags"} levering og gratis retur i 30 dage`;

  const join = (parts: string[]) => parts.filter(Boolean).join(" ");
  const candidates = [
    [short, sizes, `${promise} hos ${options.shop}.`],
    [short, sizes, `${promise}.`],
    [short, `${promise} hos ${options.shop}.`],
    [short, `${promise}.`],
  ];
  for (const parts of candidates) {
    const text = join([head, ...parts]);
    if (text.length <= DESCRIPTION_LENGTH) return text;
  }
  // A long name or text: shorten the text (or leave it out when hardly anything would be left).
  const room = DESCRIPTION_LENGTH - join([head, `${promise}.`]).length - 1;
  return shorten(join([head, room >= 30 ? shorten(short, room) : "", `${promise}.`]), DESCRIPTION_LENGTH);
}

/**
 * "Alle produkter": e.g. "Alle 6.284 varer hos Fastelavnskostumer.dk: kostumer, masker,
 * parykker, tilbehør og pynt. 1-dags levering og gratis retur i 30 dage."
 */
export function allProductsDescription(total: number, shop: string): string {
  return shorten(`Alle ${productCount(total)} hos ${shop}: kostumer, masker, parykker, tilbehør og pynt. 1-dags levering og gratis retur i 30 dage.`, DESCRIPTION_LENGTH);
}

/** A listing's page 2, 3 …: "Side 2: " before its description, so the pages' descriptions differ. */
export function pageDescription(description: string, page: number): string {
  return page > 1 ? shorten(`Side ${page}: ${description}`, DESCRIPTION_LENGTH) : description;
}

/**
 * A category's description when neither the shop (merchandising.categoryIntros) nor
 * WooCommerce has one, e.g. "Pigekostumer hos Fastelavnskostumer.dk: 812 varer med 1-dags
 * levering (bestil før kl. 19 på hverdage) og gratis retur i 30 dage."
 */
export function categoryDescription(category: Pick<ProductCategory, "name" | "count">, shop: string): string {
  return shorten(
    `${category.name} hos ${shop}: ${productCount(category.count)} med 1-dags levering (bestil før kl. 19 på hverdage) og gratis retur i 30 dage.`,
    DESCRIPTION_LENGTH,
  );
}
