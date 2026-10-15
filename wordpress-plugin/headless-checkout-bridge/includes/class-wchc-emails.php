<?php
/**
 * Order e-mails in the name of the webshop the order came from.
 *
 * Several storefronts share this WooCommerce, so the storefront sends its brand with the
 * order (`store`: name, url, email, color, logo, and the seller and return rules), stored as
 * order meta WCHC_META_STORE_BRANDING. WooCommerce's e-mails for such an order (the customer's
 * and "New order") then show the webshop instead of the WordPress site:
 *
 * - From name: the webshop's name. The From address stays WooCommerce's.
 * - Reply-To: the webshop's e-mail in the customer's e-mails. E-mails to the shop keep the
 *   customer as Reply-To, as in WooCommerce.
 * - {site_title}, {site_url} and {site_address} (the host, as in WooCommerce), {store_url}
 *   (the full address) and {store_email} (the webshop's e-mail, not the From address) in
 *   subjects, headings, additional content and the footer text.
 * - Header image, its link and the base colour of the e-mail templates.
 * - The "New order" subject names the webshop, also when it has no {site_title}.
 * - The customer's order confirmation ("Processing order", "Order on-hold") carries the
 *   withdrawal information and the standard withdrawal form, which forbrugeraftaleloven § 17
 *   requires on a durable medium at the latest on delivery: the periods, how to give notice
 *   (the webshop's e-mail), the return address and return shipping, the refund, the hygiene
 *   exception and the seller.
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

	/** The seller and return rules for the withdrawal information: plain text, longest stored length. */
	const TEXT_FIELDS = array(
		'company_name'    => 100,
		'company_address' => 200,
		'cvr'             => 50,
		'return_address'  => 200,
		'return_shipping' => 500,
	);

	/** The statutory withdrawal period in days (forbrugeraftaleloven). */
	const WITHDRAWAL_DAYS = 14;

	/** Longest return period in days that is stored. */
	const MAX_RETURN_DAYS = 365;

	/** The customer's order confirmations, which carry the withdrawal information and form. */
	const CONFIRMATION_EMAILS = array( 'customer_processing_order', 'customer_on_hold_order' );

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

		// After the customer's addresses (WooCommerce's own parts use 10-30), in HTML and plain text.
		add_action( 'woocommerce_email_customer_details', array( __CLASS__, 'withdrawal_info' ), 40, 4 );
	}

	/**
	 * The valid fields of a webshop brand: name (plain text, at most 100 characters), url
	 * (http or https), email, color (#rrggbb) and logo (https); for the withdrawal information
	 * the seller and return rules (company_name, company_address, cvr, return_address,
	 * return_shipping: plain text, see TEXT_FIELDS) and return_days (a whole number of days,
	 * 14-365). Invalid or missing fields are left out.
	 *
	 * @param mixed $raw Brand as the storefront sent it, or as stored on the order.
	 * @return array<string,string|int>
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
		foreach ( self::TEXT_FIELDS as $key => $max_length ) {
			$text = sanitize_text_field( $field( $key ) );
			if ( '' !== $text && mb_strlen( $text ) <= $max_length ) {
				$store[ $key ] = $text;
			}
		}
		$days = $raw['return_days'] ?? null;
		if ( is_int( $days ) && $days >= self::WITHDRAWAL_DAYS && $days <= self::MAX_RETURN_DAYS ) {
			$store['return_days'] = $days;
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
	 * @return array<string,string|int>|null
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
	 * @param array<string,string|int> $store Brand.
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
		if ( isset( $store['email'] ) ) {
			// WooCommerce's {store_email} is the From address, which all webshops share.
			$placeholders['{store_email}'] = $store['email'];
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

	/**
	 * The withdrawal information and the standard withdrawal form in the customer's order
	 * confirmation, when the order's brand has the e-mail the customer gives notice to.
	 * Seller and return details the storefront did not send are left out.
	 *
	 * @param mixed $order         Order.
	 * @param bool  $sent_to_admin Whether the e-mail goes to the shop.
	 * @param bool  $plain_text    Plain text instead of HTML.
	 * @param mixed $email         E-mail.
	 */
	public static function withdrawal_info( $order, $sent_to_admin = false, $plain_text = false, $email = null ): void {
		if ( $sent_to_admin || ! $order instanceof WC_Order || ! $email instanceof WC_Email || ! in_array( $email->id, self::CONFIRMATION_EMAILS, true ) ) {
			return;
		}
		$store = self::store_for( $email );
		if ( ! isset( $store['email'] ) ) {
			return;
		}
		$sections = self::withdrawal_sections( $store, (string) $order->get_order_number() );
		// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- HTML is escaped as it is built; plain text is not HTML.
		echo $plain_text ? self::withdrawal_plain( $sections ) : self::withdrawal_html( $sections, (string) $store['email'] );
	}

	/**
	 * The withdrawal information in the words of the storefront's terms (page "Returret og
	 * fortrydelse"): the rules, then the standard withdrawal form (its lines under `form`).
	 *
	 * @param array<string,string|int> $store        Brand with an e-mail.
	 * @param string                   $order_number Order number.
	 * @return array<int,array{heading:string,paragraphs:string[],form?:string[]}>
	 */
	private static function withdrawal_sections( array $store, string $order_number ): array {
		$email    = (string) $store['email'];
		$days     = isset( $store['return_days'] ) ? (int) $store['return_days'] : self::WITHDRAWAL_DAYS;
		$extended = $days > self::WITHDRAWAL_DAYS;

		$rules = array(
			$extended
				? sprintf( 'Som forbruger har du 14 dages fortrydelsesret efter forbrugeraftaleloven. Hos os får du %d dages returret, som gælder på samme vilkår. Fristen regnes fra den dag, du modtager varen.', $days )
				: 'Som forbruger har du 14 dages fortrydelsesret efter forbrugeraftaleloven. Fristen regnes fra den dag, du modtager varen.',
			sprintf( 'Giv os besked på %1$s, før fristen udløber. Skriv dit ordrenummer (#%2$s), og hvilke varer du vil sende retur. Du kan bruge standardfortrydelsesformularen nedenfor, men det er ikke et krav.', $email, $order_number ),
			'Send varen retur senest 14 dage efter, at du har givet besked – ubrugt, med mærker på og så vidt muligt i den originale emballage.',
		);
		if ( isset( $store['return_address'] ) ) {
			$rules[] = 'Send pakken til: ' . $store['return_address'];
		}
		if ( isset( $store['return_shipping'] ) ) {
			$rules[] = (string) $store['return_shipping'];
		}
		$rules[] = 'Fortryder du købet, betaler vi alle betalinger tilbage, som vi har modtaget fra dig, også fragten for den billigste standardlevering, vi tilbyder. Vi betaler hurtigst muligt og senest 14 dage efter den dag, vi har modtaget din besked, og bruger det samme betalingsmiddel, som du brugte ved købet. Vi kan vente med at betale tilbage, til vi har modtaget varen, eller til du har vist dokumentation for, at du har sendt den – alt efter hvad der sker først.';
		$rules[] = 'Du hæfter for en eventuel forringelse af varens værdi, som skyldes, at du har håndteret varen mere, end hvad der er nødvendigt for at fastslå dens art, egenskaber og funktion.';
		$rules[] = 'Forseglede hygiejnevarer som make-up og ansigtsmaling kan ikke returneres, når forseglingen er brudt.';

		$seller = array_filter(
			array(
				(string) ( $store['company_name'] ?? '' ),
				isset( $store['cvr'] ) ? 'CVR ' . $store['cvr'] : '',
				(string) ( $store['company_address'] ?? '' ),
			)
		);
		if ( $seller ) {
			$rules[] = 'Sælger: ' . implode( ' · ', $seller );
		}

		// The form is addressed to the seller; the webshop's name stands in for a missing company name.
		$recipient = array_filter(
			array(
				(string) ( $store['company_name'] ?? $store['name'] ?? '' ),
				(string) ( $store['company_address'] ?? '' ),
				$email,
			)
		);
		return array(
			array(
				'heading'    => $extended ? sprintf( 'Fortrydelsesret og %d dages returret', $days ) : 'Fortrydelsesret',
				'paragraphs' => $rules,
			),
			array(
				'heading'    => 'Standardfortrydelsesformular',
				'paragraphs' => array( sprintf( 'Vil du bruge formularen, så kopiér teksten ind i en e-mail, udfyld den, og send den til %s.', $email ) ),
				'form'       => array(
					'(Denne formular udfyldes og returneres kun, hvis fortrydelsesretten gøres gældende)',
					'Til ' . implode( ', ', $recipient ) . ':',
					'Jeg/vi (*) meddeler herved, at jeg/vi (*) ønsker at gøre den fortrydelsesret gældende, der gælder for min/vores (*) købsaftale om følgende varer (*)/levering af følgende tjenesteydelser (*):',
					'Bestilt den (*)/modtaget den (*):',
					'Forbrugerens/forbrugernes navn:',
					'Forbrugerens/forbrugernes adresse:',
					'Forbrugerens/forbrugernes underskrift (kun hvis formularens indhold meddeles på papir):',
					'Dato:',
					'(*) Det ikke-relevante udstreges.',
				),
			),
		);
	}

	/**
	 * The withdrawal information as HTML, with the webshop's e-mail as a link.
	 *
	 * @param array<int,array{heading:string,paragraphs:string[],form?:string[]}> $sections Sections.
	 * @param string                                                             $email    The webshop's e-mail.
	 */
	private static function withdrawal_html( array $sections, string $email ): string {
		$address = esc_html( $email );
		$link    = '<a href="' . esc_url( 'mailto:' . $email ) . '">' . $address . '</a>';
		$text    = static function ( string $text ) use ( $address, $link ): string {
			return str_replace( $address, $link, esc_html( $text ) );
		};

		$html = '<div class="wchc-withdrawal" style="margin-bottom: 40px;">';
		foreach ( $sections as $section ) {
			$html .= '<h2>' . esc_html( $section['heading'] ) . '</h2>';
			foreach ( $section['paragraphs'] as $paragraph ) {
				$html .= '<p>' . $text( $paragraph ) . '</p>';
			}
			if ( isset( $section['form'] ) ) {
				$html .= '<div style="border: 1px solid #e5e5e5; padding: 12px 16px; margin: 0 0 16px;">';
				foreach ( $section['form'] as $line ) {
					$html .= '<p style="margin: 0 0 8px;">' . $text( $line ) . '</p>';
				}
				$html .= '</div>';
			}
		}
		return $html . '</div>';
	}

	/**
	 * The withdrawal information as plain text, laid out like WooCommerce's plain e-mails.
	 *
	 * @param array<int,array{heading:string,paragraphs:string[],form?:string[]}> $sections Sections.
	 */
	private static function withdrawal_plain( array $sections ): string {
		$text = '';
		foreach ( $sections as $section ) {
			$text .= "\n----------------------------------------\n\n" . wc_strtoupper( $section['heading'] ) . "\n\n";
			$text .= implode( "\n\n", array_merge( $section['paragraphs'], $section['form'] ?? array() ) ) . "\n";
		}
		return $text;
	}
}
