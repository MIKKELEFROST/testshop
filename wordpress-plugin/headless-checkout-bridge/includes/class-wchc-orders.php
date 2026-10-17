<?php
/**
 * Order lifecycle for headless checkouts.
 *
 * - One WooCommerce order per checkout session (checkout_id), created through
 *   WC_Checkout::create_order() so core hooks, taxes, shipping lines and stock
 *   reservation behave exactly like the normal WooCommerce checkout.
 * - One Stripe PaymentIntent per order (compare-and-set under a lock).
 * - Idempotent, lock-protected payment state transitions. Stock is reduced and
 *   released only by WooCommerce core (payment_complete / status changes).
 * - Payments are authorized when the order is placed and captured when it is sent
 *   (WCHC_Capture, since 1.5): a reserved order is processing (on-hold before 1.6), though not
 *   paid. Orders paid before 1.5 keep the old path.
 * - Unpaid orders are never resumed after the shop's hold time and are cancelled by a
 *   sweep that does not depend on WP-Cron alone.
 *
 * @package HeadlessCheckoutBridge
 */

defined( 'ABSPATH' ) || exit;

use Automattic\WooCommerce\Checkout\Helpers\ReserveStockException;
use Automattic\WooCommerce\Internal\DataStores\Orders\OrdersTableDataStore;
use Automattic\WooCommerce\Utilities\OrderUtil;

/**
 * Order service.
 */
final class WCHC_Orders {

	/**
	 * Register hooks.
	 */
	public static function init_hooks(): void {
		// Always reserve stock for headless orders, even if "Hold stock (minutes)" is empty.
		add_filter(
			'woocommerce_order_hold_stock_minutes',
			static function ( $minutes, $order ) {
				if ( $order instanceof WC_Order && $order->get_meta( WCHC_META_CHECKOUT_ID ) && (int) $minutes < 1 ) {
					return WCHC_MIN_RESERVE_MINUTES;
				}
				return $minutes;
			},
			10,
			2
		);

		add_filter(
			'cron_schedules',
			static function ( $schedules ) {
				$schedules['wchc_fifteen_minutes'] = array(
					'interval' => 15 * MINUTE_IN_SECONDS,
					'display'  => 'Every 15 minutes (Headless Checkout Bridge)',
				);
				return $schedules;
			}
		);
		add_action( WCHC_CLEANUP_HOOK, array( __CLASS__, 'cancel_unpaid_orders' ), 10, 0 );
		add_action(
			'init',
			static function () {
				if ( ! wp_next_scheduled( WCHC_CLEANUP_HOOK ) ) {
					wp_schedule_event( time() + 5 * MINUTE_IN_SECONDS, 'wchc_fifteen_minutes', WCHC_CLEANUP_HOOK );
				}
			}
		);
	}

	/**
	 * Minutes after which an unpaid headless order is treated as abandoned: the shop's
	 * "Hold stock (minutes)" setting, like WooCommerce's own cleanup, or 60 when it is empty.
	 */
	public static function unpaid_order_minutes(): int {
		$hold = (int) get_option( 'woocommerce_hold_stock_minutes', 0 );
		return max( 1, (int) apply_filters( 'wchc_unpaid_order_minutes', $hold > 0 ? $hold : 60 ) );
	}

	/**
	 * Whether an unpaid order was created so long ago that it should not be resumed: the
	 * customer would otherwise pay an order with an old number and date.
	 *
	 * @param WC_Order $order Order.
	 */
	private static function is_stale( WC_Order $order ): bool {
		$created = $order->get_date_created();
		return $created && $created->getTimestamp() < time() - self::unpaid_order_minutes() * MINUTE_IN_SECONDS;
	}

	/**
	 * Cancel an order if it is still unpaid. Takes the order lock, so it never races a payment.
	 *
	 * @param int    $order_id Order ID.
	 * @param string $note     Order note.
	 * @param int    $wait     Seconds to wait for the order lock.
	 * @return bool True when the order was cancelled.
	 */
	private static function cancel_if_unpaid( int $order_id, string $note, int $wait ): bool {
		$lock = 'order:' . $order_id;
		if ( ! WCHC_Lock::acquire( $lock, $wait ) ) {
			return false;
		}
		try {
			$order = self::load_fresh( $order_id );
			if ( ! $order || ! $order->has_status( array( 'pending', 'failed' ) ) ) {
				return false;
			}
			// Core releases the stock hold and any held coupons on cancellation.
			$order->update_status( 'cancelled', $note );
			return true;
		} finally {
			WCHC_Lock::release( $lock );
		}
	}

