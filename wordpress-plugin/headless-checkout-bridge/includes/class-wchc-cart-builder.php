<?php
/**
 * Builds a real WooCommerce cart from a list of items and an address, so that prices,
 * stock (including stock held by other pending orders), taxes and shipping are all
 * calculated by WooCommerce itself.
 *
 * @package HeadlessCheckoutBridge
 */

defined( 'ABSPATH' ) || exit;

/**
 * Cart builder.
 */
final class WCHC_Cart_Builder {

	/**
	 * Validation errors collected while building the cart.
	 *
	 * @var array<int,array<string,mixed>>
	 */
	private $errors = array();

	/**
	 * Coupon codes that could not be applied, with WooCommerce's reason.
	 *
	 * @var array<int,array{code:string,message:string}>
	 */
	private $coupon_errors = array();

	/**
	 * Pending order of this checkout session whose own coupon holds must not count as "used".
	 *
	 * @var WC_Order|null
	 */
	private $own_order = null;

	/**
	 * Coupons the own order holds (coupon ID => true).
	 *
	 * @var array<int,bool>
	 */
	private $own_holds = array();

	/**
	 * Build the cart.
	 *
	 * @param array       $items             List of [product_id, variation_id, quantity].
	 * @param array       $address           Destination address (country, postcode, city, ..., optional email).
	 * @param string|null $shipping_rate_id  Requested shipping rate ID.
	 * @param int         $own_order_id      Pending order for this checkout; its own stock and coupon holds are ignored.
	 * @param string[]    $coupons           Coupon codes to apply.
	 */
	public function build( array $items, array $address, ?string $shipping_rate_id, int $own_order_id = 0, array $coupons = array() ): void {
		$this->errors        = array();
		$this->coupon_errors = array();
		$this->own_order     = $own_order_id > 0 ? wc_get_order( $own_order_id ) : null;
		$this->own_order     = $this->own_order instanceof WC_Order ? $this->own_order : null;

		// Calculate as a guest in an isolated, non-persistent session.
		wp_set_current_user( 0 );
		add_filter( 'woocommerce_session_handler', array( __CLASS__, 'session_handler_class' ) );
		WC()->session  = null;
		WC()->cart     = null;
		WC()->customer = null;
		wc_load_cart();
		WC()->cart->get_cart(); // Loads (the empty) cart from session once, before items are added.
		wc_clear_notices();

		if ( $own_order_id > 0 ) {
			WC()->session->set( 'order_awaiting_payment', $own_order_id );
		}

		$this->set_customer_address( $address );

		foreach ( $items as $item ) {
			$this->add_item( (int) $item['product_id'], (int) ( $item['variation_id'] ?? 0 ), (int) $item['quantity'], $own_order_id );
		}

		if ( ! WC()->cart->is_empty() ) {
			// Validates item validity and stock, including stock held by other customers' pending orders.
			WC()->cart->check_cart_items();
		}
		$this->collect_notices( 0, 0 );

		if ( $shipping_rate_id ) {
			WC()->session->set( 'chosen_shipping_methods', array( 0 => $shipping_rate_id ) );
		}

		WC()->cart->calculate_totals();

		if ( $coupons && ! WC()->cart->is_empty() ) {
			// The session's own pending order already holds its coupons. That hold must not make a
			// usage-limited coupon look used up when the same customer pays again. WooCommerce
			// validates coupons again while calculating totals, so this covers both steps.
			$this->own_holds = $this->own_coupon_holds();
			add_filter( 'woocommerce_coupon_get_usage_count', array( $this, 'exclude_own_hold' ), 10, 2 );
			try {
				$this->apply_coupons( $coupons );
				// A free-shipping coupon resets the chosen method; keep the customer's choice when it is still offered.
				if ( $shipping_rate_id ) {
					WC()->session->set( 'chosen_shipping_methods', array( 0 => $shipping_rate_id ) );
				}
				WC()->cart->calculate_totals();
			} finally {
				remove_filter( 'woocommerce_coupon_get_usage_count', array( $this, 'exclude_own_hold' ), 10 );
			}
		}
	}

	/**
	 * Filter callback: WooCommerce adds held (tentative) usages to a coupon's usage count when
	 * checking its usage limit, including the hold of this session's own order. Discount that one.
	 *
	 * @param mixed     $count  Usage count.
	 * @param WC_Coupon $coupon Coupon.
	 * @return mixed
	 */
	public function exclude_own_hold( $count, $coupon ) {
		return $coupon instanceof WC_Coupon && isset( $this->own_holds[ $coupon->get_id() ] ) ? (int) $count - 1 : $count;
	}

