<?php
/**
 * Order e-mails in the name of the webshop the order came from.
 *
 * Several storefronts share this WooCommerce, so the storefront sends its brand with the
 * order (`store`: name, url, email, color, logo), stored as order meta WCHC_META_STORE_BRANDING.
 * WooCommerce's e-mails for such an order (the customer's and "New order") then show the
 * webshop instead of the WordPress site:
 *
 * - From name: the webshop's name. The From address stays WooCommerce's.
 * - Reply-To: the webshop's e-mail in the customer's e-mails. E-mails to the shop keep the
 *   customer as Reply-To, as in WooCommerce.
 * - {site_title}, {site_url} and {site_address} (the host, as in WooCommerce) and {store_url}
 *   (the full address) in subjects, headings, additional content and the footer text.
 * - Header image, its link and the base colour of the e-mail templates.
 * - The "New order" subject names the webshop, also when it has no {site_title}.
 *
 * Orders without the meta get WooCommerce's e-mails unchanged. E-mails from WooCommerce's
 * block e-mail editor get the From name (also its store name), Reply-To and texts; their
 * header (site logo or title) and colours come from the editor's template.
 *
 * @package HeadlessCheckoutBridge
 */

defined( 'ABSPATH' ) || exit;

/**
 * Order e-mails per webshop.
 */
final class WCHC_Emails {

	/** Longest webshop name that is stored. */
	const MAX_NAME_LENGTH = 100;

	/**
	 * Brand of the e-mail WooCommerce is building, for the settings its templates read without
	 * the e-mail (header image, base colour, footer text). Set when WooCommerce formats the
	 * e-mail's subject, which comes before its content, and cleared once it is sent (its styles
	 * are inlined just before).
	 *
	 * @var array<string,string>|null
	 */
	private static $current = null;

	/**
	 * Register hooks.
	 */
	public static function init(): void {
		// WooCommerce puts the site's values into the placeholders inside format_string(), before
		// woocommerce_email_format_string sees the text, so the webshop's values go into the
		// e-mail's texts as WooCommerce reads them.
		add_filter( 'woocommerce_email_get_option', array( __CLASS__, 'brand_text_setting' ), 10, 4 );
		add_filter( 'woocommerce_email_subject_new_order', array( __CLASS__, 'new_order_subject' ), 10, 3 );
		add_filter( 'woocommerce_email_from_name', array( __CLASS__, 'from_name' ), 10, 2 );
		add_filter( 'woocommerce_email_headers', array( __CLASS__, 'headers' ), 10, 4 );

		// Settings the templates read while the e-mail is built.
		add_filter( 'woocommerce_email_format_string', array( __CLASS__, 'begin' ), 10, 2 );
		add_action( 'woocommerce_email_sent', array( __CLASS__, 'end' ), PHP_INT_MAX, 0 );
		add_filter( 'pre_option_woocommerce_email_header_image', array( __CLASS__, 'header_image' ) );
		add_filter( 'pre_option_woocommerce_email_base_color', array( __CLASS__, 'base_color' ) );
		add_filter( 'woocommerce_email_header_image_url', array( __CLASS__, 'header_image_url' ) );
		// Before WordPress escapes it (10): the store name in the header (logo alt text, title).
		add_filter( 'bloginfo', array( __CLASS__, 'site_name' ), 9, 2 );
		// Before WooCommerce puts in the site's values (10).
		add_filter( 'woocommerce_email_footer_text', array( __CLASS__, 'footer_text' ), 5, 2 );
	}

	/**
	 * The valid fields of a webshop brand: name (plain text, at most 100 characters), url
	 * (http or https), email, color (#rrggbb) and logo (https). Invalid or missing fields are
	 * left out.
	 *
	 * @param mixed $raw Brand as the storefront sent it, or as stored on the order.
	 * @return array<string,string>
	 */
	public static function sanitize_store( $raw ): array {
		if ( ! is_array( $raw ) ) {
			return array();
		}
		$field = static function ( string $key ) use ( $raw ): string {
			return isset( $raw[ $key ] ) && is_string( $raw[ $key ] ) ? trim( $raw[ $key ] ) : '';
		};

		$store = array();
		$name  = sanitize_text_field( $field( 'name' ) );
		if ( '' !== $name && mb_strlen( $name ) <= self::MAX_NAME_LENGTH ) {
			$store['name'] = $name;
		}
		if ( self::is_url( $field( 'url' ), array( 'https', 'http' ) ) ) {
			$store['url'] = $field( 'url' );
		}
		if ( is_email( $field( 'email' ) ) ) {
			$store['email'] = $field( 'email' );
		}
		if ( preg_match( '/^#[0-9a-f]{6}$/i', $field( 'color' ) ) ) {
			$store['color'] = $field( 'color' );
		}
		if ( self::is_url( $field( 'logo' ), array( 'https' ) ) ) {
			$store['logo'] = $field( 'logo' );
		}
		return $store;
	}

	/**
	 * Whether a URL is absolute, uses one of the schemes and needs no escaping.
	 *
	 * @param string   $url     URL.
	 * @param string[] $schemes Allowed schemes.
	 */
	private static function is_url( string $url, array $schemes ): bool {
		return '' !== $url && strlen( $url ) <= 500 && esc_url_raw( $url, $schemes ) === $url && '' !== (string) wp_parse_url( $url, PHP_URL_HOST );
	}

