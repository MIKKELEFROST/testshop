<?php
/**
 * Webshops: which headless storefronts sell which products, when several storefronts share
 * this WooCommerce (e.g. piece.dk and halloween-kostumer.dk).
 *
 * - Products are assigned in the "Webshops" box on the product (Products → Webshops lists
 *   them). A webshop's slug is its storefront's store ID (NEXT_PUBLIC_STORE_ID).
 * - A storefront whose store ID is not a webshop here sells every product, as before, so
 *   a single-shop setup needs nothing.
 * - REST API v3 product responses get `webshops` (slugs), which can also be set through the
 *   API. `GET /wc/v3/products?wchc_shop=<slug>` lists only that webshop's products.
 * - Quotes and orders refuse products the requesting webshop does not sell.
 * - The orders list shows which webshop each headless order came from.
 *
 * @package HeadlessCheckoutBridge
 */

defined( 'ABSPATH' ) || exit;

/**
 * Webshops.
 */
final class WCHC_Shops {

	const TAXONOMY = 'wchc_shop';

	/** Cached category counts per store ID (see category_counts). */
	const COUNTS_TRANSIENT = 'wchc_category_counts';

	/** Option raised on every change that can alter the counts, so a recount that overlapped one is not cached. */
	const COUNTS_GENERATION = 'wchc_counts_gen';

	/** Webshop slugs are store IDs as the storefront sends them (see sanitize_key). */
	const SLUG_PATTERN = '[a-z0-9_\-]{1,50}';

	/**
	 * Register hooks. Called on plugins_loaded.
	 */
	public static function init(): void {
		add_action( 'init', array( __CLASS__, 'register_taxonomy' ) );

		add_filter( 'woocommerce_rest_product_object_query', array( __CLASS__, 'filter_rest_query' ), 10, 2 );
		add_filter( 'woocommerce_rest_prepare_product_object', array( __CLASS__, 'add_to_response' ), 10, 2 );
		add_filter( 'woocommerce_rest_product_schema', array( __CLASS__, 'add_to_schema' ) );
		add_filter( 'woocommerce_rest_pre_insert_product_object', array( __CLASS__, 'validate_request' ), 10, 2 );
		add_action( 'woocommerce_rest_insert_product_object', array( __CLASS__, 'save_from_request' ), 10, 2 );

		// Category counts (category_counts) are recounted after changes to products, categories or webshops.
		foreach ( array( 'woocommerce_new_product', 'woocommerce_update_product', 'woocommerce_delete_product', 'woocommerce_trash_product', 'created_product_cat', 'edited_product_cat', 'delete_product_cat', 'created_' . self::TAXONOMY, 'edited_' . self::TAXONOMY, 'delete_' . self::TAXONOMY ) as $hook ) {
			add_action( $hook, array( __CLASS__, 'forget_category_counts' ) );
		}
		add_action( 'set_object_terms', array( __CLASS__, 'forget_counts_on_terms' ), 10, 4 );
		// Also what WooCommerce's product hooks miss: trash and restore in the products list, scheduled publishing.
		add_action( 'transition_post_status', array( __CLASS__, 'forget_counts_on_status' ), 10, 3 );

		// Orders list: "Webshop" column (HPOS and legacy posts storage).
		add_filter( 'manage_woocommerce_page_wc-orders_columns', array( __CLASS__, 'add_order_column' ) );
		add_action( 'manage_woocommerce_page_wc-orders_custom_column', array( __CLASS__, 'render_order_column' ), 10, 2 );
		add_filter( 'manage_edit-shop_order_columns', array( __CLASS__, 'add_order_column' ) );
		add_action( 'manage_shop_order_posts_custom_column', array( __CLASS__, 'render_order_column' ), 10, 2 );
	}

	/**
	 * The "Webshops" taxonomy: checkboxes on the product, a column in the products list.
	 */
	public static function register_taxonomy(): void {
		register_taxonomy(
			self::TAXONOMY,
			array( 'product' ),
			array(
				'labels'             => array(
					'name'          => 'Webshops',
					'singular_name' => 'Webshop',
					'menu_name'     => 'Webshops',
					'all_items'     => 'Alle webshops',
					'edit_item'     => 'Rediger webshop',
					'view_item'     => 'Vis webshop',
					'update_item'   => 'Opdater webshop',
					'add_new_item'  => 'Tilføj ny webshop',
					'new_item_name' => 'Navn på ny webshop',
					'search_items'  => 'Søg i webshops',
					'not_found'     => 'Ingen webshops fundet.',
					'back_to_items' => '← Tilbage til webshops',
				),
				'description'        => 'Hvilke webshops sælger produktet. Slug skal være webshoppens butiks-ID (NEXT_PUBLIC_STORE_ID).',
				// Hierarchical only to get checkboxes instead of a free-text tag field.
				'hierarchical'       => true,
				'public'             => false,
				'publicly_queryable' => false,
				'show_ui'            => true,
				'show_in_menu'       => true,
				'show_in_nav_menus'  => false,
				'show_tagcloud'      => false,
				'show_in_quick_edit' => true,
				'show_admin_column'  => true,
				'show_in_rest'       => false,
				'rewrite'            => false,
				'query_var'          => false,
				'capabilities'       => array(
					'manage_terms' => 'manage_product_terms',
					'edit_terms'   => 'edit_product_terms',
					'delete_terms' => 'delete_product_terms',
					'assign_terms' => 'assign_product_terms',
				),
			)
		);
	}

