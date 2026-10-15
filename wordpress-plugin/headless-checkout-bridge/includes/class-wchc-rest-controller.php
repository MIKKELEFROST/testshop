<?php
/**
 * REST routes under /wp-json/wc-headless/v1.
 *
 * The "wc-" namespace prefix makes WooCommerce's REST authentication (consumer key /
 * secret) apply. Every route requires a key with read_write permissions belonging to a
 * user who can manage WooCommerce. These routes are meant to be called server-to-server
 * only — never from a browser.
 *
 * @package HeadlessCheckoutBridge
 */

defined( 'ABSPATH' ) || exit;

/**
 * REST controller.
 */
final class WCHC_REST_Controller {

	const NAMESPACE = 'wc-headless/v1';

	/**
	 * Register routes.
	 */
	public function register_routes(): void {
		register_rest_route(
			self::NAMESPACE,
			'/status',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'status' ),
				'permission_callback' => array( $this, 'permission' ),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/quote',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'quote' ),
				'permission_callback' => array( $this, 'permission' ),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/orders',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'create_order' ),
				'permission_callback' => array( $this, 'permission' ),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/orders/(?P<id>\d+)/payment-intent',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'attach_payment_intent' ),
				'permission_callback' => array( $this, 'permission' ),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/orders/(?P<id>\d+)/payment',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'payment_event' ),
				'permission_callback' => array( $this, 'permission' ),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/shops',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'list_shops' ),
				'permission_callback' => array( $this, 'permission' ),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/shops/(?P<slug>' . WCHC_Shops::SLUG_PATTERN . ')',
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'callback'            => array( $this, 'save_shop' ),
				'permission_callback' => array( $this, 'permission' ),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/orders/(?P<id>\d+)',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_order' ),
				'permission_callback' => array( $this, 'permission' ),
			)
		);
	}

	/**
	 * Only authenticated shop managers (via WooCommerce API keys) may call these routes.
	 *
	 * @return true|WP_Error
	 */
	public function permission() {
		if ( current_user_can( 'manage_woocommerce' ) ) {
			return true;
		}
		return new WP_Error( 'wchc_forbidden', 'Forbidden.', array( 'status' => rest_authorization_required_code() ) );
	}

	/**
	 * Health / version check.
	 */
	public function status(): WP_REST_Response {
		return new WP_REST_Response(
			array(
				'plugin'             => 'headless-checkout-bridge',
				'version'            => WCHC_VERSION,
				'woocommerce'        => WC()->version,
				'currency'           => get_woocommerce_currency(),
				'prices_include_tax' => wc_prices_include_tax(),
				'calc_taxes'         => wc_tax_enabled(),
				'manage_stock'       => 'yes' === get_option( 'woocommerce_manage_stock' ),
				'hold_stock_minutes' => (int) get_option( 'woocommerce_hold_stock_minutes', 0 ),
				'coupons_enabled'    => wc_coupons_enabled(),
				'shops'              => WCHC_Shops::all(),
				'unpaid_orders'      => array(
					'cancel_after_minutes' => WCHC_Orders::unpaid_order_minutes(),
					'last_cleanup'         => $this->iso_time( (int) get_option( 'wchc_unpaid_cleanup_last_run', 0 ) ),
					'next_cleanup'         => $this->iso_time( (int) wp_next_scheduled( WCHC_CLEANUP_HOOK ) ),
					'wp_cron_disabled'     => defined( 'DISABLE_WP_CRON' ) && DISABLE_WP_CRON,
				),
			)
		);
	}

	/**
	 * Webshops and their number of published products.
	 */
	public function list_shops(): WP_REST_Response {
		return new WP_REST_Response( WCHC_Shops::all(), 200 );
	}

	/**
	 * Create a webshop (slug = the storefront's store ID) or rename it.
	 *
	 * @param WP_REST_Request $request Request.
	 */
	public function save_shop( WP_REST_Request $request ): WP_REST_Response {
		$body = (array) $request->get_json_params();
		$slug = (string) $request['slug'];
		$name = isset( $body['name'] ) ? sanitize_text_field( substr( (string) $body['name'], 0, 100 ) ) : '';
		if ( sanitize_key( $slug ) !== $slug || '' === $name ) {
			return $this->error( new WP_Error( 'invalid_webshop', 'Ugyldigt butiks-ID eller navn.' ), 400 );
		}
		$result = WCHC_Shops::upsert( $slug, $name );
		return is_wp_error( $result ) ? $this->error( $result ) : new WP_REST_Response( $result, 200 );
	}

	/**
	 * Unix timestamp as ISO 8601 (UTC), or null.
	 *
	 * @param int $timestamp Timestamp.
	 */
	private function iso_time( int $timestamp ): ?string {
		return $timestamp > 0 ? gmdate( DATE_ATOM, $timestamp ) : null;
	}

	/**
	 * Authoritative quote: prices, stock, tax and shipping calculated by WooCommerce. Creates nothing.
	 *
	 * @param WP_REST_Request $request Request.
	 */
	public function quote( WP_REST_Request $request ): WP_REST_Response {
		$body  = (array) $request->get_json_params();
		$items = $this->parse_items( $body['items'] ?? null );
		if ( is_wp_error( $items ) ) {
			return $this->error( $items );
		}

		$address          = $this->parse_address( (array) ( $body['address'] ?? array() ), false );
		$address['email'] = isset( $body['email'] ) && is_email( (string) $body['email'] ) ? sanitize_email( (string) $body['email'] ) : '';
		$rate             = $this->parse_rate_id( $body['shipping_rate_id'] ?? null );

		$own_order_id = 0;
		if ( ! empty( $body['checkout_id'] ) && $this->valid_checkout_id( $body['checkout_id'] ) ) {
			$existing = WCHC_Orders::find_by_checkout_id( (string) $body['checkout_id'] );
			if ( $existing && $existing->has_status( array( 'pending', 'failed' ) ) ) {
				$own_order_id = $existing->get_id();
			}
		}

		$store_id = isset( $body['store_id'] ) ? sanitize_key( (string) $body['store_id'] ) : '';

		$builder = new WCHC_Cart_Builder();
		$builder->build( $items, $address, $rate, $own_order_id, $this->parse_coupons( $body['coupons'] ?? array() ), $store_id );
		$quote = $builder->to_quote();

		WCHC_Orders::maybe_cancel_unpaid_orders();

		return new WP_REST_Response( $quote, 200 );
	}

	/**
	 * Create (or idempotently replay / resume) the pending order for a checkout session.
	 *
	 * @param WP_REST_Request $request Request.
	 */
	public function create_order( WP_REST_Request $request ): WP_REST_Response {
		$body = (array) $request->get_json_params();

		if ( ! $this->valid_checkout_id( $body['checkout_id'] ?? '' ) ) {
			return $this->error( new WP_Error( 'invalid_checkout_id', 'Ugyldigt checkout-ID.' ), 400 );
		}

		$items = $this->parse_items( $body['items'] ?? null );
		if ( is_wp_error( $items ) ) {
			return $this->error( $items );
		}

		$billing  = $this->parse_address( (array) ( $body['billing'] ?? array() ), true );
		$shipping = $this->parse_address( (array) ( $body['shipping'] ?? array() ), true );
		if ( ! is_email( $billing['email'] ?? '' ) ) {
			return $this->error( new WP_Error( 'invalid_email', 'Ugyldig e-mail.' ), 400 );
		}
		foreach ( array( 'first_name', 'last_name', 'address_1', 'postcode', 'city', 'country' ) as $required ) {
			if ( '' === $shipping[ $required ] || '' === $billing[ $required ] ) {
				return $this->error( new WP_Error( 'invalid_address', 'Adressen er ufuldstændig.' ), 400 );
			}
		}

		$expected_total = isset( $body['expected_total'] ) ? (string) $body['expected_total'] : '';
		if ( ! preg_match( '/^\d{1,9}(\.\d{1,4})?$/', $expected_total ) ) {
			return $this->error( new WP_Error( 'invalid_expected_total', 'Ugyldig forventet total.' ), 400 );
		}

		$store_id = isset( $body['store_id'] ) ? sanitize_key( (string) $body['store_id'] ) : '';
		if ( '' === $store_id ) {
			return $this->error( new WP_Error( 'invalid_store_id', 'Mangler butiks-ID.' ), 400 );
		}

		$input = array(
			'checkout_id'          => (string) $body['checkout_id'],
			'items'                => $items,
			'billing'              => $billing,
			'shipping'             => array_diff_key( $shipping, array( 'email' => true ) ),
			'shipping_rate_id'     => $this->parse_rate_id( $body['shipping_rate_id'] ?? null ),
			'expected_total'       => $expected_total,
			'store_id'             => $store_id,
			'customer_note'        => isset( $body['customer_note'] ) ? sanitize_textarea_field( substr( (string) $body['customer_note'], 0, 1000 ) ) : '',
			'payment_method_title' => isset( $body['payment_method_title'] ) ? sanitize_text_field( substr( (string) $body['payment_method_title'], 0, 100 ) ) : 'Stripe',
			'customer_ip'          => isset( $body['customer_ip'] ) && filter_var( $body['customer_ip'], FILTER_VALIDATE_IP ) ? (string) $body['customer_ip'] : '',
			'customer_user_agent'  => isset( $body['customer_user_agent'] ) ? sanitize_text_field( substr( (string) $body['customer_user_agent'], 0, 500 ) ) : '',
			'coupons'              => $this->parse_coupons( $body['coupons'] ?? array() ),
		);

		if ( ! WCHC_Lock::acquire( 'checkout:' . $input['checkout_id'], 15 ) ) {
			return $this->error( new WP_Error( 'busy', 'Checkout behandles allerede. Prøv igen.' ), 409 );
		}

		try {
			$result = WCHC_Orders::create_or_resume( $input );
		} finally {
			WCHC_Lock::release( 'checkout:' . $input['checkout_id'] );
		}

		WCHC_Orders::maybe_cancel_unpaid_orders();

		return new WP_REST_Response( $result['body'], $result['status'] );
	}

	/**
	 * Attach a PaymentIntent to an order.
	 *
	 * @param WP_REST_Request $request Request.
	 */
	public function attach_payment_intent( WP_REST_Request $request ): WP_REST_Response {
		$body      = (array) $request->get_json_params();
		$intent_id = (string) ( $body['payment_intent_id'] ?? '' );
		$previous  = isset( $body['previous_payment_intent_id'] ) ? (string) $body['previous_payment_intent_id'] : null;

		if ( ! $this->valid_intent_id( $intent_id ) || ( null !== $previous && ! $this->valid_intent_id( $previous ) ) ) {
			return $this->error( new WP_Error( 'invalid_payment_intent', 'Ugyldigt PaymentIntent-ID.' ), 400 );
		}

		return $this->with_order_lock(
			$request,
			static function ( WC_Order $order ) use ( $intent_id, $previous ) {
				return WCHC_Orders::attach_payment_intent( $order, $intent_id, $previous );
			}
		);
	}

	/**
	 * Apply a verified payment event (called by the storefront's Stripe webhook handler).
	 *
	 * @param WP_REST_Request $request Request.
	 */
	public function payment_event( WP_REST_Request $request ): WP_REST_Response {
		$body  = (array) $request->get_json_params();
		$input = array(
			'event'                => (string) ( $body['event'] ?? '' ),
			'payment_intent_id'    => (string) ( $body['payment_intent_id'] ?? '' ),
			'amount_minor'         => isset( $body['amount_minor'] ) ? (int) $body['amount_minor'] : -1,
			'currency'             => strtolower( (string) ( $body['currency'] ?? '' ) ),
			'currency_exponent'    => isset( $body['currency_exponent'] ) ? (int) $body['currency_exponent'] : 2,
			'message'              => isset( $body['message'] ) ? sanitize_text_field( substr( (string) $body['message'], 0, 300 ) ) : '',
			// Identifies one declined attempt (Stripe charge or payment method ID), so it is noted once.
			'attempt_id'           => isset( $body['attempt_id'] ) && preg_match( '/^[A-Za-z0-9_]{1,100}$/', (string) $body['attempt_id'] ) ? (string) $body['attempt_id'] : '',
			// The method actually used, e.g. "MobilePay (Stripe)".
			'payment_method_title' => isset( $body['payment_method_title'] ) ? sanitize_text_field( substr( (string) $body['payment_method_title'], 0, 100 ) ) : '',
		);

		if ( ! in_array( $input['event'], array( 'succeeded', 'processing', 'failed', 'canceled' ), true )
			|| ! $this->valid_intent_id( $input['payment_intent_id'] )
			|| ! preg_match( '/^[a-z]{3}$/', $input['currency'] )
			|| $input['currency_exponent'] < 0 || $input['currency_exponent'] > 3
			|| ( 'succeeded' === $input['event'] && $input['amount_minor'] < 0 ) ) {
			return $this->error( new WP_Error( 'invalid_payment_event', 'Ugyldig betalingshændelse.' ), 400 );
		}

		return $this->with_order_lock(
			$request,
			static function ( WC_Order $order ) use ( $input ) {
				return WCHC_Orders::apply_payment_event( $order, $input );
			}
		);
	}

	/**
	 * Order summary for the confirmation page. The order key acts as an access token.
	 *
	 * @param WP_REST_Request $request Request.
	 */
	public function get_order( WP_REST_Request $request ): WP_REST_Response {
		$order = $this->get_order_by_key( $request );
		if ( $order instanceof WP_REST_Response ) {
			return $order;
		}
		$summary = WCHC_Orders::summary( $order );

		$summary['shipping_address'] = array(
			'first_name' => $order->get_shipping_first_name(),
			'last_name'  => $order->get_shipping_last_name(),
			'address_1'  => $order->get_shipping_address_1(),
			'address_2'  => $order->get_shipping_address_2(),
			'postcode'   => $order->get_shipping_postcode(),
			'city'       => $order->get_shipping_city(),
			'country'    => $order->get_shipping_country(),
		);
		$summary['shipping_method'] = $order->get_shipping_method();
		$items_subtotal = 0.0;
		foreach ( $order->get_items() as $item ) {
			/** @var WC_Order_Item_Product $item */ // phpcs:ignore Generic.Commenting.DocComment.MissingShort
			$items_subtotal += (float) $item->get_subtotal() + (float) $item->get_subtotal_tax();
		}
		$summary['subtotal']        = wc_format_decimal( $items_subtotal, wc_get_price_decimals() );
		$summary['discount_total']  = wc_format_decimal( (float) $order->get_discount_total() + (float) $order->get_discount_tax(), wc_get_price_decimals() );
		$summary['date_paid']       = $order->get_date_paid() ? $order->get_date_paid()->date( DATE_ATOM ) : null;
		$summary['coupons']         = array_values( $order->get_coupon_codes() );

		return new WP_REST_Response( $summary, 200 );
	}

	/**
	 * Load an order, verify its key, take the order lock and run $callback.
	 *
	 * @param WP_REST_Request $request  Request.
	 * @param callable        $callback Receives the freshly loaded order.
	 */
	private function with_order_lock( WP_REST_Request $request, callable $callback ): WP_REST_Response {
		$order = $this->get_order_by_key( $request );
		if ( $order instanceof WP_REST_Response ) {
			return $order;
		}

		$lock = 'order:' . $order->get_id();
		if ( ! WCHC_Lock::acquire( $lock, 15 ) ) {
			return $this->error( new WP_Error( 'busy', 'Ordren behandles allerede. Prøv igen.' ), 409 );
		}

		try {
			// Re-read from the database after acquiring the lock so we act on the latest state.
			$order = WCHC_Orders::load_fresh( $order->get_id() );
			if ( ! $order ) {
				return $this->error( new WP_Error( 'order_not_found', 'Ordren blev ikke fundet.' ), 404 );
			}
			$result = $callback( $order );
		} finally {
			WCHC_Lock::release( $lock );
		}

		return new WP_REST_Response( $result['body'], $result['status'] );
	}

	/**
	 * Load a headless order by ID and verify the order key.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WC_Order|WP_REST_Response
	 */
	private function get_order_by_key( WP_REST_Request $request ) {
		$body  = (array) $request->get_json_params();
		$key   = (string) ( $body['order_key'] ?? $request->get_param( 'order_key' ) ?? '' );
		$order = wc_get_order( absint( $request['id'] ) );

		if ( ! $order instanceof WC_Order || '' === $key || ! hash_equals( $order->get_order_key(), $key ) ) {
			return $this->error( new WP_Error( 'order_not_found', 'Ordren blev ikke fundet.' ), 404 );
		}

		if ( ! $order->get_meta( WCHC_META_STORE_ID ) ) {
			return $this->error( new WP_Error( 'order_not_headless', 'Ordren er ikke oprettet via headless checkout.' ), 404 );
		}

		return $order;
	}

	/**
	 * Validate and normalise cart lines.
	 *
	 * @param mixed $raw Raw items.
	 * @return array|WP_Error
	 */
	private function parse_items( $raw ) {
		if ( ! is_array( $raw ) || empty( $raw ) || count( $raw ) > 50 ) {
			return new WP_Error( 'invalid_items', 'Kurven er tom eller ugyldig.', array( 'status' => 400 ) );
		}

		$merged = array();
		foreach ( $raw as $item ) {
			$product_id   = isset( $item['product_id'] ) ? absint( $item['product_id'] ) : 0;
			$variation_id = isset( $item['variation_id'] ) ? absint( $item['variation_id'] ) : 0;
			$quantity     = isset( $item['quantity'] ) ? (int) $item['quantity'] : 0;

			if ( $product_id < 1 || $quantity < 1 || $quantity > 999 ) {
				return new WP_Error( 'invalid_items', 'Ugyldig vare i kurven.', array( 'status' => 400 ) );
			}

			$key = $product_id . ':' . $variation_id;
			if ( isset( $merged[ $key ] ) ) {
				$merged[ $key ]['quantity'] += $quantity;
			} else {
				$merged[ $key ] = array(
					'product_id'   => $product_id,
					'variation_id' => $variation_id,
					'quantity'     => $quantity,
				);
			}
		}

		return array_values( $merged );
	}

	/**
	 * Validate coupon codes (WooCommerce checks whether they exist and apply).
	 *
	 * @param mixed $raw Raw codes.
	 * @return string[]
	 */
	private function parse_coupons( $raw ): array {
		if ( ! is_array( $raw ) ) {
			return array();
		}
		$codes = array();
		foreach ( array_slice( $raw, 0, 10 ) as $code ) {
			$code = is_string( $code ) ? wc_format_coupon_code( wc_sanitize_coupon_code( substr( $code, 0, 100 ) ) ) : '';
			if ( '' !== $code ) {
				$codes[ wc_strtolower( $code ) ] = $code;
			}
		}
		return array_values( $codes );
	}

	/**
	 * Sanitise an address.
	 *
	 * @param array $raw          Raw address.
	 * @param bool  $with_contact Include name, company, email, phone.
	 * @return array<string,string>
	 */
	private function parse_address( array $raw, bool $with_contact ): array {
		$fields = array( 'address_1', 'address_2', 'city', 'state', 'postcode', 'country' );
		if ( $with_contact ) {
			$fields = array_merge( array( 'first_name', 'last_name', 'company', 'email', 'phone' ), $fields );
		}

		$address = array();
		foreach ( $fields as $field ) {
			$value             = isset( $raw[ $field ] ) ? (string) $raw[ $field ] : '';
			$address[ $field ] = 'email' === $field ? sanitize_email( $value ) : sanitize_text_field( substr( $value, 0, 200 ) );
		}
		$address['country'] = strtoupper( $address['country'] ?: WC()->countries->get_base_country() );

		if ( ! array_key_exists( $address['country'], WC()->countries->get_shipping_countries() ) ) {
			$address['country'] = WC()->countries->get_base_country();
		}

		return $address;
	}

	/**
	 * Sanitise a shipping rate ID such as "flat_rate:3".
	 *
	 * @param mixed $raw Raw value.
	 */
	private function parse_rate_id( $raw ): ?string {
		if ( ! is_string( $raw ) || ! preg_match( '/^[a-z0-9_\-]+(:[a-z0-9_\-]+)*$/i', $raw ) ) {
			return null;
		}
		return $raw;
	}

	/**
	 * Checkout session IDs are opaque random tokens issued by the storefront.
	 *
	 * @param mixed $value Value.
	 */
	private function valid_checkout_id( $value ): bool {
		return is_string( $value ) && (bool) preg_match( '/^[A-Za-z0-9_\-]{16,64}$/', $value );
	}

	/**
	 * Stripe PaymentIntent ID format.
	 *
	 * @param string $value Value.
	 */
	private function valid_intent_id( string $value ): bool {
		return (bool) preg_match( '/^pi_[A-Za-z0-9]{8,64}$/', $value );
	}

	/**
	 * Error response.
	 *
	 * @param WP_Error $error  Error.
	 * @param int|null $status HTTP status.
	 */
	private function error( WP_Error $error, ?int $status = null ): WP_REST_Response {
		$data = $error->get_error_data();
		return new WP_REST_Response(
			array(
				'code'    => $error->get_error_code(),
				'message' => $error->get_error_message(),
			),
			$status ?? ( is_array( $data ) && isset( $data['status'] ) ? (int) $data['status'] : 400 )
		);
	}
}