	/**
	 * The brand of the order an e-mail is about, or null (not an order e-mail, no brand).
	 *
	 * @param mixed $email E-mail.
	 * @return array<string,string>|null
	 */
	private static function store_for( $email ): ?array {
		if ( ! $email instanceof WC_Email || ! $email->object instanceof WC_Order ) {
			return null;
		}
		// Validated again: the meta can also be edited in WooCommerce.
		$store = self::sanitize_store( $email->object->get_meta( WCHC_META_STORE_BRANDING ) );
		return $store ? $store : null;
	}

	/**
	 * The placeholders the brand replaces.
	 *
	 * @param array<string,string> $store Brand.
	 * @return array<string,string>
	 */
	private static function placeholders( array $store ): array {
		$placeholders = array();
		if ( isset( $store['name'] ) ) {
			$placeholders['{site_title}'] = $store['name'];
		}
		if ( isset( $store['url'] ) ) {
			$host                           = (string) wp_parse_url( $store['url'], PHP_URL_HOST );
			$placeholders['{site_url}']     = $host;
			$placeholders['{site_address}'] = $host;
			$placeholders['{store_url}']    = $store['url'];
		}
		return $placeholders;
	}

	/**
	 * Put the webshop into the placeholders of an e-mail's texts (subject, heading, additional
	 * content, preheader and their variants) before WooCommerce formats them.
	 *
	 * @param mixed    $value Setting value.
	 * @param WC_Email $email E-mail.
	 * @param mixed    $raw   Value before other filters.
	 * @param string   $key   Setting key.
	 * @return mixed
	 */
	public static function brand_text_setting( $value, $email, $raw, $key ) {
		if ( ! is_string( $value ) || ! preg_match( '/^(subject|heading|additional_content|preheader)/', (string) $key ) ) {
			return $value;
		}
		$store = self::store_for( $email );
		return $store ? strtr( $value, self::placeholders( $store ) ) : $value;
	}

	/**
	 * "New order" to the shop: the subject names the webshop.
	 *
	 * @param string   $subject Subject.
	 * @param mixed    $order   Order.
	 * @param WC_Email $email   E-mail.
	 * @return string
	 */
	public static function new_order_subject( $subject, $order, $email ) {
		$store = self::store_for( $email );
		if ( ! isset( $store['name'] ) || ! is_string( $subject ) || false !== strpos( $subject, $store['name'] ) ) {
			return $subject;
		}
		return '[' . $store['name'] . '] ' . $subject;
	}

	/**
	 * From name: the webshop's name.
	 *
	 * @param string   $from_name From name.
	 * @param WC_Email $email     E-mail.
	 * @return string
	 */
	public static function from_name( $from_name, $email ) {
		$store = self::store_for( $email );
		return isset( $store['name'] ) ? $store['name'] : $from_name;
	}

	/**
	 * Reply-To of the customer's e-mails: the webshop's e-mail.
	 *
	 * @param string   $header    Headers.
	 * @param string   $id        E-mail ID.
	 * @param mixed    $wc_object E-mail object.
	 * @param WC_Email $email     E-mail.
	 * @return string
	 */
	public static function headers( $header, $id, $wc_object, $email ) {
		$store = self::store_for( $email );
		if ( ! isset( $store['email'] ) || ! is_string( $header ) || ! $email->is_customer_email() ) {
			return $header;
		}
		// wp_mail() splits Reply-To at commas: keep the name to characters that are safe there.
		$name   = isset( $store['name'] ) ? trim( (string) preg_replace( '/[,;:<>"\\\\]+/', ' ', $store['name'] ) ) : '';
		$header = (string) preg_replace( '/^Reply-To:.*\R?/im', '', $header );
		return $header . 'Reply-To: ' . ( '' !== $name ? $name . ' ' : '' ) . '<' . $store['email'] . ">\r\n";
	}

	/**
	 * WooCommerce formats a text of an e-mail, first its subject: the e-mail is being built.
	 *
	 * @param string   $text  Formatted text.
	 * @param WC_Email $email E-mail.
	 * @return string
	 */
	public static function begin( $text, $email ) {
		self::$current = self::store_for( $email );
		return $text;
	}

	/**
	 * The e-mail is sent.
	 */
	public static function end(): void {
		self::$current = null;
	}

	/**
	 * Header image: the webshop's logo.
	 *
	 * @param mixed $pre Value of an earlier filter (false: none).
	 * @return mixed
	 */
	public static function header_image( $pre ) {
		return isset( self::$current['logo'] ) ? self::$current['logo'] : $pre;
	}

	/**
	 * Base colour: the webshop's colour.
	 *
	 * @param mixed $pre Value of an earlier filter (false: none).
	 * @return mixed
	 */
	public static function base_color( $pre ) {
		return isset( self::$current['color'] ) ? self::$current['color'] : $pre;
	}

	/**
	 * The header image links to the webshop.
	 *
	 * @param string $url Link.
	 * @return string
	 */
	public static function header_image_url( $url ) {
		return isset( self::$current['url'] ) ? self::$current['url'] : $url;
	}

	/**
	 * The store name in the e-mail header (title, logo alt text, text logo).
	 *
	 * @param string $output Value.
	 * @param string $show   Requested field.
	 * @return string
	 */
	public static function site_name( $output, $show = '' ) {
		return 'name' === $show && isset( self::$current['name'] ) ? self::$current['name'] : $output;
	}

	/**
	 * Footer text with the webshop in the placeholders.
	 *
	 * @param string        $text  Footer text.
	 * @param WC_Email|null $email E-mail (WooCommerce's footer template has none).
	 * @return string
	 */
	public static function footer_text( $text, $email = null ) {
		$store = $email instanceof WC_Email ? self::store_for( $email ) : self::$current;
		return $store && is_string( $text ) ? strtr( $text, self::placeholders( $store ) ) : $text;
	}
}
