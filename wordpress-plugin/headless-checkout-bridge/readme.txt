=== Headless Checkout Bridge ===
Requires at least: 6.4
Requires PHP: 7.4
WC requires at least: 8.5
Stable tag: 1.4.0
License: GPLv2 or later

Secure server-to-server checkout endpoints for a headless storefront (Next.js + Stripe).

== Description ==

Adds authenticated REST routes under /wp-json/wc-headless/v1 that let a headless storefront
use WooCommerce's own cart, tax, shipping, order and stock-reservation logic:

* POST /quote – authoritative prices, stock, tax, shipping and coupons for a cart
  (creates nothing)
* POST /orders – idempotently create/resume ONE pending order per checkout session and
  reserve stock (WooCommerce core ReserveStock); rejects a changed total or a coupon
  that no longer applies. An unpaid order older than the hold time is cancelled and
  replaced instead of resumed
* POST /orders/{id}/payment-intent – attach a Stripe PaymentIntent (compare-and-set)
* POST /orders/{id}/payment – apply a verified payment status; stock is reduced only by
  WooCommerce core (payment_complete) and exactly once. Records the payment method
  actually used and notes each declined attempt once
* GET  /orders/{id}?order_key=… – order summary for the confirmation page
* GET  /shops, PUT /shops/{store-id} – list webshops, create or rename one

All routes require a WooCommerce REST API key (read/write) of a user with the
manage_woocommerce capability; order routes additionally require the order key.
The plugin does not change the shop's normal checkout, except for "Fri fragt fra" below.

Several storefronts can share this WooCommerce ("webshops"). Products → Webshops lists
them; the slug of a webshop is its storefront's store ID. Tick the webshops that sell a
product in the "Webshops" box on the product. A storefront then lists only its own
products (GET /wc/v3/products?wchc_shop=<store-id>), and /quote and /orders refuse
products its webshop does not sell. A store ID that is not a webshop sells every product,
as before. Product responses include `webshops`, which can also be set through the REST
API, and the orders list shows which webshop each headless order came from.

GET /wc/v3/products?category=<id>&wchc_in_category=<id>[,<id>…] lists only the products
that are also in each of the wchc_in_category categories (or their subcategories);
WooCommerce's own `category` matches any of its categories. wchc_not_in_category=<id>[,<id>…]
leaves out products in any of its categories or their subcategories, and
wchc_in_any_category=<id>[,<id>…] requires one of its categories. All combine with
`category`, `tag` and `wchc_shop`.

Order e-mails show the webshop the order came from. The storefront sends its brand with
the order (`store`: name, url, email, color, logo), stored as order meta
`_wchc_store_branding` (invalid fields are dropped). WooCommerce's e-mails for that order
then use the webshop's name as From name and its e-mail as Reply-To (customer e-mails),
put its name and address into {site_title}, {site_url} and {store_url}, and use its logo
as header image and its colour as base colour. The "New order" subject names the webshop.
Orders without it get the normal e-mails.

Unpaid headless orders are cancelled after the shop's "Hold stock (minutes)" (60 when
empty), by WP-Cron every 15 minutes and, throttled, from the storefront's own API calls,
so cleanup does not depend on site traffic.

Also adds `headless_prices` (display prices according to the shop's tax display
setting) to REST API v3 product and variation responses.

Flat rate shipping methods get the setting "Fri fragt fra" (free from). When the goods
reach that amount (after discounts, incl. tax when the cart shows prices incl. tax), the
method costs 0, so the customer still chooses the carrier. Empty: the normal price.

== Installation ==

Plugins → Add New → Upload Plugin → choose the zip → Install → Activate.
To update, upload the new zip the same way and choose "Replace current with uploaded".
Check: GET /wp-json/wc-headless/v1/status with the API key.

== Changelog ==

= 1.4.0 =
* E-mails: the customer's order e-mails and "New order" show the webshop the order came from:
  From name, Reply-To, {site_title}, {site_url} and {store_url}, header image and base colour.
  The storefront sends its brand with the order (`store`), stored as `_wchc_store_branding`.
  Orders without it, e.g. from older storefronts, get the e-mails as before.
* REST: `wchc_in_category=<id>[,<id>…]` lists only products that are also in each of these
  categories, e.g. category=Damekostumer&wchc_in_category=Halloween. Works with `wchc_shop`.
* REST: `wchc_not_in_category=<id>[,<id>…]` leaves out products in any of these categories
  or their subcategories, e.g. Halloween and Christmas on a Fastelavn theme page.
* REST: `GET /wc-headless/v1/shops/<slug>/category-counts` gives the webshop's number of
  published products per category (subcategories included) in one request, cached until a
  product or category changes. The storefront no longer counts with one request per category,
  which kept small web hosts from answering (HTTP 508).
* REST: `wchc_in_any_category=<id>[,<id>…]` lists only products in one of these categories
  (or their subcategories): with `wchc_not_in_category` a category page lists its own
  season's products first and the rest after.

= 1.3.1 =
* Flat rates saved before 1.3 get the empty "Fri fragt fra" setting. Without it, WooCommerce's
  REST API printed PHP warnings into its shipping method responses on sites that display errors.

= 1.3.0 =
* Shipping: "Fri fragt fra" on flat rates. From that amount (goods after discounts, as the
  cart shows them) the method is free, in quotes, orders and the normal checkout.

= 1.2.0 =
* Webshops: assign products to one or more storefronts (Products → Webshops). Each
  storefront lists only its own products, and quotes and orders refuse other products.
* Product REST responses include `webshops` (slugs), which can be set through the API.
* "Webshop" column in the orders list. /status lists the webshops.

= 1.1.0 =
* Coupons: /quote and /orders apply WooCommerce coupons (all of WooCommerce's rules,
  including usage limits and e-mail restrictions) and report rejected codes with the reason.
* An unpaid order older than the hold time is replaced by a new order instead of being
  resumed with its old number and date.
* The order shows the payment method actually used, e.g. "MobilePay (Stripe)".
* A declined payment attempt is noted on the order once, however often it is reported.
* Abandoned unpaid orders are cancelled reliably (WP-Cron plus API-triggered sweep);
  WooCommerce's own cleanup job is rescheduled if it went missing. /status reports it.

= 1.0.0 =
* First release.
