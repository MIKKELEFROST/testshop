/**
 * Top-level WooCommerce categories (slugs) whose products are accessories: they fill
 * "Relevant tilbehør" on product pages. Their subcategories (hats, wigs, masks …) count as
 * kinds of accessory, so the row shows one of each kind first.
 */
export const ACCESSORY_CATEGORY_SLUGS = ["tilbehoer", "make-up"];

/** Products in each row on a product page (two rows of five on desktop). */
export const RELATED_LIMIT = 10;

/**
 * Categories whose products are for adults only (18+): marked as such, and left out of the
 * front page, recommendations and general listings; found in their category and in search.
 */
export const ADULT_CATEGORY_SLUGS = ["polterabend-18"];

/** Costume categories: a theme's tile shows a costume (someone wearing it) when it has one. */
export const COSTUME_CATEGORY_SLUGS = ["damekostumer", "herrekostumer", "pigekostumer", "drengekostumer", "babykostumer"];
