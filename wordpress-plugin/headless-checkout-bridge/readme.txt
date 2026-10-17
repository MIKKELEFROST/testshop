=== Headless Checkout Bridge ===
Requires at least: 6.4
Requires PHP: 7.4
WC requires at least: 8.5
Stable tag: 1.6.0
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
  WooCommerce core (payment_complete, processing or on-hold) and exactly once. Records the
  payment method actually used and notes each declined attempt once
* POST /payments/sweep – the storefront's daily job: a webshop's orders whose reserved payment
  is to be captured (completed) or released (cancelled), and warnings about old reservations
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
the order (`store`: name, url, email, color, logo, and the seller and return rules
company_name, company_address, cvr, return_address, return_shipping, return_days), stored
as order meta `_wchc_store_branding` (invalid fields are dropped). WooCommerce's e-mails
for that order then use the webshop's name as From name and its e-mail as Reply-To
(customer e-mails), put its name, address and e-mail into {site_title}, {site_url},
{store_url} and {store_email}, and use its logo as header image and its colour as base
colour. The "New order" subject names the webshop. The customer's order confirmation
("Processing order", "Order on-hold") carries the withdrawal information and the standard
withdrawal form (Danish forbrugeraftaleloven: on a durable medium, at the latest on
delivery). Orders without a brand get the normal e-mails.

