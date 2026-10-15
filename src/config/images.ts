/**
 * Hosts whose product photos the shop may show and optimize, besides WooCommerce itself.
 *
 * Supplier imports keep the supplier's photo links on the product (meta
 * `_wchc_external_images`) instead of copying thousands of photos into WordPress; see
 * docs/IMPORT-GUIRCA.md. Used by next.config.ts (image optimizer) and the product mapper,
 * which ignores links to any other host.
 */
export const SUPPLIER_IMAGE_HOSTS = ["marketing.guirca.com"];
