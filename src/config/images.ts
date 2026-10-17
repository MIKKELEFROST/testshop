/**
 * Hosts whose product photos the shop may show and optimize, besides WooCommerce itself.
 *
 * Supplier imports keep the supplier's photo links on the product (meta
 * `_wchc_external_images`) instead of copying thousands of photos into WordPress; see
 * docs/IMPORT-GUIRCA.md. Used by next.config.ts (image optimizer) and the product mapper,
 * which ignores links to any other host.
 */
export const SUPPLIER_IMAGE_HOSTS = ["marketing.guirca.com"];

/**
 * Both WordPress hosts of the move from test.piece.dk to admin.onlinemarketing.nu. next.config.ts
 * lets the image optimizer show their uploads besides WOOCOMMERCE_URL's own host, whichever of
 * the two that is: after the move, carts saved in browsers, shared pages and the optimizer's
 * cache still have test.piece.dk links, and a deployment still built for one host can be handed
 * links on the other. Empty the list about 31 days after both shops read the new host (the
 * optimizer keeps its copies that long, minimumCacheTTL in next.config.ts); see
 * docs/WOOCOMMERCE.md, section 13. Not for the mapper: WordPress's own photos are not filtered.
 */
export const WORDPRESS_MOVE_HOSTS: string[] = ["test.piece.dk", "admin.onlinemarketing.nu"];
