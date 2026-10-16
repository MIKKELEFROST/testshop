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

/**
 * Categories whose products can come with a hygiene seal: the Make-up subcategories (make-up
 * and face paint, blood and effects with the false teeth, glitter, nails and lashes). Products
 * carry the subcategory, not "make-up" itself; it is listed for products filed there directly.
 * Their product pages say that the 30-day return right ends once the seal is broken, as
 * /fortrydelsesret promises. Masks are not here: they are not sold sealed, so they can be
 * returned like any other product.
 */
export const HYGIENE_CATEGORY_SLUGS = ["make-up", "sminke-og-ansigtsmaling", "blod-og-effekter", "glimmer-og-ansigtssmykker", "negle-og-oejenvipper"];

/** Costume categories: a theme's tile shows a costume (someone wearing it) when it has one. */
export const COSTUME_CATEGORY_SLUGS = ["damekostumer", "herrekostumer", "pigekostumer", "drengekostumer", "babykostumer"];
