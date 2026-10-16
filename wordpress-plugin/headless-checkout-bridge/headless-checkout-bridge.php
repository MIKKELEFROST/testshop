<?php
/**
 * Plugin Name:       Headless Checkout Bridge
 * Description:       Secure server-to-server checkout endpoints for a headless storefront (Next.js + Stripe). Uses WooCommerce's own cart, tax, shipping, order and stock-reservation logic.
 * Version:           1.5.0
 * Requires at least: 6.4
 * Requires PHP:      7.4
 * Requires Plugins:  woocommerce
 * WC requires at least: 8.5
 * License:           GPL-2.0-or-later
 * Text Domain:       headless-checkout-bridge
 *
 * @package HeadlessCheckoutBridge
 */

defined( 'ABSPATH' ) || exit;

define( 'WCHC_VERSION', '1.5.0' );
define( 'WCHC_PATH', plugin_dir_path( __FILE__ ) );

/*
 * Minimum number of minutes stock is reserved for a headless order, used when the shop's
 * "Hold stock (minutes)" setting is empty. Reservations expire automatically in WooCommerce.
 */
if ( ! defined( 'WCHC_MIN_RESERVE_MINUTES' ) ) {
	define( 'WCHC_MIN_RESERVE_MINUTES', 15 );
}

/** Order meta keys. */
define( 'WCHC_META_CHECKOUT_ID', '_wchc_checkout_id' );
define( 'WCHC_META_FINGERPRINT', '_wchc_fingerprint' );
define( 'WCHC_META_STORE_ID', '_wchc_store_id' );
define( 'WCHC_META_STORE_BRANDING', '_wchc_store_branding' );
define( 'WCHC_META_PAYMENT_INTENT', '_wchc_payment_intent_id' );
define( 'WCHC_META_PAYMENT_INTENT_HISTORY', '_wchc_payment_intent_history' );
define( 'WCHC_META_REFUND_REQUIRED', '_wchc_refund_required' );
define( 'WCHC_META_FAILED_ATTEMPTS', '_wchc_failed_attempts' );
// Capture at shipment (1.5): the payment is authorized when the order is placed and captured
// when the order is completed. Orders without the status meta are paid orders from before 1.5.
define( 'WCHC_META_CAPTURE_STATUS', '_wchc_capture_status' );
define( 'WCHC_META_AUTHORIZED_AT', '_wchc_authorized_at' );
define( 'WCHC_META_SETTLE_CALLBACK', '_wchc_settle_callback' );
define( 'WCHC_META_RESERVATION_WARNED', '_wchc_reservation_warned' );
define( 'WCHC_META_CAPTURE_ATTEMPT', '_wchc_capture_attempt' );
define( 'WCHC_META_CAPTURE_LATE_WARNED', '_wchc_capture_late_warned' );
define( 'WCHC_PAYMENT_METHOD_ID', 'wchc_stripe' );

/** WP-Cron hook that cancels abandoned unpaid headless orders. */
define( 'WCHC_CLEANUP_HOOK', 'wchc_cancel_unpaid_orders' );

// Declare HPOS compatibility.
add_action(
	'before_woocommerce_init',
	static function () {
		if ( class_exists( \Automattic\WooCommerce\Utilities\FeaturesUtil::class ) ) {
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
		}
	}
);

add_action(
	'plugins_loaded',
	static function () {
		if ( ! class_exists( 'WooCommerce' ) ) {
			return;
		}

		require_once WCHC_PATH . 'includes/class-wchc-lock.php';
		require_once WCHC_PATH . 'includes/class-wchc-memory-session.php';
		require_once WCHC_PATH . 'includes/class-wchc-cart-builder.php';
		require_once WCHC_PATH . 'includes/class-wchc-orders.php';
		require_once WCHC_PATH . 'includes/class-wchc-rest-controller.php';
		require_once WCHC_PATH . 'includes/class-wchc-product-fields.php';
		require_once WCHC_PATH . 'includes/class-wchc-shops.php';
		require_once WCHC_PATH . 'includes/class-wchc-shipping.php';
		require_once WCHC_PATH . 'includes/class-wchc-category-filter.php';
		require_once WCHC_PATH . 'includes/class-wchc-emails.php';
		require_once WCHC_PATH . 'includes/class-wchc-capture.php';

		add_action( 'rest_api_init', array( new WCHC_REST_Controller(), 'register_routes' ) );
		WCHC_Product_Fields::init();
		WCHC_Shops::init();
		WCHC_Shipping::init();
		WCHC_Category_Filter::init();
		WCHC_Emails::init();
		WCHC_Orders::init_hooks();
		WCHC_Capture::init();
	}
);

register_deactivation_hook(
	__FILE__,
	static function () {
		wp_clear_scheduled_hook( WCHC_CLEANUP_HOOK );
	}
);