	/**
	 * The webshop with this slug, or null when the store ID is not a webshop here.
	 *
	 * @param string $store_id Store ID / webshop slug.
	 */
	public static function find( string $store_id ): ?WP_Term {
		if ( '' === $store_id ) {
			return null;
		}
		$term = get_term_by( 'slug', $store_id, self::TAXONOMY );
		return $term instanceof WP_Term ? $term : null;
	}

	/**
	 * Whether the storefront with this store ID may sell the product. Store IDs that are not
	 * a webshop here sell everything (single-shop setups).
	 *
	 * @param string $store_id   Store ID.
	 * @param int    $product_id Product (parent) ID.
	 */
	public static function sells( string $store_id, int $product_id ): bool {
		$shop = self::find( $store_id );
		return ! $shop || has_term( $shop->term_id, self::TAXONOMY, $product_id );
	}

	/**
	 * Number of published products per product category in a webshop, in one query instead
	 * of one REST request per category. A category counts its subcategories' products too
	 * (each product once), like the REST API's `category` filter. A store ID that is not a
	 * webshop counts every published product. Cached until a product, category or webshop
	 * changes; a recount that a change overlapped is not cached.
	 *
	 * @param string $store_id Store ID / webshop slug.
	 * @return array<int,int> Category term ID => number of products (categories without products are left out).
	 */
	public static function category_counts( string $store_id ): array {
		// Read before counting: a change from here on raises it, and the result is then not cached.
		$generation = self::counts_generation();
		$cached     = get_transient( self::COUNTS_TRANSIENT );
		$shops      = is_array( $cached ) && ( $cached['generation'] ?? null ) === $generation && is_array( $cached['shops'] ?? null ) ? $cached['shops'] : array();
		if ( isset( $shops[ $store_id ] ) && is_array( $shops[ $store_id ] ) ) {
			return $shops[ $store_id ];
		}

		global $wpdb;
		$shop      = self::find( $store_id );
		$shop_join = $shop
			? $wpdb->prepare( "INNER JOIN {$wpdb->term_relationships} shop ON shop.object_id = p.ID AND shop.term_taxonomy_id = %d", $shop->term_taxonomy_id )
			: '';
		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery -- $shop_join is prepared above; the result is cached.
		$rows = $wpdb->get_results(
			"SELECT p.ID AS product, tt.term_id AS category
			FROM {$wpdb->posts} p
			{$shop_join}
			INNER JOIN {$wpdb->term_relationships} tr ON tr.object_id = p.ID
			INNER JOIN {$wpdb->term_taxonomy} tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'product_cat'
			WHERE p.post_type = 'product' AND p.post_status = 'publish'"
		);
		// phpcs:enable

		$parents = get_terms(
			array(
				'taxonomy'   => 'product_cat',
				'hide_empty' => false,
				'fields'     => 'id=>parent',
			)
		);
		$parents = is_array( $parents ) ? $parents : array();

		// Each product counts once in its categories and all their parents.
		$in = array();
		foreach ( (array) $rows as $row ) {
			for ( $id = (int) $row->category; $id > 0 && ! isset( $in[ (int) $row->product ][ $id ] ); $id = (int) ( $parents[ $id ] ?? 0 ) ) {
				$in[ (int) $row->product ][ $id ] = true;
			}
		}
		$counts = array();
		foreach ( $in as $categories ) {
			foreach ( array_keys( $categories ) as $id ) {
				$counts[ $id ] = ( $counts[ $id ] ?? 0 ) + 1;
			}
		}

		if ( self::counts_generation() === $generation ) {
			$shops[ $store_id ] = $counts;
			set_transient(
				self::COUNTS_TRANSIENT,
				array(
					'generation' => $generation,
					'shops'      => $shops,
				),
				HOUR_IN_SECONDS
			);
		}
		return $counts;
	}

	/**
	 * Drop the cached category counts (a product, category or webshop changed), also those a
	 * recount running right now would store.
	 */
	public static function forget_category_counts(): void {
		update_option( self::COUNTS_GENERATION, self::counts_generation() + 1, false );
		delete_transient( self::COUNTS_TRANSIENT );
	}

