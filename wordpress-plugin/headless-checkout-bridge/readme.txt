=== Headless Checkout Bridge ===
Requires at least: 6.4
Requires PHP: 7.4
WC requires at least: 8.5
Stable tag: 1.0.0
License: GPLv2 or later

Secure server-to-server checkout endpoints for a headless storefront (Next.js + Stripe).

== Description ==

Adds authenticated REST routes under /wp-json/wc-headless/v1 that let a headless storefront
use WooCommerce's own cart, tax, shipping, order and stock-reservation logic:

* POST /quote – authoritative prices, stock, tax and shipping for a cart (creates nothing)
* POST /orders – idempotently create/resume ONE pending order per checkout session and
  reserve stock (WooCommerce core ReserveStock); rejects a changed total
* POST /orders/{id}/payment-intent – attach a Stripe PaymentIntent (compare-and-set)
* POST /orders/{id}/payment – apply a verified payment status; stock is reduced only by
  WooCommerce core (payment_complete) and exactly once
* GET  /orders/{id}?order_key=… – order summary for the confirmation page

All routes require a WooCommerce REST API key (read/write) of a user with the
manage_woocommerce capability; order routes additionally require the order key.
The plugin does not change the shop's normal checkout and adds no admin screens.

Also adds `headless_prices` (display prices according to the shop's tax display
setting) to REST API v3 product and variation responses.

== Installation ==

Plugins → Add New → Upload Plugin → choose the zip → Install → Activate.
Check: GET /wp-json/wc-headless/v1/status with the API key.

== Changelog ==

= 1.0.0 =
* First release.