	/**
	 * Apply coupon codes one by one so each rejection can be reported with its reason.
	 *
	 * Minimum spend and product restrictions need the cart totals, so this runs after the
	 * first calculate_totals().
	 *
	 * @param string[] $codes Coupon codes.
	 */
	private function apply_coupons( array $codes ): void {
		foreach ( $codes as $code ) {
			wc_clear_notices();
			if ( WC()->cart->apply_coupon( $code ) ) {
				continue;
			}
			$messages = array();
			foreach ( wc_get_notices( 'error' ) as $notice ) {
				$messages[] = wp_strip_all_tags( html_entity_decode( is_array( $notice ) ? ( $notice['notice'] ?? '' ) : (string) $notice ) );
			}
			$this->coupon_errors[] = array(
				'code'    => $code,
				'message' => $messages ? implode( ' ', $messages ) : __( 'Rabatkoden kan ikke bruges.', 'headless-checkout-bridge' ),
			);
		}
		wc_clear_notices();

		// An individual-use coupon applied later removes earlier ones without an error notice.
		$applied = array_map( 'wc_strtolower', WC()->cart->get_applied_coupons() );
		$failed  = array_map( 'wc_strtolower', wp_list_pluck( $this->coupon_errors, 'code' ) );
		foreach ( $codes as $code ) {
			$key = wc_strtolower( $code );
			if ( ! in_array( $key, $applied, true ) && ! in_array( $key, $failed, true ) ) {
				$this->coupon_errors[] = array(
					'code'    => $code,
					'message' => __( 'Rabatkoden kan ikke bruges sammen med de andre rabatkoder.', 'headless-checkout-bridge' ),
				);
			}
		}
	}

	/**
	 * Coupons for which the session's own pending order holds a still-valid usage-limit hold.
	 *
	 * @return array<int,bool> Coupon ID => true.
	 */
	private function own_coupon_holds(): array {
		if ( ! $this->own_order ) {
			return array();
		}
		$holds = array();
		foreach ( (array) $this->own_order->get_meta( '_coupon_held_keys' ) as $coupon_id => $key ) {
			// Hold keys look like "_coupon_held_{expiry timestamp}_{random}" and live as coupon meta.
			if ( is_string( $key ) && preg_match( '/^_coupon_held_(\d+)_/', $key, $match ) && (int) $match[1] > time()
				&& metadata_exists( 'post', (int) $coupon_id, $key ) ) {
				$holds[ (int) $coupon_id ] = true;
			}
		}
		return $holds;
	}

	/**
	 * Coupon codes WooCommerce could not apply.
	 *
	 * @return array<int,array{code:string,message:string}>
	 */
	public function get_coupon_errors(): array {
		return $this->coupon_errors;
	}

	/**
	 * Enforce "usage limit per user" for a guest e-mail address, as WooCommerce's own checkout
	 * does once the billing e-mail is known. Rejected coupons are removed from the cart.
	 *
	 * Call after the session's own coupon holds have been released.
	 *
	 * @param string $email Billing e-mail.
	 */
	public function enforce_guest_coupon_limits( string $email ): void {
		$email   = wc_strtolower( sanitize_email( $email ) );
		$removed = false;
		foreach ( WC()->cart->get_applied_coupons() as $code ) {
			$coupon     = new WC_Coupon( $code );
			$limit      = $coupon->get_usage_limit_per_user();
			$data_store = $coupon->get_data_store();
			if ( $limit > 0 && '' !== $email && $data_store && $data_store->get_usage_by_email( $coupon, $email ) >= $limit ) {
				WC()->cart->remove_coupon( $code );
				$this->coupon_errors[] = array(
					'code'    => $code,
					'message' => $coupon->get_coupon_error( WC_Coupon::E_WC_COUPON_USAGE_LIMIT_REACHED ),
				);
				$removed = true;
			}
		}
		if ( $removed ) {
			WC()->cart->calculate_totals();
		}
	}

	/**
	 * Class name filter callback.
	 *
	 * @return string
	 */
	public static function session_handler_class(): string {
		return 'WCHC_Memory_Session';
	}

	/**
	 * Errors found while building the cart.
	 *
	 * @return array<int,array<string,mixed>>
	 */
	public function get_errors(): array {
		return $this->errors;
	}

	/**
	 * The shipping rate WooCommerce selected for the (single) package, if any.
	 */
	public function get_chosen_shipping_rate_id(): ?string {
		$chosen = WC()->session->get( 'chosen_shipping_methods' );
		return is_array( $chosen ) && ! empty( $chosen[0] ) ? (string) $chosen[0] : null;
	}