	/**
	 * Terms were set on an object: the counts change with a product's categories or webshops.
	 *
	 * @param int    $object_id Object ID.
	 * @param array  $terms     Terms.
	 * @param array  $tt_ids    Term taxonomy IDs.
	 * @param string $taxonomy  Taxonomy.
	 */
	public static function forget_counts_on_terms( $object_id, $terms, $tt_ids, $taxonomy ): void {
		if ( in_array( $taxonomy, array( 'product_cat', self::TAXONOMY ), true ) ) {
			self::forget_category_counts();
		}
	}

	/**
	 * A post's status changed: the counts change when a product is published or stops being.
	 *
	 * @param string $new_status New status.
	 * @param string $old_status Old status.
	 * @param mixed  $post       Post.
	 */
	public static function forget_counts_on_status( $new_status, $old_status, $post ): void {
		if ( $new_status !== $old_status && $post instanceof WP_Post && 'product' === $post->post_type && ( 'publish' === $new_status || 'publish' === $old_status ) ) {
			self::forget_category_counts();
		}
	}

	/**
	 * The generation of the category counts, read from the database: another request may have
	 * raised it after this one cached its options.
	 */
	private static function counts_generation(): int {
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery -- must bypass the option cache, see above.
		return (int) $wpdb->get_var( $wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", self::COUNTS_GENERATION ) );
	}

	/**
	 * All webshops with their number of published products.
	 *
	 * @return array<int,array{slug:string,name:string,products:int}>
	 */
	public static function all(): array {
		$terms = get_terms(
			array(
				'taxonomy'   => self::TAXONOMY,
				'hide_empty' => false,
				'orderby'    => 'name',
			)
		);
		if ( ! is_array( $terms ) ) {
			return array();
		}
		return array_map(
			static function ( WP_Term $term ) {
				return array(
					'slug'     => $term->slug,
					'name'     => $term->name,
					'products' => (int) $term->count,
				);
			},
			$terms
		);
	}

	/**
	 * Create a webshop, or rename an existing one.
	 *
	 * @param string $slug Store ID.
	 * @param string $name Display name.
	 * @return array{slug:string,name:string,products:int}|WP_Error
	 */
	public static function upsert( string $slug, string $name ) {
		$existing = self::find( $slug );
		$result   = $existing
			? wp_update_term( $existing->term_id, self::TAXONOMY, array( 'name' => $name ) )
			: wp_insert_term( $name, self::TAXONOMY, array( 'slug' => $slug ) );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		$term = get_term( (int) $result['term_id'], self::TAXONOMY );
		if ( ! $term instanceof WP_Term || $term->slug !== $slug ) {
			// WordPress makes a slug unique by adding a suffix; a webshop slug must match exactly.
			return new WP_Error( 'invalid_webshop', 'Webshoppen kunne ikke oprettes med det butiks-ID.', array( 'status' => 409 ) );
		}
		return array(
			'slug'     => $term->slug,
			'name'     => $term->name,
			'products' => (int) $term->count,
		);
	}

	/**
	 * REST: `wchc_shop=<slug>` lists only that webshop's products.
	 *
	 * @param array           $args    WP_Query args.
	 * @param WP_REST_Request $request Request.
	 * @return array
	 */
	public static function filter_rest_query( $args, $request ) {
		$slug = $request instanceof WP_REST_Request ? $request->get_param( 'wchc_shop' ) : null;
		if ( ! is_string( $slug ) || '' === $slug ) {
			return $args;
		}
		$shop = self::find( sanitize_key( $slug ) );
		if ( ! $shop ) {
			return $args;
		}
		$args['tax_query']   = isset( $args['tax_query'] ) && is_array( $args['tax_query'] ) ? $args['tax_query'] : array(); // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
		$args['tax_query'][] = array(
			'taxonomy' => self::TAXONOMY,
			'field'    => 'term_id',
			'terms'    => array( $shop->term_id ),
		);
		if ( isset( $args['name'] ) && '' !== $args['name'] ) {
			// A `slug` lookup is a single-post query, for which WP_Query ignores tax_query: look
			// the slug up by ID instead (post_name__in is not an allowed REST query var).
			$ids = get_posts(
				array(
					'post_type'        => 'product',
					'name'             => (string) $args['name'],
					'post_status'      => 'any',
					'fields'           => 'ids',
					'posts_per_page'   => 10,
					'no_found_rows'    => true,
					'suppress_filters' => true,
				)
			);
			$ids = array_map( 'intval', $ids );
			if ( ! empty( $args['post__in'] ) ) {
				$ids = array_intersect( $ids, array_map( 'intval', (array) $args['post__in'] ) );
			}
			$args['post__in'] = $ids ? array_values( $ids ) : array( 0 );
			unset( $args['name'] );
		}
		return $args;
	}

	/**
	 * REST: add `webshops` (slugs) to product responses.
	 *
	 * @param WP_REST_Response $response Response.
	 * @param WC_Product       $product  Product.
	 * @return WP_REST_Response
	 */
	public static function add_to_response( $response, $product ) {
		if ( ! $response instanceof WP_REST_Response || ! $product instanceof WC_Product ) {
			return $response;
		}
		$data             = $response->get_data();
		$data['webshops'] = self::product_shops( $product->get_id() );
		$response->set_data( $data );
		return $response;
	}

	/**
	 * Document `webshops` in the product schema (also makes WordPress validate its type).
	 *
	 * @param array $schema Properties.
	 * @return array
	 */
	public static function add_to_schema( $schema ) {
		$schema['webshops'] = array(
			'description' => 'Webshops (butiks-ID’er) der sælger produktet.',
			'type'        => 'array',
			'items'       => array( 'type' => 'string' ),
			'context'     => array( 'view', 'edit' ),
		);
		return $schema;
	}

	/**
	 * REST: reject unknown webshops before the product is saved.
	 *
	 * @param WC_Product|WP_Error $product Product.
	 * @param WP_REST_Request     $request Request.
	 * @return WC_Product|WP_Error
	 */
	public static function validate_request( $product, $request ) {
		if ( is_wp_error( $product ) || ! $request instanceof WP_REST_Request || null === $request->get_param( 'webshops' ) ) {
			return $product;
		}
		$ids = self::term_ids_from_request( $request );
		return is_wp_error( $ids ) ? $ids : $product;
	}

	/**
	 * REST: save `webshops` after the product is saved (it has an ID by then).
	 *
	 * @param WC_Product      $product Product.
	 * @param WP_REST_Request $request Request.
	 */
	public static function save_from_request( $product, $request ): void {
		if ( ! $product instanceof WC_Product || ! $request instanceof WP_REST_Request || null === $request->get_param( 'webshops' ) ) {
			return;
		}
		$ids = self::term_ids_from_request( $request );
		if ( ! is_wp_error( $ids ) ) {
			wp_set_object_terms( $product->get_id(), $ids, self::TAXONOMY );
		}
	}

	/**
	 * Webshop term IDs from the request's `webshops` slugs.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return int[]|WP_Error
	 */
	private static function term_ids_from_request( WP_REST_Request $request ) {
		$slugs = $request->get_param( 'webshops' );
		if ( ! is_array( $slugs ) ) {
			return new WP_Error( 'wchc_invalid_webshop', 'webshops skal være en liste af butiks-ID’er.', array( 'status' => 400 ) );
		}
		$ids = array();
		foreach ( $slugs as $slug ) {
			$shop = is_string( $slug ) ? self::find( $slug ) : null;
			if ( ! $shop ) {
				return new WP_Error(
					'wchc_invalid_webshop',
					/* translators: %s: store ID */
					sprintf( 'Webshoppen "%s" findes ikke. Opret den under Produkter → Webshops.', is_string( $slug ) ? sanitize_text_field( $slug ) : '' ),
					array( 'status' => 400 )
				);
			}
			$ids[] = (int) $shop->term_id;
		}
		return array_values( array_unique( $ids ) );
	}

	/**
	 * Webshop slugs of a product.
	 *
	 * @param int $product_id Product ID.
	 * @return string[]
	 */
	public static function product_shops( int $product_id ): array {
		$terms = get_the_terms( $product_id, self::TAXONOMY );
		return is_array( $terms ) ? array_values( wp_list_pluck( $terms, 'slug' ) ) : array();
	}

	/**
	 * Orders list: add a "Webshop" column after the order number.
	 *
	 * @param array $columns Columns.
	 * @return array
	 */
	public static function add_order_column( $columns ) {
		$result = array();
		foreach ( (array) $columns as $key => $label ) {
			$result[ $key ] = $label;
			if ( 'order_number' === $key ) {
				$result['wchc_webshop'] = 'Webshop';
			}
		}
		if ( ! isset( $result['wchc_webshop'] ) ) {
			$result['wchc_webshop'] = 'Webshop';
		}
		return $result;
	}

	/**
	 * Orders list: the webshop the order came from.
	 *
	 * @param string       $column Column.
	 * @param WC_Order|int $order  Order (HPOS) or post ID (legacy).
	 */
	public static function render_order_column( $column, $order ): void {
		if ( 'wchc_webshop' !== $column ) {
			return;
		}
		$order    = $order instanceof WC_Order ? $order : wc_get_order( (int) $order );
		$store_id = $order instanceof WC_Order ? (string) $order->get_meta( WCHC_META_STORE_ID ) : '';
		if ( '' === $store_id ) {
			echo '<span aria-hidden="true">–</span>';
			return;
		}
		$shop = self::find( $store_id );
		echo esc_html( $shop ? $shop->name : $store_id );
	}
}