	/**
	 * Cancel abandoned headless orders (unpaid for longer than unpaid_order_minutes()).
	 *
	 * WooCommerce's own "cancel unpaid orders" job depends on WP-Cron / Action Scheduler,
	 * which rarely runs on a headless site without visitors. This sweep runs from WP-Cron
	 * as well as (throttled) from the storefront's own API calls.
	 *
	 * @param int $limit Maximum orders to cancel in one run.
	 * @return int Number of cancelled orders.
	 */
	public static function cancel_unpaid_orders( int $limit = 10 ): int {
		update_option( 'wchc_unpaid_cleanup_last_run', time(), false );
		self::ensure_core_cleanup_scheduled();

		$limit   = max( 1, $limit );
		$minutes = self::unpaid_order_minutes();
		$ids     = wc_get_orders(
			array(
				'status'        => array( 'pending', 'failed' ),
				'created_via'   => 'checkout',
				'date_modified' => '<' . ( time() - $minutes * MINUTE_IN_SECONDS ),
				'orderby'       => 'date',
				'order'         => 'ASC',
				'limit'         => $limit * 3,
				'return'        => 'ids',
			)
		);

		$cancelled = 0;
		foreach ( $ids as $order_id ) {
			$order = wc_get_order( $order_id );
			if ( ! $order instanceof WC_Order || ! $order->get_meta( WCHC_META_STORE_ID ) ) {
				continue; // Not a headless order: left to WooCommerce.
			}
			$note = sprintf( 'Ubetalt ordre annulleret: ikke betalt inden for %d minutter.', $minutes );
			if ( self::cancel_if_unpaid( (int) $order_id, $note, 0 ) && ++$cancelled >= $limit ) {
				break;
			}
		}

		return $cancelled;
	}

	/**
	 * Run cancel_unpaid_orders() at most every five minutes from API requests.
	 */
	public static function maybe_cancel_unpaid_orders(): void {
		if ( time() - (int) get_option( 'wchc_unpaid_cleanup_last_run', 0 ) < 5 * MINUTE_IN_SECONDS ) {
			return;
		}
		self::cancel_unpaid_orders();
	}

	/**
	 * WooCommerce reschedules its "cancel unpaid orders" action each time it runs; if that
	 * chain ever breaks, put it back (only when the shop has a hold time and manages stock).
	 */
	private static function ensure_core_cleanup_scheduled(): void {
		$hold = (int) get_option( 'woocommerce_hold_stock_minutes', 0 );
		if ( $hold < 1 || 'yes' !== get_option( 'woocommerce_manage_stock' ) || ! function_exists( 'as_has_scheduled_action' ) ) {
			return;
		}
		if ( ! as_has_scheduled_action( 'woocommerce_cancel_unpaid_orders' ) && ! wp_next_scheduled( 'woocommerce_cancel_unpaid_orders' ) ) {
			as_schedule_single_action( time() + $hold * MINUTE_IN_SECONDS, 'woocommerce_cancel_unpaid_orders', array(), 'woocommerce', true );
		}
	}

	/**
	 * Load an order bypassing this request's in-memory caches.
	 *
	 * Call after acquiring a lock: the order (and its meta, e.g. the "stock reduced" flag)
	 * may have been loaded before another request changed it, and acting on that stale copy
	 * would e.g. run payment_complete() twice.
	 *
	 * @param int $order_id Order ID.
	 */
	public static function load_fresh( int $order_id ): ?WC_Order {
		self::flush_runtime_cache( $order_id );
		$order = wc_get_order( $order_id );
		return $order instanceof WC_Order ? $order : null;
	}

	/**
	 * Drop runtime-cached order data.
	 *
	 * @param int $order_id Order ID (0 = only flush the runtime cache).
	 */
	public static function flush_runtime_cache( int $order_id = 0 ): void {
		if ( function_exists( 'wp_cache_flush_runtime' ) && wp_cache_supports( 'flush_runtime' ) ) {
			wp_cache_flush_runtime();
		}
		if ( $order_id > 0 ) {
			clean_post_cache( $order_id );
			wp_cache_delete( $order_id, 'post_meta' );
			if ( OrderUtil::custom_orders_table_usage_is_enabled() && class_exists( \Automattic\WooCommerce\Caches\OrderCache::class ) ) {
				wc_get_container()->get( \Automattic\WooCommerce\Caches\OrderCache::class )->remove( $order_id );
			}
		}
	}

