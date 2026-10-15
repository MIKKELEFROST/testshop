=== Headless Checkout Bridge ===
Requires at least: 6.4
Requires PHP: 7.4
WC requires at least: 8.5
Stable tag: 1.1.0
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

All routes require a WooCommerce REST API key (read/write) of a user with the
manage_woocommerce capability; order routes additionally require the order key.
The plugin does not change the shop's normal checkout and adds no admin screens.

Unpaid headless orders are cancelled after the shop's "Hold stock (minutes)" (60 when
empty), by WP-Cron every 15 minutes and, throttled, from the storefront's own API calls,
so cleanup does not depend on site traffic.

Also adds `headless_prices` (display prices according to the shop's tax display
setting) to REST API v3 product and variation responses.

== Installation ==

Plugins → Add New → Upload Plugin → choose the zip → Install → Activate.
To update, upload the new zip the same way and choose "Replace current with uploaded".
Check: GET /wp-json/wc-headless/v1/status with the API key.

== Changelog ==

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