	/**
	 * Serialise the calculated cart as a quote.
	 *
	 * @return array<string,mixed>
	 */
	public function to_quote(): array {
		$cart     = WC()->cart;
		$decimals = wc_get_price_decimals();
		$totals   = $cart->get_totals();
		$items    = array();

		foreach ( $cart->get_cart() as $key => $cart_item ) {
			/** @var WC_Product $product */ // phpcs:ignore Generic.Commenting.DocComment.MissingShort
			$product  = $cart_item['data'];
			$qty      = (int) $cart_item['quantity'];
			$subtotal = (float) $cart_item['line_subtotal'] + (float) $cart_item['line_subtotal_tax'];

			$items[] = array(
				'key'               => (string) $key,
				'product_id'        => (int) $cart_item['product_id'],
				'variation_id'      => (int) $cart_item['variation_id'],
				'name'              => $product->get_name(),
				'sku'               => $product->get_sku(),
				'quantity'          => $qty,
				'unit_price'        => $this->money( $qty > 0 ? $subtotal / $qty : 0 ),
				'line_subtotal'     => $this->money( $cart_item['line_subtotal'] ),
				'line_subtotal_tax' => $this->money( $cart_item['line_subtotal_tax'] ),
				'line_total'        => $this->money( $cart_item['line_total'] ),
				'line_tax'          => $this->money( $cart_item['line_tax'] ),
				'stock_quantity'    => $product->managing_stock() ? (int) $product->get_stock_quantity() : null,
				'stock_status'      => $product->get_stock_status(),
			);
		}

		$rates   = array();
		$package = WC()->shipping()->get_packages()[0] ?? null;
		if ( $package && ! empty( $package['rates'] ) ) {
			foreach ( $package['rates'] as $rate ) {
				/** @var WC_Shipping_Rate $rate */ // phpcs:ignore Generic.Commenting.DocComment.MissingShort
				$rates[] = array(
					'id'          => $rate->get_id(),
					'method_id'   => $rate->get_method_id(),
					'instance_id' => (int) $rate->get_instance_id(),
					'label'       => $rate->get_label(),
					'cost'        => $this->money( $rate->get_cost() ),
					'tax'         => $this->money( $rate->get_shipping_tax() ),
				);
			}
		}

		$coupons = array();
		foreach ( $cart->get_applied_coupons() as $code ) {
			$coupons[] = array(
				'code'         => (string) $code,
				'discount'     => $this->money( $cart->get_coupon_discount_amount( $code, true ) ),
				'discount_tax' => $this->money( $cart->get_coupon_discount_tax_amount( $code ) ),
			);
		}

		return array(
			'currency'           => get_woocommerce_currency(),
			'price_decimals'     => $decimals,
			'prices_include_tax' => wc_prices_include_tax(),
			'tax_display_cart'   => get_option( 'woocommerce_tax_display_cart' ),
			'items'              => $items,
			'needs_shipping'     => $cart->needs_shipping(),
			'shipping_rates'     => $rates,
			'shipping_rate_id'   => $this->get_chosen_shipping_rate_id(),
			'totals'             => array(
				'subtotal'     => $this->money( $totals['subtotal'] ?? 0 ),
				'subtotal_tax' => $this->money( $totals['subtotal_tax'] ?? 0 ),
				'discount'     => $this->money( $totals['discount_total'] ?? 0 ),
				'discount_tax' => $this->money( $totals['discount_tax'] ?? 0 ),
				'shipping'     => $this->money( $totals['shipping_total'] ?? 0 ),
				'shipping_tax' => $this->money( $totals['shipping_tax'] ?? 0 ),
				'fees'         => $this->money( $totals['fee_total'] ?? 0 ),
				'tax'          => $this->money( $totals['total_tax'] ?? 0 ),
				'total'        => $this->money( $cart->get_total( 'edit' ) ),
			),
			'errors'             => $this->errors,
			'coupons_enabled'    => wc_coupons_enabled(),
			'coupons'            => $coupons,
			'coupon_errors'      => $this->coupon_errors,
			'cart_hash'          => $cart->get_cart_hash(),
		);
	}

	/**
	 * Format a monetary amount as a decimal string with the shop's precision.
	 *
	 * @param mixed $amount Amount.
	 */
	private function money( $amount ): string {
		return wc_format_decimal( (float) $amount, wc_get_price_decimals() );
	}

