<?php
/**
 * Free shipping per shipping method: a flat rate can become free once the goods reach an
 * amount ("Fri fragt fra" on the method). The customer still picks the carrier, e.g.
 * "PostNord – nærmeste pakkeshop: Gratis", instead of getting WooCommerce's separate
 * "Free shipping" method next to the paid ones.
 *
 * @package HeadlessCheckoutBridge
 */

defined( 'ABSPATH' ) || exit;

/**
 * Shipping rules.
 */
final class WCHC_Shipping {

	/** Flat rate instance setting: the amount from which the rate is free ('' = never). */
	const FREE_FROM = 'wchc_free_from';

	/** Plugin version that last gave the saved flat rates the setting. */
	const SAVED_RATES_VERSION = 'wchc_shipping_settings_version';

	/**
	 * Register filters.
	 */
	public static function init(): void {
		add_filter( 'woocommerce_shipping_instance_form_fields_flat_rate', array( __CLASS__, 'add_free_from_field' ) );
		add_filter( 'woocommerce_package_rates', array( __CLASS__, 'apply_free_from' ), 20, 2 );
		add_filter( 'pre_update_option', array( __CLASS__, 'keep_free_from_setting' ), 10, 2 );

		if ( get_option( self::SAVED_RATES_VERSION ) !== WCHC_VERSION ) {
			self::add_free_from_to_saved_rates();
			update_option( self::SAVED_RATES_VERSION, WCHC_VERSION );
		}
	}

	/**
	 * WooCommerce's REST API reads every setting of a shipping method straight from its saved
	 * settings, so a flat rate saved before this setting existed makes it emit PHP warnings
	 * (which break the JSON on sites that display errors). Give those rates the empty setting.
	 */
	private static function add_free_from_to_saved_rates(): void {
		global $wpdb;
		$instance_ids = $wpdb->get_col(
			$wpdb->prepare( "SELECT instance_id FROM {$wpdb->prefix}woocommerce_shipping_zone_methods WHERE method_id = %s", 'flat_rate' ) // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		);
		foreach ( $instance_ids as $instance_id ) {
			$option   = 'woocommerce_flat_rate_' . absint( $instance_id ) . '_settings';
			$settings = get_option( $option );
			if ( is_array( $settings ) && ! array_key_exists( self::FREE_FROM, $settings ) ) {
				$settings[ self::FREE_FROM ] = '';
				update_option( $option, $settings );
			}
		}
	}

	/**
	 * Keep the setting when flat rate settings are saved without it (e.g. by code that writes
	 * the option directly), for the same reason.
	 *
	 * @param mixed  $value  New option value.
	 * @param string $option Option name.
	 * @return mixed
	 */
	public static function keep_free_from_setting( $value, $option ) {
		if ( is_array( $value ) && ! array_key_exists( self::FREE_FROM, $value ) && 1 === preg_match( '/^woocommerce_flat_rate_\d+_settings$/', (string) $option ) ) {
			$value[ self::FREE_FROM ] = '';
		}
		return $value;
	}

	/**
	 * Add "Fri fragt fra" to the flat rate settings (shipping zone modal and REST API).
	 *
	 * @param array $fields Instance form fields.
	 * @return array
	 */
	public static function add_free_from_field( $fields ) {
		if ( ! is_array( $fields ) ) {
			return $fields;
		}
		$fields[ self::FREE_FROM ] = array(
			'title'       => 'Fri fragt fra',
			'type'        => 'price',
			'class'       => 'wc-shipping-modal-price',
			'placeholder' => '',
			'description' => 'Metoden er gratis, når varerne koster mindst dette beløb (som i kurven: inkl. moms og efter rabat). Lad feltet stå tomt, hvis metoden altid koster det samme.',
			'default'     => '',
			'desc_tip'    => true,
		);
		return $fields;
	}

	/**
	 * Make flat rates free when the package's goods reach the method's "Fri fragt fra" amount.
	 *
	 * Runs wherever WooCommerce prices shipping (quotes, orders and the normal checkout), so the
	 * amount the customer sees is the amount the order gets.
	 *
	 * @param WC_Shipping_Rate[] $rates   Rates for the package.
	 * @param array              $package Shipping package.
	 * @return WC_Shipping_Rate[]
	 */
	public static function apply_free_from( $rates, $package ) {
		if ( ! is_array( $rates ) || ! is_array( $package ) ) {
			return $rates;
		}

		$goods = null;
		foreach ( $rates as $rate ) {
			if ( ! $rate instanceof WC_Shipping_Rate || 'flat_rate' !== $rate->get_method_id() ) {
				continue;
			}
			$free_from = self::free_from( (int) $rate->get_instance_id() );
			if ( null === $free_from ) {
				continue;
			}
			$goods = $goods ?? self::goods_total( $package );
			if ( $goods >= $free_from ) {
				$rate->set_cost( 0 );
				$rate->set_taxes( array() );
			}
		}

		return $rates;
	}

	/**
	 * The method's "Fri fragt fra" amount, or null when it is not set.
	 *
	 * @param int $instance_id Shipping method instance.
	 */
	private static function free_from( int $instance_id ): ?float {
		$settings = get_option( 'woocommerce_flat_rate_' . $instance_id . '_settings' );
		$value    = is_array( $settings ) ? trim( (string) ( $settings[ self::FREE_FROM ] ?? '' ) ) : '';
		if ( '' === $value ) {
			return null;
		}
		// Saved by the admin form as a decimal; through the REST API it may still use the shop's separator.
		$value = wc_format_decimal( $value );
		return is_numeric( $value ) && (float) $value >= 0 ? (float) $value : null;
	}

	/**
	 * The goods in the package after discounts, with tax when the cart shows prices incl. tax
	 * (the same basis as WooCommerce's own free shipping minimum).
	 *
	 * @param array $package Shipping package.
	 */
	private static function goods_total( array $package ): float {
		$incl_tax = WC()->cart
			? WC()->cart->display_prices_including_tax()
			: 'incl' === get_option( 'woocommerce_tax_display_cart' );

		$total = 0.0;
		foreach ( (array) ( $package['contents'] ?? array() ) as $item ) {
			$total += (float) ( $item['line_total'] ?? 0 );
			if ( $incl_tax ) {
				$total += (float) ( $item['line_tax'] ?? 0 );
			}
		}
		return round( $total, wc_get_price_decimals() );
	}
}
