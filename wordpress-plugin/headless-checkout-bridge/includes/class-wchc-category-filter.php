<?php
/**
 * Category filters for the products REST API, next to WooCommerce's `category`, which
 * matches products in any of its categories:
 *
 * - `wchc_in_category=<id>[,<id>…]` also requires each of these categories (or one of its
 *   subcategories). `category=<Damekostumer>&wchc_in_category=<Halloween>` lists the
 *   Halloween costumes for women.
 * - `wchc_not_in_category=<id>[,<id>…]` leaves out products in any of these categories or
 *   their subcategories, e.g. Halloween and Christmas on the Fastelavn shop's theme pages.
 * - `wchc_in_any_category=<id>[,<id>…]` also requires one of these categories (or one of
 *   their subcategories), e.g. the Halloween and Christmas products that a category page
 *   of the Fastelavn shop lists after its own season's.
 *
 * All combine with `category`, `tag` and `wchc_shop`.
 *
 * @package HeadlessCheckoutBridge
 */

defined( 'ABSPATH' ) || exit;

/**
 * Category filters for the products REST API.
 */
final class WCHC_Category_Filter {

	/**
	 * Register filters.
	 */
	public static function init(): void {
		add_filter( 'woocommerce_rest_product_object_query', array( __CLASS__, 'filter_rest_query' ), 10, 2 );
	}

	/**
	 * REST: one tax_query clause per category in `wchc_in_category`, one for all categories in
	 * `wchc_not_in_category` and one for all in `wchc_in_any_category`. WP_Query requires all
	 * clauses (relation AND), also those for `category`, `tag` and `wchc_shop`.
	 *
	 * @param array           $args    WP_Query args.
	 * @param WP_REST_Request $request Request.
	 * @return array
	 */
	public static function filter_rest_query( $args, $request ) {
		if ( ! $request instanceof WP_REST_Request ) {
			return $args;
		}
		$in     = self::category_ids( $request->get_param( 'wchc_in_category' ) );
		$not_in = self::category_ids( $request->get_param( 'wchc_not_in_category' ) );
		$any    = self::category_ids( $request->get_param( 'wchc_in_any_category' ) );
		if ( ! $in && ! $not_in && ! $any ) {
			return $args;
		}

		$args['tax_query'] = isset( $args['tax_query'] ) && is_array( $args['tax_query'] ) ? $args['tax_query'] : array(); // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
		foreach ( $in as $id ) {
			$args['tax_query'][] = self::clause( array( $id ), 'IN' );
		}
		if ( $not_in ) {
			$args['tax_query'][] = self::clause( $not_in, 'NOT IN' );
		}
		if ( $any ) {
			$args['tax_query'][] = self::clause( $any, 'IN' );
		}
		return $args;
	}

	/**
	 * A product category clause that includes subcategories.
	 *
	 * @param int[]  $ids      Category IDs.
	 * @param string $operator IN or NOT IN.
	 * @return array
	 */
	private static function clause( array $ids, string $operator ): array {
		return array(
			'taxonomy'         => 'product_cat',
			'field'            => 'term_id',
			'terms'            => $ids,
			'include_children' => true,
			'operator'         => $operator,
		);
	}

	/**
	 * IDs of existing product categories from "12,34" (or a list). Other values are ignored.
	 *
	 * @param mixed $raw Parameter value.
	 * @return int[]
	 */
	private static function category_ids( $raw ): array {
		if ( is_string( $raw ) || is_int( $raw ) ) {
			$raw = explode( ',', (string) $raw );
		}
		if ( ! is_array( $raw ) ) {
			return array();
		}
		$ids = array();
		foreach ( $raw as $value ) {
			$value = is_string( $value ) || is_int( $value ) ? trim( (string) $value ) : '';
			if ( preg_match( '/^\d+$/', $value ) && term_exists( (int) $value, 'product_cat' ) ) {
				$ids[ (int) $value ] = (int) $value;
			}
		}
		return array_values( $ids );
	}
}
