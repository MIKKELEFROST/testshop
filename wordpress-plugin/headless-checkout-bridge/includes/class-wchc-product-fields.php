<?php
/**
 * Adds display prices to WooCommerce REST API (v3) product responses, calculated with the
 * shop's own tax display settings, so the storefront never has to calculate tax itself.
 *
 * @package HeadlessCheckoutBridge
 */

defined( 'ABSPATH' ) || exit;

/**
 * Product REST fields.
 */
final class WCHC_Product_Fields {

	/**
	 * Register filters.
	 */
	public static function init(): void {
		add_filter( 'woocommerce_rest_prepare_product_object', array( __CLASS__, 'add_display_prices' ), 10, 2 );
		add_filter( 'woocommerce_rest_prepare_product_variation_object', array( __CLASS__, 'add_display_prices' ), 10, 2 );
	}

	/**
	 * Add `headless_prices` to the response.
	 *
	 * @param WP_REST_Response $response Response.
	 * @param WC_Product       $product  Product.
	 * @return WP_REST_Response
	 */
	public static function add_display_prices( $response, $product ) {
		if ( ! $response instanceof WP_REST_Response || ! $product instanceof WC_Product ) {
			return $response;
		}

		$decimals = wc_get_price_decimals();
		$display  = static function ( $price ) use ( $product, $decimals ) {
			if ( '' === $price || null === $price ) {
				return null;
			}
			return wc_format_decimal( wc_get_price_to_display( $product, array( 'price' => (float) $price ) ), $decimals );
		};

		$prices = array(
			'tax_display'   => get_option( 'woocommerce_tax_display_shop' ),
			'price'         => $display( $product->get_price() ),
			'regular_price' => $display( $product->get_regular_price() ),
			'sale_price'    => $display( $product->get_sale_price() ),
			'min_price'     => null,
			'max_price'     => null,
		);

		if ( $product instanceof WC_Product_Variable ) {
			$prices['min_price'] = wc_format_decimal( $product->get_variation_price( 'min', true ), $decimals );
			$prices['max_price'] = wc_format_decimal( $product->get_variation_price( 'max', true ), $decimals );
		}

		$data                    = $response->get_data();
		$data['headless_prices'] = $prices;
		$response->set_data( $data );

		return $response;
	}
}