	/**
	 * Find the order that belongs to a checkout session.
	 *
	 * @param string $checkout_id Checkout session ID.
	 */
	public static function find_by_checkout_id( string $checkout_id ): ?WC_Order {
		global $wpdb;

		// Direct lookup: wc_get_orders() meta query arguments differ between HPOS and posts storage.
		if ( OrderUtil::custom_orders_table_usage_is_enabled() ) {
			$table    = OrdersTableDataStore::get_meta_table_name();
			$order_id = $wpdb->get_var(
				$wpdb->prepare( "SELECT order_id FROM {$table} WHERE meta_key = %s AND meta_value = %s ORDER BY order_id DESC LIMIT 1", WCHC_META_CHECKOUT_ID, $checkout_id ) // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			);
		} else {
			$order_id = $wpdb->get_var(
				$wpdb->prepare(
					"SELECT pm.post_id FROM {$wpdb->postmeta} pm INNER JOIN {$wpdb->posts} p ON p.ID = pm.post_id AND p.post_type = 'shop_order' WHERE pm.meta_key = %s AND pm.meta_value = %s ORDER BY pm.post_id DESC LIMIT 1",
					WCHC_META_CHECKOUT_ID,
					$checkout_id
				)
			);
		}

		$order = $order_id ? self::load_fresh( (int) $order_id ) : null;

		return $order instanceof WC_Order && hash_equals( (string) $order->get_meta( WCHC_META_CHECKOUT_ID ), $checkout_id ) ? $order : null;
	}

	/**
	 * Create, resume or replay the pending order for a checkout session.
	 *
	 * Must be called while holding the checkout lock.
	 *
	 * @param array $input Validated input.
	 * @return array{status:int,body:array<string,mixed>}
	 */
	public static function create_or_resume( array $input ): array {
		$checkout_id = $input['checkout_id'];
		$existing    = self::find_by_checkout_id( $checkout_id );

		if ( $existing && $existing->has_status( array( 'pending', 'failed' ) ) && self::is_stale( $existing ) ) {
			// Too old to resume: cancel it (releasing its stock hold) so the customer gets a new
			// order with a current number and date.
			self::cancel_if_unpaid(
				$existing->get_id(),
				sprintf( 'Ubetalt ordre annulleret: kunden startede en ny betaling efter mere end %d minutter.', self::unpaid_order_minutes() ),
				10
			);
			$existing = self::load_fresh( $existing->get_id() );
		}

		// Paid, or reserved: is_paid() counts processing, where a reserved order waits to be sent, and
		// on-hold holds a payment being confirmed or a reserved order the shop holds. Never paid twice.
		if ( $existing && ( $existing->is_paid() || $existing->has_status( 'on-hold' ) ) ) {
			return self::response(
				409,
				array(
					'code'    => 'already_paid',
					'message' => 'Ordren er allerede betalt eller reserveret.',
					'order'   => self::summary( $existing ),
				)
			);
		}

		$resumable    = $existing && $existing->has_status( array( 'pending', 'failed' ) );
		$own_order_id = $resumable ? $existing->get_id() : 0;

		$builder = new WCHC_Cart_Builder();
		$builder->build(
			$input['items'],
			array_merge( $input['shipping'], array( 'email' => $input['billing']['email'] ) ),
			$input['shipping_rate_id'],
			$own_order_id,
			$input['coupons'],
			$input['store_id']
		);

		if ( $resumable && WC()->cart->get_applied_coupons() ) {
			// The order's own coupon holds would otherwise count as another customer's usage
			// below and when WooCommerce holds the coupons again for this order.
			wc_release_coupons_for_order( $existing );
		}
		$builder->enforce_guest_coupon_limits( $input['billing']['email'] );
		$quote = $builder->to_quote();

		if ( WC()->cart->is_empty() || ! empty( $quote['errors'] ) ) {
			return self::response(
				422,
				array(
					'code'    => 'cart_invalid',
					'message' => 'Kurven kunne ikke valideres.',
					'quote'   => $quote,
				)
			);
		}

		if ( WC()->cart->needs_shipping() && $quote['shipping_rate_id'] !== $input['shipping_rate_id'] ) {
			return self::response(
				422,
				array(
					'code'    => 'shipping_rate_unavailable',
					'message' => 'Den valgte fragtmetode er ikke tilgængelig for adressen.',
					'quote'   => $quote,
				)
			);
		}

		if ( ! empty( $quote['coupon_errors'] ) ) {
			return self::response(
				409,
				array(
					'code'    => 'coupon_invalid',
					'message' => $quote['coupon_errors'][0]['message'],
					'quote'   => $quote,
				)
			);
		}

		// The customer must have seen exactly the total WooCommerce calculates now.
		if ( abs( (float) $quote['totals']['total'] - (float) $input['expected_total'] ) > 0.000001 ) {
			return self::response(
				409,
				array(
					'code'    => 'total_changed',
					'message' => 'Priser, moms eller fragt er ændret. Kontrollér den nye total.',
					'quote'   => $quote,
				)
			);
		}

		$applied_coupons = array_map( 'wc_strtolower', WC()->cart->get_applied_coupons() );
		sort( $applied_coupons );
		$fingerprint_data = array(
			$quote['cart_hash'],
			$input['billing'],
			$input['shipping'],
			$input['shipping_rate_id'],
			$input['store_id'],
			$input['customer_note'],
			$applied_coupons,
		);
		if ( $input['store'] ) {
			// Only when sent, so orders from storefronts without it keep their fingerprint.
			$fingerprint_data[] = $input['store'];
		}
		$fingerprint = hash( 'sha256', (string) wp_json_encode( $fingerprint_data ) );

		// Exact replay (double click, network retry): extend the stock hold and return the same order.
		if ( $resumable && hash_equals( (string) $existing->get_meta( WCHC_META_FINGERPRINT ), $fingerprint ) ) {
			if ( WC()->cart->get_applied_coupons() ) {
				try {
					$existing->hold_applied_coupons( $input['billing']['email'] );
					$existing->save_meta_data(); // Core only sets the hold keys; create_order() would save them.
				} catch ( Exception $e ) {
					wc_release_coupons_for_order( $existing );
					return self::coupon_unavailable( $e->getMessage(), $quote );
				}
			}
			if ( ! self::has_fresh_reservation( $existing ) ) {
				try {
					wc_reserve_stock_for_order( $existing );
				} catch ( ReserveStockException $e ) {
					return self::stock_error( $e, $quote );
				}
			}
			return self::response( 200, array( 'result' => 'existing', 'order' => self::summary( $existing ), 'quote' => $quote ) );
		}

		if ( $resumable ) {
			// Let WooCommerce resume (rebuild) this pending order instead of creating a second one.
			// Drop the old stock hold first: lines may have been removed from the cart.
			wc_release_stock_for_order( $existing );
			$existing->set_cart_hash( $quote['cart_hash'] );
			$existing->save();
			WC()->session->set( 'order_awaiting_payment', $existing->get_id() );
		} else {
			WC()->session->set( 'order_awaiting_payment', 0 );
		}

		$data = array( 'payment_method' => WCHC_PAYMENT_METHOD_ID );
		foreach ( array( 'billing', 'shipping' ) as $type ) {
			foreach ( $input[ $type ] as $field => $value ) {
				$data[ "{$type}_{$field}" ] = $value;
			}
		}
		$data['order_comments'] = $input['customer_note'];

		// Core holds coupons before this hook runs and reserves stock after the order is saved,
		// so whether the hook ran tells a coupon failure from a stock failure.
		$before_save = true;
		$set_meta    = static function ( WC_Order $order ) use ( $input, $fingerprint, &$before_save ) {
			$before_save = false;
			$order->update_meta_data( WCHC_META_CHECKOUT_ID, $input['checkout_id'] );
			$order->update_meta_data( WCHC_META_FINGERPRINT, $fingerprint );
			$order->update_meta_data( WCHC_META_STORE_ID, $input['store_id'] );
			if ( $input['store'] ) {
				$order->update_meta_data( WCHC_META_STORE_BRANDING, $input['store'] );
			} else {
				$order->delete_meta_data( WCHC_META_STORE_BRANDING );
			}
			$order->set_payment_method_title( $input['payment_method_title'] );
			if ( ! empty( $input['customer_ip'] ) ) {
				$order->set_customer_ip_address( $input['customer_ip'] );
			}
			if ( ! empty( $input['customer_user_agent'] ) ) {
				$order->set_customer_user_agent( $input['customer_user_agent'] );
			}
		};
		add_action( 'woocommerce_checkout_create_order', $set_meta );
		$order_id = WC()->checkout()->create_order( $data );
		remove_action( 'woocommerce_checkout_create_order', $set_meta );

		if ( is_wp_error( $order_id ) ) {
			// Failing before the order was saved with coupons applied means a usage-limited coupon
			// was used up meanwhile; otherwise stock reservation failed.
			$coupon_failure = $before_save && WC()->cart->get_applied_coupons();

			// A new order may have been saved, or a resumed one emptied, before the failure;
			// never leave it payable.
			$failed = self::find_by_checkout_id( $checkout_id );
			if ( $failed && $failed->has_status( array( 'pending', 'failed' ) ) ) {
				self::cancel_if_unpaid(
					$failed->get_id(),
					( $coupon_failure ? 'Rabatkoden kunne ikke reserveres: ' : 'Lager kunne ikke reserveres: ' ) . $order_id->get_error_message(),
					10
				);
			}

			if ( $coupon_failure ) {
				return self::coupon_unavailable( $order_id->get_error_message(), $quote );
			}
			return self::response(
				409,
				array(
					'code'    => 'out_of_stock',
					'message' => $order_id->get_error_message(),
					'quote'   => $quote,
				)
			);
		}

		$order = wc_get_order( $order_id );
		if ( ! $order ) {
			return self::response( 500, array( 'code' => 'order_not_saved', 'message' => 'Ordren kunne ikke gemmes.' ) );
		}

		if ( $existing && $existing->get_id() !== $order->get_id() ) {
			// The previous order was cancelled/expired: detach it from this checkout session.
			$existing->delete_meta_data( WCHC_META_CHECKOUT_ID );
			$existing->update_meta_data( '_wchc_replaced_by', $order->get_id() );
			$existing->save();
		}

		$order->add_order_note( sprintf( 'Ordre oprettet via headless checkout (butik: %s).', $input['store_id'] ) );

		return self::response(
			201,
			array(
				'result'                     => $resumable ? 'resumed' : 'created',
				'order'                      => self::summary( $order ),
				'previous_payment_intent_id' => $existing && $existing->get_id() !== $order->get_id()
					? ( $existing->get_meta( WCHC_META_PAYMENT_INTENT ) ?: null )
					: null,
				'quote'                      => $quote,
			)
		);
	}

	/**
	 * Attach a Stripe PaymentIntent to an order (compare-and-set).
	 *
	 * Must be called while holding the order lock.
	 *
	 * @param WC_Order    $order       Order.
	 * @param string      $intent_id   New PaymentIntent ID.
	 * @param string|null $previous_id PaymentIntent ID the caller believes is attached.
	 * @return array{status:int,body:array<string,mixed>}
	 */
	public static function attach_payment_intent( WC_Order $order, string $intent_id, ?string $previous_id ): array {
		if ( ! $order->has_status( array( 'pending', 'failed' ) ) ) {
			return self::response( 409, array( 'code' => 'not_payable', 'message' => 'Ordren afventer ikke betaling.', 'order' => self::summary( $order ) ) );
		}

		$current = (string) $order->get_meta( WCHC_META_PAYMENT_INTENT );
		if ( $current === $intent_id ) {
			return self::response( 200, array( 'result' => 'unchanged', 'order' => self::summary( $order ) ) );
		}
		if ( '' !== $current && $current !== (string) $previous_id ) {
			return self::response(
				409,
				array(
					'code'              => 'payment_intent_exists',
					'message'           => 'Ordren har allerede en betaling tilknyttet.',
					'payment_intent_id' => $current,
					'order'             => self::summary( $order ),
				)
			);
		}

		$history   = (array) $order->get_meta( WCHC_META_PAYMENT_INTENT_HISTORY );
		$history[] = $intent_id;
		$order->update_meta_data( WCHC_META_PAYMENT_INTENT, $intent_id );
		$order->update_meta_data( WCHC_META_PAYMENT_INTENT_HISTORY, array_values( array_unique( $history ) ) );
		$order->save();
		$order->add_order_note( sprintf( 'Stripe PaymentIntent %s tilknyttet.', $intent_id ) );

		return self::response( 200, array( 'result' => 'attached', 'order' => self::summary( $order ) ) );
	}

	/**
	 * Apply a verified Stripe payment event to the order.
	 *
	 * Must be called while holding the order lock. Every transition is idempotent.
	 *
	 * @param WC_Order $order Order.
	 * @param array    $input event, payment_intent_id, amount_minor, currency, currency_exponent, message.
	 * @return array{status:int,body:array<string,mixed>}
	 */
	public static function apply_payment_event( WC_Order $order, array $input ): array {
		$intent_id = $input['payment_intent_id'];
		$event     = $input['event'];
		$current   = (string) $order->get_meta( WCHC_META_PAYMENT_INTENT );
		$history   = (array) $order->get_meta( WCHC_META_PAYMENT_INTENT_HISTORY );

		if ( ! in_array( $intent_id, $history, true ) && $current !== $intent_id ) {
			return self::response( 409, array( 'code' => 'payment_intent_unknown', 'message' => 'Ukendt betaling for ordren.' ) );
		}

		if ( 'succeeded' === $event ) {
			return self::handle_succeeded( $order, $input, $current );
		}

		if ( 'authorized' === $event ) {
			return WCHC_Capture::authorize( $order, $input, $current );
		}

		if ( $current !== $intent_id ) {
			// Events for a superseded PaymentIntent (e.g. one we cancelled) do not affect the order.
			return self::result( 'ignored', $order );
		}

		if ( '' !== WCHC_Capture::status( $order ) ) {
			// The payment was authorized (processing, or on-hold): its release, expiry or a failed capture.
			return WCHC_Capture::apply_event( $order, $input );
		}

		switch ( $event ) {
			case 'processing':
				if ( $order->has_status( array( 'pending', 'failed' ) ) ) {
					self::set_payment_method_title( $order, $input );
					// On-hold reduces stock in core and releases the temporary hold. Processing once it is
					// authorized (WCHC_Capture::authorize(), which knows the hold by this meta), cancelled if
					// it fails.
					$order->update_meta_data( WCHC_META_PAYMENT_PROCESSING, $intent_id );
					$order->update_status( 'on-hold', 'Betalingen behandles af Stripe og afventer bekræftelse.' );
					return self::result( 'on_hold', $order );
				}
				return self::result( 'ignored', $order );

			case 'failed':
				$message = $input['message'] ? ': ' . $input['message'] : '';
				if ( $order->has_status( 'on-hold' ) ) {
					// Asynchronous payment failed after stock was reduced: cancelling restores stock in core.
					$order->update_status( 'cancelled', 'Betalingen mislykkedes' . $message );
					return self::result( 'cancelled', $order );
				}
				if ( $order->has_status( array( 'pending', 'failed' ) ) ) {
					// Keep the order pending so the customer can retry with the same PaymentIntent.
					// The webhook and the storefront may both report the same attempt: note it once.
					$attempt = '' !== $input['attempt_id'] ? $input['attempt_id'] : $intent_id . '|' . $input['message'];
					$seen    = (array) $order->get_meta( WCHC_META_FAILED_ATTEMPTS );
					if ( ! in_array( $attempt, $seen, true ) ) {
						$seen[] = $attempt;
						$order->update_meta_data( WCHC_META_FAILED_ATTEMPTS, array_slice( $seen, -20 ) );
						$order->save();
						$order->add_order_note( 'Betalingsforsøg afvist' . $message );
					}
					return self::result( 'payment_failed', $order );
				}
				return self::result( 'ignored', $order );

			case 'canceled':
				if ( $order->has_status( array( 'pending', 'failed', 'on-hold' ) ) ) {
					$order->update_status( 'cancelled', 'Betalingen blev annulleret i Stripe.' );
					return self::result( 'cancelled', $order );
				}
				return self::result( 'ignored', $order );
		}

		return self::response( 400, array( 'code' => 'invalid_event', 'message' => 'Ukendt hændelse.' ) );
	}

	/**
	 * Handle a succeeded payment.
	 *
	 * @param WC_Order $order   Order.
	 * @param array    $input   Event input.
	 * @param string   $current Currently attached PaymentIntent.
	 * @return array{status:int,body:array<string,mixed>}
	 */
	private static function handle_succeeded( WC_Order $order, array $input, string $current ): array {
		$intent_id = $input['payment_intent_id'];

		if ( $current === $intent_id && '' !== WCHC_Capture::status( $order ) ) {
			// The authorized payment was captured (when the order was sent, or in Stripe).
			return WCHC_Capture::record_capture( $order, $input );
		}

		// is_paid(): also processing, where an order reserved by another payment waits to be sent.
		if ( $order->is_paid() || $order->has_status( array( 'completed', 'refunded' ) ) ) {
			if ( $order->get_transaction_id() === $intent_id ) {
				return self::result( 'already_paid', $order );
			}
			// Money received twice for the same order: never keep it.
			$order->add_order_note( sprintf( 'Ekstra betaling %s modtaget for en ordre, der allerede er betalt eller reserveret – refunderes.', $intent_id ) );
			return self::result( 'refund_required', $order );
		}

		if ( $current !== $intent_id ) {
			$order->add_order_note( sprintf( 'Betaling %s modtaget for en erstattet betaling – refunderes.', $intent_id ) );
			return self::result( 'refund_required', $order );
		}

		$exponent       = (int) $input['currency_exponent'];
		$expected_minor = (int) round( (float) $order->get_total() * pow( 10, $exponent ) );
		if ( strtolower( $order->get_currency() ) !== strtolower( $input['currency'] ) || $expected_minor !== (int) $input['amount_minor'] ) {
			$order->add_order_note(
				sprintf(
					'ADVARSEL: Stripe-beløb (%d %s) matcher ikke ordretotalen (%d %s). Kræver manuel kontrol.',
					(int) $input['amount_minor'],
					strtoupper( $input['currency'] ),
					$expected_minor,
					$order->get_currency()
				)
			);
			return self::response( 409, array( 'code' => 'amount_mismatch', 'message' => 'Beløbet matcher ikke ordren.', 'order' => self::summary( $order ) ) );
		}

		// If the stock hold expired (or the order was cancelled) before the money arrived, the
		// items may have been sold to someone else. Never oversell: refund instead.
		if ( $order->has_status( array( 'pending', 'failed', 'cancelled' ) ) && ! self::stock_available_for( $order ) ) {
			$order->update_meta_data( WCHC_META_REFUND_REQUIRED, $intent_id );
			$order->save();
			if ( $order->has_status( 'cancelled' ) ) {
				$order->add_order_note( sprintf( 'Betaling %s modtaget efter annullering, men varerne er ikke længere på lager – refunderes.', $intent_id ) );
			} else {
				$order->update_status( 'cancelled', sprintf( 'Betaling %s modtaget, men varerne er ikke længere på lager – refunderes.', $intent_id ) );
			}
			return self::result( 'refund_required', $order );
		}

		if ( $order->has_status( 'cancelled' ) ) {
			$order->add_order_note( 'Betaling modtaget efter at ordren var annulleret. Varerne er stadig på lager – ordren genåbnes.' );
		}

		if ( ! $order->has_status( array( 'pending', 'failed', 'on-hold', 'cancelled' ) ) ) {
			return self::result( 'ignored', $order );
		}

		self::set_payment_method_title( $order, $input );
		// Core: sets transaction ID + paid date, reduces stock once, releases the hold, sends emails.
		$order->payment_complete( $intent_id );
		$order->add_order_note( sprintf( 'Betaling gennemført via Stripe (%s).', $intent_id ) );

		return self::result( 'paid', wc_get_order( $order->get_id() ) );
	}

	/**
	 * Show the payment method the customer actually used (e.g. "MobilePay (Stripe)") on the
	 * order. Saved by the caller's status change.
	 *
	 * @param WC_Order $order Order.
	 * @param array    $input Event input.
	 */
	public static function set_payment_method_title( WC_Order $order, array $input ): void {
		if ( '' !== $input['payment_method_title'] ) {
			$order->set_payment_method_title( $input['payment_method_title'] );
		}
	}

	/**
	 * Whether the order's stock hold was (re)applied within the last minute and is still valid.
	 *
	 * Re-reserving within the same second makes MySQL report 0 affected rows for the
	 * ON DUPLICATE KEY UPDATE in core's ReserveStock, which core treats as "not enough
	 * stock" (and then releases the hold). A fresh hold needs no extension anyway.
	 *
	 * @param WC_Order $order Order.
	 */
	private static function has_fresh_reservation( WC_Order $order ): bool {
		global $wpdb;

		$fresh = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$wpdb->wc_reserved_stock} WHERE order_id = %d AND `timestamp` > ( NOW() - INTERVAL 60 SECOND ) AND expires > NOW()",
				$order->get_id()
			)
		);

		return $fresh > 0;
	}

	/**
	 * Whether every stock-managed line in a (cancelled) order can still be fulfilled.
	 *
	 * @param WC_Order $order Order.
	 */
	public static function stock_available_for( WC_Order $order ): bool {
		$needed = array();
		foreach ( $order->get_items() as $item ) {
			/** @var WC_Order_Item_Product $item */ // phpcs:ignore Generic.Commenting.DocComment.MissingShort
			$product = $item->get_product();
			if ( ! $product || ! $product->is_in_stock() ) {
				return false;
			}
			if ( ! $product->managing_stock() || $product->backorders_allowed() ) {
				continue;
			}
			$id            = $product->get_stock_managed_by_id();
			$needed[ $id ] = ( $needed[ $id ] ?? 0 ) + $item->get_quantity();
		}

		foreach ( $needed as $product_id => $qty ) {
			$product   = wc_get_product( $product_id );
			$available = (int) $product->get_stock_quantity() - (int) wc_get_held_stock_quantity( $product, $order->get_id() );
			if ( $available < $qty ) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Public, non-sensitive order summary.
	 *
	 * @param WC_Order $order Order.
	 * @return array<string,mixed>
	 */
	public static function summary( WC_Order $order ): array {
		$decimals = wc_get_price_decimals();
		$items    = array();
		foreach ( $order->get_items() as $item ) {
			/** @var WC_Order_Item_Product $item */ // phpcs:ignore Generic.Commenting.DocComment.MissingShort
			$items[] = array(
				'product_id'   => $item->get_product_id(),
				'variation_id' => $item->get_variation_id(),
				'name'         => $item->get_name(),
				'quantity'     => $item->get_quantity(),
				'total'        => wc_format_decimal( (float) $item->get_total() + (float) $item->get_total_tax(), $decimals ),
			);
		}

		return array(
			'id'                => $order->get_id(),
			'number'            => (string) $order->get_order_number(),
			'order_key'         => $order->get_order_key(),
			'status'            => $order->get_status(),
			'currency'          => $order->get_currency(),
			'total'             => wc_format_decimal( $order->get_total(), $decimals ),
			'total_tax'         => wc_format_decimal( $order->get_total_tax(), $decimals ),
			'shipping_total'    => wc_format_decimal( (float) $order->get_shipping_total() + (float) $order->get_shipping_tax(), $decimals ),
			'needs_payment'     => $order->needs_payment(),
			'payment_intent_id' => $order->get_meta( WCHC_META_PAYMENT_INTENT ) ?: null,
			'email'             => $order->get_billing_email(),
			'items'             => $items,
			// Since 1.5: the authorized payment and what to capture; null for orders paid at once.
			'capture'           => WCHC_Capture::summary( $order ),
		);
	}

	/**
	 * Build a result response.
	 *
	 * @param string   $result Result code.
	 * @param WC_Order $order  Order.
	 * @return array{status:int,body:array<string,mixed>}
	 */
	public static function result( string $result, WC_Order $order ): array {
		return self::response( 200, array( 'result' => $result, 'order' => self::summary( $order ) ) );
	}

	/**
	 * A coupon could not be held for this order (its usage limit was reached meanwhile).
	 *
	 * @param string $message WooCommerce's message.
	 * @param array  $quote   Quote.
	 * @return array{status:int,body:array<string,mixed>}
	 */
	private static function coupon_unavailable( string $message, array $quote ): array {
		return self::response( 409, array( 'code' => 'coupon_unavailable', 'message' => wp_strip_all_tags( $message ), 'quote' => $quote ) );
	}

	/**
	 * Stock reservation error response.
	 *
	 * @param ReserveStockException $e     Exception.
	 * @param array                 $quote Quote.
	 * @return array{status:int,body:array<string,mixed>}
	 */
	private static function stock_error( ReserveStockException $e, array $quote ): array {
		return self::response( 409, array( 'code' => 'out_of_stock', 'message' => wp_strip_all_tags( $e->getMessage() ), 'quote' => $quote ) );
	}

	/**
	 * Response tuple.
	 *
	 * @param int   $status HTTP status.
	 * @param array $body   Body.
	 * @return array{status:int,body:array<string,mixed>}
	 */
	public static function response( int $status, array $body ): array {
		return array(
			'status' => $status,
			'body'   => $body,
		);
	}
}