Capture at shipment (1.5): a card may as a rule only be charged when the goods are sent. The
storefront authorizes the payment when the order is placed (event `authorized`): the order goes
to Processing (1.6; on-hold before) with the note "Betalingen er reserveret og trækkes, når ordren
sendes", core reduces stock once and sends the customer's Processing e-mail (once) and "New
order", and nothing is paid yet: no transaction ID, no date paid. A payment still processing at
Stripe keeps the order on-hold until it is authorized. When the shop marks the order Completed,
the plugin tells the storefront that created it (POST to the callback URL it sent with the
authorization, with the order's token: an HMAC only the storefront can make). The storefront
re-reads the order, captures the payment in Stripe and reports it: transaction ID, date paid (the
capture's), note "Betalingen er trukket". On-hold is for what needs clarifying: the shop's own
holds change nothing about the payment, and a refused capture or an expired reservation puts the
order on-hold with a note and e-mails the shop; when the shop has collected the payment another
way, the order action "Betalingen er klaret uden om webshoppen" lets the order stay Completed.
Cancelled, refunded or failed before that: the storefront releases the reservation. The
storefront's daily job (POST /payments/sweep) settles what could not be reported and warns about
reservations older than five days (filter wchc_reservation_warn_days) and about sent orders not
captured a day later. Order action "Træk eller frigiv betalingen nu" reports the order again.
Orders reserved on-hold by 1.5 are captured and released the same way. Orders paid at once
(before 1.5) are not touched.

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

= 1.6.0 =
* Payments: an authorized payment puts the order in Processing ("Behandler": to be sent) instead
  of on-hold. Still not paid: no transaction ID, no date paid (core's date on Processing is cleared
  before the status hooks and e-mails run), stock reduced once; Completed captures as before. A
  payment still processing at Stripe stays on-hold until it is authorized, then goes to Processing.
  An order the shop holds itself, or has moved on to Processing or Completed while the payment was
  processing (order meta `_wchc_payment_processing`), keeps that status when the payment is
  authorized, and a Completed one is captured at once; before, that reservation was released.
* Payments: on-hold is for what needs clarifying. The shop's own on-hold (and back to Processing)
  changes nothing about the reservation. A reservation that expires or is cancelled in Stripe while
  the order is Processing puts it on-hold, with the note and e-mail to the shop as before. Orders
  reserved on-hold by 1.5 keep working (capture on Completed, release on Cancelled) and can be
  moved to Processing by hand. An order whose reservation expired or was released gets no date paid
  when it is moved to Processing or Completed.
* E-mails: the customer's order confirmation of a reserved order is WooCommerce's "Processing
  order" e-mail, with "Vi har reserveret … Beløbet trækkes først, når vi sender din ordre" and the
  withdrawal information; it is sent automatically once per order (order meta `_wchc_confirmation_sent`), not
  again after the shop puts the order on-hold and back (sent on purpose, e.g. with WooCommerce's
  order e-mail action, it goes out as always). After "processing" at Stripe the customer
  gets the on-hold e-mail first and the Processing e-mail when it is authorized. "New order" once.
* Notes: "Ordren er sat tilbage til På hold" (WooCommerce's Danish name of on-hold).

= 1.5.0 =
* Payments: capture at shipment. New payment events `authorized` (the amount is reserved: order
  on-hold, stock reduced once, on-hold and "New order" e-mails once, payment method title, note,
  nothing paid) and `capture_failed`; `succeeded` on a reserved order records the capture
  (transaction ID, date paid, note) and `canceled` its release or expiry. Order meta
  `_wchc_capture_status`, `_wchc_authorized_at`, `_wchc_settle_callback`, `_wchc_capture_attempt`,
  `_wchc_reservation_warned`, `_wchc_capture_late_warned`. A reserved order has no date paid until
  it is captured (core's date on Processing or Completed is cleared, and the capture's is kept).
* Payments: when a reserved order is marked Completed, Cancelled, Refunded or Failed, the plugin
  tells the storefront that created it (https POST with the order's token, at most 10 orders per
  request, after WooCommerce has saved the order; follows up to two 301/307/308 redirects). What
  cannot be sent is noted on the order. Order action "Træk eller frigiv betalingen nu" sends it
  again.
* Payments: a refused capture or an expired reservation of a sent order puts it back on-hold with
  a note and an e-mail to the shop ("New order" recipients), also noted and e-mailed when another
  request holds the order; an expired reservation of an unsent order is noted and e-mailed too.
* Payments: order action "Betalingen er klaret uden om webshoppen" (capture status `manual`) for
  an order whose reservation expired, was released or was refused: the order can then stay
  Completed.
* REST: `POST /payments/sweep` lists a webshop's reserved orders to capture or release and warns
  (note and one e-mail) about reservations older than five days and, once per capture attempt,
  about sent orders still not captured a day after they were completed. `GET /orders/{id}` and the other
  order responses include `capture` (status, amount to capture, authorized_at, attempt).
* E-mails: the customer's on-hold e-mail of a reserved order says that the amount is reserved and
  charged when the order is sent (its intro no longer says the order waits for the payment);
  "New order" tells the shop to mark it Completed when sent; the completed e-mail says the amount
  is charged now; the refund e-mails say that nothing was charged, so nothing is paid back.

= 1.4.0 =
* E-mails: the customer's order e-mails and "New order" show the webshop the order came from:
  From name, Reply-To, {site_title}, {site_url} and {store_url}, header image and base colour.
  The storefront sends its brand with the order (`store`), stored as `_wchc_store_branding`.
  Orders without it, e.g. from older storefronts, get the e-mails as before.
* E-mails: {store_email} in a branded e-mail is the webshop's e-mail, not WooCommerce's From
  address, which all webshops share.
* E-mails: the customer's order confirmation ("Processing order" and "Order on-hold", HTML and
  plain text) of a branded order carries the withdrawal information and the standard withdrawal
  form after the addresses: 14 days' withdrawal right and the shop's longer return period
  (`return_days`), notice to the webshop's e-mail, the return address, who pays the return
  shipping, the refund within 14 days, the hygiene exception and the seller (company name, CVR,
  address). WordPress does not have these details, so the storefront sends them in `store`;
  details it does not send are left out.
* Category counts are also recounted after a product is trashed or restored in the products
  list, published by WP-Cron (scheduled) and after a webshop is created, renamed or deleted.
  A recount that overlapped such a change is not cached, so it cannot keep stale counts.
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