	/**
	 * Apply the destination address to the session customer (used for tax and shipping).
	 *
	 * @param array $address Address fields.
	 */
	private function set_customer_address( array $address ): void {
		$customer = WC()->customer;
		$country  = strtoupper( (string) ( $address['country'] ?? WC()->countries->get_base_country() ) );

		$fields = array(
			'country'   => $country,
			'state'     => (string) ( $address['state'] ?? '' ),
			'postcode'  => (string) ( $address['postcode'] ?? '' ),
			'city'      => (string) ( $address['city'] ?? '' ),
			'address_1' => (string) ( $address['address_1'] ?? '' ),
			'address_2' => (string) ( $address['address_2'] ?? '' ),
		);

		foreach ( $fields as $field => $value ) {
			$customer->{"set_shipping_{$field}"}( $value );
			$customer->{"set_billing_{$field}"}( $value );
		}
		// WooCommerce checks coupon e-mail restrictions against the customer's billing e-mail.
		$customer->set_billing_email( (string) ( $address['email'] ?? '' ) );
		$customer->set_calculated_shipping( true );
	}

	/**
	 * Validate and add one line to the cart.
	 *
	 * @param int $product_id   Parent/simple product ID.
	 * @param int $variation_id Variation ID or 0.
	 * @param int $quantity     Quantity.
	 * @param int $own_order_id Order whose own stock hold should be ignored.
	 */
	private function add_item( int $product_id, int $variation_id, int $quantity, int $own_order_id ): void {
		$product = wc_get_product( $variation_id > 0 ? $variation_id : $product_id );

		if ( ! $product || ( $variation_id > 0 && $product->get_parent_id() !== $product_id ) ) {
			$this->add_error( 'product_not_found', __( 'Produktet findes ikke længere.', 'headless-checkout-bridge' ), $product_id, $variation_id );
			return;
		}

		$status_product = $variation_id > 0 ? wc_get_product( $product_id ) : $product;
		if ( ! $status_product || 'publish' !== $status_product->get_status() || ! $product->is_purchasable() ) {
			$this->add_error( 'not_purchasable', __( 'Produktet kan ikke købes.', 'headless-checkout-bridge' ), $product_id, $variation_id );
			return;
		}

		if ( $product->is_type( 'variable' ) ) {
			$this->add_error( 'variation_required', __( 'Vælg en variant.', 'headless-checkout-bridge' ), $product_id, $variation_id );
			return;
		}

		$variation_attributes = array();
		if ( $variation_id > 0 ) {
			$variation_attributes = $product->get_variation_attributes();
			foreach ( $variation_attributes as $value ) {
				if ( '' === $value ) {
					// "Any …" variations need an explicit attribute choice, which this API does not take.
					$this->add_error( 'variation_required', __( 'Vælg en variant.', 'headless-checkout-bridge' ), $product_id, $variation_id );
					return;
				}
			}
		}

		if ( ! $product->is_in_stock() ) {
			$this->add_error( 'out_of_stock', __( 'Produktet er udsolgt.', 'headless-checkout-bridge' ), $product_id, $variation_id, 0 );
			return;
		}

		if ( $product->managing_stock() && ! $product->backorders_allowed() ) {
			$available = (int) $product->get_stock_quantity() - (int) wc_get_held_stock_quantity( $product, $own_order_id );
			if ( $available < $quantity ) {
				$this->add_error(
					$available > 0 ? 'insufficient_stock' : 'out_of_stock',
					$available > 0
						/* translators: %d: units available */
						? sprintf( __( 'Der er kun %d på lager.', 'headless-checkout-bridge' ), $available )
						: __( 'Produktet er udsolgt.', 'headless-checkout-bridge' ),
					$product_id,
					$variation_id,
					max( 0, $available )
				);
				return;
			}
		}

		$added = WC()->cart->add_to_cart( $product_id, $quantity, $variation_id, $variation_attributes );
		if ( ! $added ) {
			$this->collect_notices( $product_id, $variation_id, 'not_purchasable' );
		}
	}

	/**
	 * Turn WooCommerce error notices into structured errors.
	 *
	 * @param int    $product_id   Product context.
	 * @param int    $variation_id Variation context.
	 * @param string $code         Error code to use.
	 */
	private function collect_notices( int $product_id, int $variation_id, string $code = 'cart_error' ): void {
		foreach ( wc_get_notices( 'error' ) as $notice ) {
			$message = is_array( $notice ) ? ( $notice['notice'] ?? '' ) : (string) $notice;
			$this->add_error( $code, wp_strip_all_tags( html_entity_decode( $message ) ), $product_id, $variation_id );
		}
		wc_clear_notices();
	}

	/**
	 * Record an error.
	 *
	 * @param string   $code         Machine-readable code.
	 * @param string   $message      Human-readable message.
	 * @param int      $product_id   Product ID.
	 * @param int      $variation_id Variation ID.
	 * @param int|null $available    Units available, when relevant.
	 */
	private function add_error( string $code, string $message, int $product_id, int $variation_id, ?int $available = null ): void {
		$this->errors[] = array(
			'code'         => $code,
			'message'      => $message,
			'product_id'   => $product_id,
			'variation_id' => $variation_id,
			'available'    => $available,
		);
	}
}
