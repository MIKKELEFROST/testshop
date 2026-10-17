<?php
/**
 * Capture at shipment (since 1.5).
 *
 * A card may as a rule only be charged when the goods are sent. The storefront therefore creates
 * its Stripe PaymentIntents with manual capture: when the customer pays, the amount is only
 * authorized (reserved), and it is captured when the shop marks the order "Completed".
 *
 * - Authorized (event `authorized`): the order is to be sent, so it goes to processing (since 1.6;
 *   core reduces stock once and sends the customer's processing e-mail and "New order"),
 *   WCHC_META_CAPTURE_STATUS = authorized. Nothing is paid: no transaction ID, no date paid,
 *   although core counts processing as paid. A payment still processing at Stripe keeps the order
 *   on-hold until it is authorized. An order the shop holds itself, or has moved on to processing
 *   or completed while the payment was processing, keeps the status the shop gave it.
 * - Completed: this plugin tells the storefront that created the order (the callback URL and a
 *   per-order token it sent with the authorization). The storefront re-reads the order, captures
 *   the PaymentIntent in Stripe and reports it (event `succeeded`): transaction ID, date paid,
 *   note. A failed capture (event `capture_failed`, or the reservation expired) puts the order
 *   back on-hold, with a note and an e-mail to the shop.
 * - On-hold is for what needs clarifying: the shop's own holds (nothing happens to the payment;
 *   back to processing neither) and payment problems. Orders reserved on-hold before 1.6 are
 *   captured and released the same way.
 * - Cancelled, refunded or failed before that: the storefront cancels the PaymentIntent (event
 *   `canceled`): the reservation is released. Core restores the stock as usual.
 * - Expired in Stripe (event `canceled` while the order waits to be sent): on-hold (when it was
 *   processing), note and e-mail.
 * - Collected another way (the reservation expired, was released or keeps being declined): the
 *   order action "Betalingen er klaret uden om webshoppen" (capture status manual) lets the shop
 *   keep the order completed.
 * - Safety net: the storefront's daily job calls POST /payments/sweep, which lists the orders
 *   still to capture or release and warns about reservations older than five days and sent
 *   orders still not captured a day later.
 *
 * The storefront never trusts a callback: it is only a hint to look at the order. Orders without
 * WCHC_META_CAPTURE_STATUS (paid at once, before 1.5) are never touched.
 *
 * @package HeadlessCheckoutBridge
 */

defined( 'ABSPATH' ) || exit;

/**
 * Authorize now, capture when sent.
 */
final class WCHC_Capture {

	/** Order statuses that end an order without sending it: the reservation is released. */
	const RELEASE_STATUSES = array( 'cancelled', 'refunded', 'failed' );

	/** Capture statuses where Stripe may still hold the customer's money for the order. */
	const HELD = array( 'authorized', 'failed' );

	/** Capture statuses where the payment is done: captured, or collected by the shop another way (manual). */
	const SETTLED = array( 'captured', 'manual' );

	/** Capture statuses after which the shop may collect the payment another way. */
	const NOT_CAPTURED = array( 'failed', 'expired', 'released' );

	/**
	 * Orders whose storefront is told at the end of this request.
	 *
	 * @var int[]
	 */
	private static $queue = array();

	/**
	 * Whether the e-mail being built is a reserved order's on-hold e-mail (its intro is replaced).
	 *
	 * @var bool
	 */
	private static $reserved_intro = false;

	/**
	 * Register hooks.
	 */
	public static function init(): void {
		add_action( 'woocommerce_order_status_changed', array( __CLASS__, 'status_changed' ), 20, 4 );
		add_filter( 'woocommerce_order_actions', array( __CLASS__, 'order_actions' ), 10, 2 );
		add_action( 'woocommerce_order_action_wchc_settle_payment', array( __CLASS__, 'queue' ) );
		add_action( 'woocommerce_order_action_wchc_payment_handled', array( __CLASS__, 'payment_handled' ) );

		// Before WooCommerce's order table (10), in the customer's and the shop's e-mails.
		add_action( 'woocommerce_email_order_details', array( __CLASS__, 'payment_notice' ), 5, 4 );
		add_filter( 'woocommerce_email_format_string', array( __CLASS__, 'begin_email' ), 10, 2 );
		add_action( 'woocommerce_email_sent', array( __CLASS__, 'end_email' ), PHP_INT_MAX, 0 );
		add_filter( 'woocommerce_email_enabled_customer_processing_order', array( __CLASS__, 'confirmation_enabled' ), 10, 2 );
		add_action( 'woocommerce_email_sent', array( __CLASS__, 'confirmation_sent' ), 10, 3 );
	}

	/**
	 * The order's capture status: authorized, captured, failed, expired, released, manual (collected
	 * another way), or '' (an order paid at once, before 1.5).
	 *
	 * @param WC_Order $order Order.
	 */
	public static function status( WC_Order $order ): string {
		return (string) $order->get_meta( WCHC_META_CAPTURE_STATUS );
	}

	/**
	 * What is captured when the order is sent: its total less refunds made before (e.g. an item
	 * that could not be sent), in the order currency.
	 *
	 * @param WC_Order $order Order.
	 */
	private static function capture_amount( WC_Order $order ): float {
		return max( 0.0, (float) $order->get_total() - (float) $order->get_total_refunded() );
	}

	/**
	 * Amount in minor units.
	 *
	 * @param float $amount   Amount.
	 * @param int   $exponent Currency exponent.
	 */
	private static function minor( float $amount, int $exponent ): int {
		return (int) round( $amount * pow( 10, $exponent ) );
	}

	/**
	 * Amount as the shop shows it, e.g. "547,00 kr.", for notes and e-mails.
	 *
	 * @param WC_Order $order  Order.
	 * @param float    $amount Amount.
	 */
	private static function money( WC_Order $order, float $amount ): string {
		return html_entity_decode( wp_strip_all_tags( wc_price( $amount, array( 'currency' => $order->get_currency() ) ) ), ENT_QUOTES, 'UTF-8' );
	}

	/**
	 * The authorized payment for the order summary, or null.
	 *
	 * @param WC_Order $order Order.
	 * @return array<string,mixed>|null
	 */
	public static function summary( WC_Order $order ): ?array {
		$status = self::status( $order );
		if ( '' === $status ) {
			return null;
		}
		$authorized = (int) $order->get_meta( WCHC_META_AUTHORIZED_AT );
		return array(
			'status'        => $status,
			'amount'        => wc_format_decimal( self::capture_amount( $order ), wc_get_price_decimals() ),
			'authorized_at' => $authorized > 0 ? gmdate( DATE_ATOM, $authorized ) : null,
			// Failed captures so far: a new attempt (the shop completes the order again) is a new capture request.
			'attempt'       => (int) $order->get_meta( WCHC_META_CAPTURE_ATTEMPT ),
		);
	}

	/**
	 * The storefront's callback for an order, as sent with the authorization: an https URL (http
	 * only where the filter allows it, e.g. a local test shop) and its token for this order.
	 *
	 * @param mixed $url   URL.
	 * @param mixed $token Token.
	 * @return array{url:string,token:string}|null
	 */
	public static function sanitize_callback( $url, $token ): ?array {
		if ( ! is_string( $url ) || ! is_string( $token ) || strlen( $url ) > 500 || ! preg_match( '/^[A-Za-z0-9_-]{43}$/', $token ) ) {
			return null;
		}
		$schemes = apply_filters( 'wchc_allow_insecure_settle_url', false, $url ) ? array( 'https', 'http' ) : array( 'https' );
		if ( esc_url_raw( $url, $schemes ) !== $url || '' === (string) wp_parse_url( $url, PHP_URL_HOST ) ) {
			return null;
		}
		return array(
			'url'   => $url,
			'token' => $token,
		);
	}

	/**
	 * The payment was authorized: the order is to be sent (processing), without marking it paid.
	 *
	 * Called under the order lock. Reports from the webhook and the return page are applied once.
	 *
	 * @param WC_Order $order   Order.
	 * @param array    $input   Event input (amount_minor: the amount Stripe can capture).
	 * @param string   $current Currently attached PaymentIntent.
	 * @return array{status:int,body:array<string,mixed>}
	 */
	public static function authorize( WC_Order $order, array $input, string $current ): array {
		$intent_id = $input['payment_intent_id'];

		if ( '' !== self::status( $order ) && $current === $intent_id ) {
			// Also once the shop has put it on-hold or sent it.
			return WCHC_Orders::result( 'already_authorized', $order );
		}
		// The order went on-hold for this payment while it was "processing" at Stripe. Meanwhile the shop
		// may have moved it on to processing or completed: the reservation is still its payment, unless
		// a payment was recorded.
		$awaited  = $current === $intent_id && $order->get_meta( WCHC_META_PAYMENT_PROCESSING ) === $intent_id;
		$moved_on = $awaited && '' === $order->get_transaction_id() && $order->has_status( array( 'processing', 'completed' ) );
		// is_paid(): processing or completed. An order reserved by this payment returned above.
		if ( ! $moved_on && ( $current !== $intent_id || $order->is_paid() || $order->has_status( array( 'completed', 'refunded' ) ) ) ) {
			// A reservation on a replaced PaymentIntent, or for an order paid otherwise: never keep it.
			$order->add_order_note( sprintf( 'Reservation %s hører ikke til ordrens betaling – den frigives.', $intent_id ) );
			return WCHC_Orders::result( 'release_required', $order );
		}

		$expected = self::minor( (float) $order->get_total(), (int) $input['currency_exponent'] );
		if ( strtolower( $order->get_currency() ) !== $input['currency'] || $expected !== (int) $input['amount_minor'] ) {
			$order->add_order_note(
				sprintf(
					'ADVARSEL: Reserveret beløb (%d %s) matcher ikke ordretotalen (%d %s). Kræver manuel kontrol.',
					(int) $input['amount_minor'],
					strtoupper( $input['currency'] ),
					$expected,
					$order->get_currency()
				)
			);
			return WCHC_Orders::response( 409, array( 'code' => 'amount_mismatch', 'message' => 'Beløbet matcher ikke ordren.', 'order' => WCHC_Orders::summary( $order ) ) );
		}

		if ( ! $moved_on && ! $order->has_status( array( 'pending', 'failed', 'on-hold', 'cancelled' ) ) ) {
			return WCHC_Orders::result( 'ignored', $order );
		}

		// As for a payment: the stock hold may have expired and the items been sold meanwhile.
		if ( $order->has_status( array( 'pending', 'failed', 'cancelled' ) ) && ! WCHC_Orders::stock_available_for( $order ) ) {
			$note = sprintf( 'Betaling %s reserveret, men varerne er ikke længere på lager – reservationen frigives.', $intent_id );
			if ( $order->has_status( 'cancelled' ) ) {
				$order->add_order_note( $note );
			} else {
				$order->update_status( 'cancelled', $note );
			}
			return WCHC_Orders::result( 'release_required', $order );
		}

		WCHC_Orders::set_payment_method_title( $order, $input );
		$order->update_meta_data( WCHC_META_CAPTURE_STATUS, 'authorized' );
		$order->update_meta_data( WCHC_META_AUTHORIZED_AT, time() );
		$callback = self::sanitize_callback( $input['settle_url'] ?? null, $input['settle_token'] ?? null );
		if ( $callback ) {
			$order->update_meta_data( WCHC_META_SETTLE_CALLBACK, $callback );
		}

		$note = sprintf( 'Betalingen er reserveret og trækkes, når ordren sendes (%s, %s). Markér ordren som Gennemført, når den er sendt.', self::money( $order, (float) $order->get_total() ), $intent_id );
		if ( $moved_on || ( $order->has_status( 'on-hold' ) && ! $awaited ) ) {
			// The status the shop gave the order stays (its stock was reduced then): on-hold it holds
			// (e.g. set while the customer paid), or processing or completed while the payment was
			// processing. Not paid: core's date paid on processing and completed is cleared, and a sent
			// order is captured now.
			$sent = $order->has_status( 'completed' );
			$order->set_date_paid( null );
			$order->save();
			$order->add_order_note( $sent ? sprintf( 'Betalingen er reserveret (%s, %s). Ordren er allerede markeret Gennemført, så beløbet trækkes nu.', self::money( $order, (float) $order->get_total() ), $intent_id ) : $note );
			if ( $sent ) {
				self::queue( $order );
			}
			return WCHC_Orders::result( 'authorized', $order );
		}
		if ( $order->has_status( 'cancelled' ) ) {
			$order->add_order_note( 'Betalingen blev reserveret, efter at ordren var annulleret. Varerne er stadig på lager – ordren genåbnes.' );
		}
		// Processing: to be sent. Core reduces stock once (not again when the order went on-hold because
		// the payment was "processing" first), releases the hold and sends the customer's processing
		// e-mail and "New order" (once). Core also sets the date paid on processing: it is cleared before
		// the order is saved, so the status hooks and e-mails see it as it is, not paid.
		$order->set_status( 'processing', $note );
		$order->set_date_paid( null );
		$order->save();

		return WCHC_Orders::result( 'authorized', $order );
	}

	/**
	 * The authorized payment was captured: record it as paid.
	 *
	 * @param WC_Order $order Order.
	 * @param array    $input Event input (amount_minor: the amount received).
	 * @return array{status:int,body:array<string,mixed>}
	 */
	public static function record_capture( WC_Order $order, array $input ): array {
		$intent_id = $input['payment_intent_id'];

		if ( 'captured' === self::status( $order ) ) {
			return WCHC_Orders::result( $order->get_meta( WCHC_META_REFUND_REQUIRED ) === $intent_id ? 'refund_required' : 'already_paid', $order );
		}

		$expected = self::minor( self::capture_amount( $order ), (int) $input['currency_exponent'] );
		if ( strtolower( $order->get_currency() ) !== $input['currency'] || $expected !== (int) $input['amount_minor'] ) {
			$order->add_order_note(
				sprintf(
					'ADVARSEL: Trukket beløb (%d %s) matcher ikke ordrens beløb (%d %s). Kræver manuel kontrol.',
					(int) $input['amount_minor'],
					strtoupper( $input['currency'] ),
					$expected,
					$order->get_currency()
				)
			);
			return WCHC_Orders::response( 409, array( 'code' => 'amount_mismatch', 'message' => 'Beløbet matcher ikke ordren.', 'order' => WCHC_Orders::summary( $order ) ) );
		}

		$order->update_meta_data( WCHC_META_CAPTURE_STATUS, 'captured' );
		if ( $order->has_status( self::RELEASE_STATUSES ) ) {
			// Captured although the order was cancelled meanwhile: the customer gets the money back.
			$order->update_meta_data( WCHC_META_REFUND_REQUIRED, $intent_id );
			$order->save();
			$order->add_order_note( sprintf( 'Betalingen %s blev trukket, men ordren er annulleret – beløbet refunderes.', $intent_id ) );
			return WCHC_Orders::result( 'refund_required', $order );
		}

		WCHC_Orders::set_payment_method_title( $order, $input );
		$note = sprintf( 'Betalingen er trukket: %s (%s).', self::money( $order, self::capture_amount( $order ) ), $intent_id );
		if ( $order->has_status( array( 'on-hold', 'pending' ) ) ) {
			// Captured before the order was sent (e.g. in Stripe's Dashboard): paid, to be sent.
			$order->save();
			$order->payment_complete( $intent_id );
		} else {
			// Sent (completed), or to be sent (processing, e.g. captured in Stripe's Dashboard): core's
			// payment_complete() would not record it. Paid now, not when core set the date at an earlier
			// completion.
			$order->set_transaction_id( $intent_id );
			$order->set_date_paid( time() );
			$order->save();
		}
		$order->add_order_note( $note );

		return WCHC_Orders::result( 'paid', wc_get_order( $order->get_id() ) );
	}

	/**
	 * Other events for an order whose payment was authorized (called under the order lock with
	 * the order's current PaymentIntent).
	 *
	 * @param WC_Order $order Order.
	 * @param array    $input Event input.
	 * @return array{status:int,body:array<string,mixed>}
	 */
	public static function apply_event( WC_Order $order, array $input ): array {
		$status = self::status( $order );
		$reason = '' !== $input['message'] ? $input['message'] : 'ukendt årsag';

		if ( 'capture_failed' === $input['event'] ) {
			if ( in_array( $status, self::SETTLED, true ) || ! $order->has_status( 'completed' ) ) {
				// Already back on-hold (reported by the webhook and the storefront), not sent, or paid.
				return WCHC_Orders::result( 'ignored', $order );
			}
			return self::fail_capture( $order, $reason, 'failed' );
		}

		if ( 'canceled' !== $input['event'] || in_array( $status, self::SETTLED, true ) ) {
			// "processing" and "failed" do not happen to an authorized payment; a reservation left
			// after the shop collected the payment another way may expire.
			return WCHC_Orders::result( 'ignored', $order );
		}

		if ( $order->has_status( 'completed' ) ) {
			// Sent, but Stripe holds nothing to capture (also when it expired before it was sent).
			return self::fail_capture( $order, sprintf( 'reservationen er udløbet eller annulleret i Stripe (%s)', $reason ), 'expired' );
		}

		if ( ! in_array( $status, self::HELD, true ) ) {
			// Released or expired before: reported again.
			return WCHC_Orders::result( 'ignored', $order );
		}

		if ( $order->has_status( self::RELEASE_STATUSES ) ) {
			$order->update_meta_data( WCHC_META_CAPTURE_STATUS, 'released' );
			$order->save();
			$order->add_order_note( sprintf( 'Reservationen på %s er frigivet (%s). Kunden betaler ikke for ordren.', self::money( $order, (float) $order->get_total() ), $input['payment_intent_id'] ) );
			return WCHC_Orders::result( 'released', $order );
		}

		// Not sent yet: Stripe let the reservation expire (normally after 7 days). An order waiting to be
		// sent (processing) now needs clarifying: on-hold. One already on-hold stays as it is.
		$order->update_meta_data( WCHC_META_CAPTURE_STATUS, 'expired' );
		$hold    = $order->has_status( 'processing' );
		$message = sprintf( 'Reservationen er udløbet eller annulleret i Stripe (%s). Beløbet kan ikke længere trækkes.%s Kontakt kunden om betalingen, før ordren sendes, eller annullér ordren.', $reason, $hold ? ' Ordren er sat på hold.' : '' );
		if ( $hold ) {
			$order->update_status( 'on-hold', $message );
		} else {
			$order->save();
			$order->add_order_note( $message );
		}
		self::mail_admin( $order, sprintf( 'Reservationen for ordre #%s er udløbet', $order->get_order_number() ), array( $message ) );
		return WCHC_Orders::result( 'reservation_expired', $order );
	}

	/**
	 * The order was sent, but its payment could not be captured: back on-hold, note and e-mail.
	 *
	 * @param WC_Order $order  Order.
	 * @param string   $reason Why.
	 * @param string   $status New capture status (failed, or expired when Stripe holds nothing).
	 * @return array{status:int,body:array<string,mixed>}
	 */
	private static function fail_capture( WC_Order $order, string $reason, string $status ): array {
		if ( in_array( self::status( $order ), self::HELD, true ) ) {
			$order->update_meta_data( WCHC_META_CAPTURE_STATUS, $status );
		}
		$order->update_meta_data( WCHC_META_CAPTURE_ATTEMPT, (int) $order->get_meta( WCHC_META_CAPTURE_ATTEMPT ) + 1 );
		// Core set the date paid when the order was completed: nothing is paid.
		$order->set_date_paid( null );
		$next    = 'failed' === self::status( $order )
			? 'Markér ordren Gennemført igen for et nyt forsøg. Har kunden betalt på anden vis, så vælg "Betalingen er klaret uden om webshoppen" under Ordrehandlinger.'
			: 'Reservationen kan ikke trækkes. Når kunden har betalt på anden vis, så vælg "Betalingen er klaret uden om webshoppen" under Ordrehandlinger, og markér derefter ordren Gennemført.';
		$message = sprintf( 'Betalingen kunne ikke trækkes: %s. Ordren er sat tilbage til På hold. Kontakt kunden om betalingen. %s', $reason, $next );
		$order->update_status( 'on-hold', $message );
		self::mail_admin( $order, sprintf( 'Betalingen for ordre #%s kunne ikke trækkes', $order->get_order_number() ), array( $message ) );
		return WCHC_Orders::result( 'capture_failed', $order );
	}

	/**
	 * What the storefront should do with the order's reservation now: capture (sent), release
	 * (ended without being sent) or nothing.
	 *
	 * @param WC_Order $order Order.
	 */
	public static function settle_action( WC_Order $order ): ?string {
		$status = self::status( $order );
		if ( $order->has_status( 'completed' ) && '' !== $status && ! in_array( $status, self::SETTLED, true ) ) {
			// Also when nothing is held any more: the order goes back on-hold, as it is not paid.
			return 'capture';
		}
		if ( $order->has_status( self::RELEASE_STATUSES ) && in_array( $status, self::HELD, true ) ) {
			return 'release';
		}
		return null;
	}

	/**
	 * The shop changed the order's status: completed captures, cancelled/refunded/failed releases.
	 * On-hold and processing leave the reservation as it is.
	 *
	 * @param int      $order_id Order ID.
	 * @param string   $from     Old status.
	 * @param string   $to       New status.
	 * @param WC_Order $order    Order.
	 */
	public static function status_changed( $order_id, $from, $to, $order ): void {
		if ( ! $order instanceof WC_Order ) {
			return;
		}
		$status = self::status( $order );
		if ( in_array( $to, array( 'processing', 'completed' ), true ) && '' !== $status && ! in_array( $status, self::SETTLED, true ) && $order->get_date_paid( 'edit' ) ) {
			// Core sets the date paid on Processing and Completed (e.g. the shop moves an order reserved
			// on-hold before 1.6, or one whose reservation expired, to Processing); it is paid when the
			// capture is recorded or the shop has collected it another way.
			$order->set_date_paid( null );
			$order->save();
		}
		if ( self::settle_action( $order ) ) {
			self::queue( $order );
		}
	}

	/**
	 * Tell the order's storefront at the end of this request, after WooCommerce has saved the order.
	 *
	 * @param WC_Order $order Order.
	 */
	public static function queue( $order ): void {
		if ( ! $order instanceof WC_Order ) {
			return;
		}
		if ( ! self::$queue ) {
			add_action( 'shutdown', array( __CLASS__, 'send_queued' ) );
		}
		self::$queue[] = $order->get_id();
	}

	/**
	 * Send the queued orders to their storefronts, one request per storefront. The storefront
	 * answers at once and captures or releases afterwards; it reports the result as a payment
	 * event. What cannot be sent is noted: the storefront's daily job settles it.
	 */
	public static function send_queued(): void {
		$groups = array();
		foreach ( array_unique( self::$queue ) as $order_id ) {
			$order  = WCHC_Orders::load_fresh( $order_id );
			$action = $order ? self::settle_action( $order ) : null;
			if ( ! $action ) {
				continue;
			}
			if ( 'capture' === $action && ! in_array( self::status( $order ), self::HELD, true ) ) {
				// Stripe holds nothing for it any more (expired or released before): nothing to ask.
				self::fail_unheld( $order_id );
				continue;
			}
			$saved    = (array) $order->get_meta( WCHC_META_SETTLE_CALLBACK );
			$callback = self::sanitize_callback( $saved['url'] ?? null, $saved['token'] ?? null );
			if ( ! $callback ) {
				$order->add_order_note( 'Webshoppen har ikke oplyst en adresse til betalingen. Den trækkes eller frigives ved webshoppens daglige kørsel.' );
				continue;
			}
			$groups[ $callback['url'] ][] = array(
				'order' => $order,
				'body'  => array(
					'id'        => $order->get_id(),
					'order_key' => $order->get_order_key(),
					'token'     => $callback['token'],
				),
			);
		}
		self::$queue = array();

		// A few orders per request: the storefront settles each request's orders within its time limit.
		foreach ( $groups as $url => $group ) {
			foreach ( array_chunk( $group, 10 ) as $items ) {
				self::send( $url, $items );
			}
		}
	}

	/**
	 * A sent order whose reservation has expired or was released: back on-hold, note and e-mail.
	 *
	 * @param int $order_id Order ID.
	 */
	private static function fail_unheld( int $order_id ): void {
		$lock = 'order:' . $order_id;
		if ( ! WCHC_Lock::acquire( $lock, 5 ) ) {
			// Busy (e.g. a payment event): the order is not moved, but the shop is told (a note needs no lock).
			$order = WCHC_Orders::load_fresh( $order_id );
			if ( $order && 'capture' === self::settle_action( $order ) && ! in_array( self::status( $order ), self::HELD, true ) ) {
				$message = 'Betalingen kan ikke trækkes: reservationen er udløbet eller frigivet. Ordren er ikke betalt, kontakt kunden. Når kunden har betalt på anden vis, så vælg "Betalingen er klaret uden om webshoppen" under Ordrehandlinger.';
				$order->add_order_note( $message );
				self::mail_admin( $order, sprintf( 'Betalingen for ordre #%s kunne ikke trækkes', $order->get_order_number() ), array( $message ) );
			}
			return;
		}
		try {
			$order = WCHC_Orders::load_fresh( $order_id );
			if ( $order && 'capture' === self::settle_action( $order ) && ! in_array( self::status( $order ), self::HELD, true ) ) {
				self::fail_capture( $order, 'reservationen er udløbet eller frigivet, så der er intet at trække', self::status( $order ) );
			}
		} finally {
			WCHC_Lock::release( $lock );
		}
	}

	/**
	 * Send orders to their storefront and note those it did not accept.
	 *
	 * @param string $url   Callback URL.
	 * @param array  $items Orders (order, body).
	 */
	private static function send( string $url, array $items ): void {
		$response = wp_safe_remote_post(
			$url,
			array(
				'timeout'     => 10,
				// E.g. the apex domain redirecting to www: 301/307/308 keep the POST and its body
				// (a 302 becomes a GET, which the storefront refuses); every hop is validated.
				'redirection' => 2,
				'user-agent'  => 'Headless Checkout Bridge/' . WCHC_VERSION,
				'headers'     => array( 'Content-Type' => 'application/json' ),
				'body'        => (string) wp_json_encode( array( 'orders' => wp_list_pluck( $items, 'body' ) ) ),
			)
		);
		$code     = is_wp_error( $response ) ? 0 : (int) wp_remote_retrieve_response_code( $response );
		$answer   = is_wp_error( $response ) ? null : json_decode( (string) wp_remote_retrieve_body( $response ), true );
		$accepted = $code >= 200 && $code < 300 && is_array( $answer ) ? array_map( 'intval', (array) ( $answer['accepted'] ?? array() ) ) : array();
		$problem  = is_wp_error( $response ) ? $response->get_error_message() : 'HTTP ' . $code;
		foreach ( $items as $item ) {
			if ( ! in_array( $item['order']->get_id(), $accepted, true ) ) {
				$item['order']->add_order_note( sprintf( 'Webshoppen kunne ikke få besked om betalingen (%s). Den trækkes eller frigives ved webshoppens daglige kørsel, eller vælg "Træk eller frigiv betalingen nu" under Ordrehandlinger.', $problem ) );
			}
		}
	}

	/**
	 * Order actions: "Træk eller frigiv betalingen nu" when there is something to do, and
	 * "Betalingen er klaret uden om webshoppen" when the reservation can no longer be captured.
	 *
	 * @param array<string,string> $actions Actions.
	 * @param mixed                $order   Order.
	 * @return array<string,string>
	 */
	public static function order_actions( $actions, $order = null ) {
		if ( ! is_array( $actions ) || ! $order instanceof WC_Order ) {
			return $actions;
		}
		if ( self::settle_action( $order ) ) {
			$actions['wchc_settle_payment'] = 'Træk eller frigiv betalingen nu';
		}
		if ( in_array( self::status( $order ), self::NOT_CAPTURED, true ) ) {
			$actions['wchc_payment_handled'] = 'Betalingen er klaret uden om webshoppen';
		}
		return $actions;
	}

	/**
	 * The shop collected the payment another way (the reservation expired, was released or keeps
	 * being declined): capture status manual, so completing the order no longer sends it back
	 * on-hold. A reservation Stripe may still hold expires by itself.
	 *
	 * @param mixed $order Order.
	 */
	public static function payment_handled( $order ): void {
		if ( ! $order instanceof WC_Order ) {
			return;
		}
		$lock = 'order:' . $order->get_id();
		if ( ! WCHC_Lock::acquire( $lock, 15 ) ) {
			$order->add_order_note( 'Betalingen kunne ikke markeres som klaret, fordi ordren var optaget. Prøv igen.' );
			return;
		}
		try {
			$fresh = WCHC_Orders::load_fresh( $order->get_id() );
			if ( ! $fresh || ! in_array( self::status( $fresh ), self::NOT_CAPTURED, true ) ) {
				return;
			}
			$fresh->update_meta_data( WCHC_META_CAPTURE_STATUS, 'manual' );
			$fresh->save();
			$user = wp_get_current_user();
			$fresh->add_order_note( sprintf( 'Betalingen er markeret som klaret uden om webshoppen (af %s). Ordren kan nu markeres Gennemført.', $user->exists() ? $user->display_name : 'ukendt bruger' ) );
		} finally {
			WCHC_Lock::release( $lock );
		}
	}

	/**
	 * The storefront's daily job: the orders of a webshop to capture or release, and a warning
	 * (note and one e-mail) about reservations that will soon expire before the order is sent, and
	 * about sent orders whose payment is still not captured a day later (e.g. the storefront's
	 * capture keeps failing): the shop should not first hear of them when the reservation expires.
	 *
	 * @param string $store_id Store ID.
	 * @param int    $limit    Most orders listed.
	 * @return array{settle:array<int,array<string,mixed>>,warned:int[]}
	 */
	public static function sweep( string $store_id, int $limit = 50 ): array {
		$days   = max( 1, (int) apply_filters( 'wchc_reservation_warn_days', 5 ) );
		$before = time() - $days * DAY_IN_SECONDS;
		$settle = array();
		$warned = array();
		$late   = array();
		foreach ( self::held_order_ids( $store_id, 500 ) as $order_id ) {
			$order = wc_get_order( $order_id );
			if ( ! $order instanceof WC_Order ) {
				continue;
			}
			$action = self::settle_action( $order );
			if ( $action ) {
				if ( count( $settle ) < $limit ) {
					$settle[] = array(
						'id'        => $order->get_id(),
						'order_key' => $order->get_order_key(),
						'action'    => $action,
					);
				}
				if ( self::capture_late( $order ) && self::warn_late( $order_id ) ) {
					$late[] = $order->get_id();
				}
				continue;
			}
			$authorized = (int) $order->get_meta( WCHC_META_AUTHORIZED_AT );
			if ( 'authorized' === self::status( $order ) && $authorized > 0 && $authorized < $before && ! $order->get_meta( WCHC_META_RESERVATION_WARNED ) && self::warn( $order_id, $days ) ) {
				$warned[] = $order->get_id();
			}
		}
		if ( $warned || $late ) {
			$lines = array();
			if ( $late ) {
				$lines[] = 'Disse ordrer er sendt for mere end et døgn siden, men betalingen er endnu ikke trukket. Den daglige kørsel prøver igen; vælg "Træk eller frigiv betalingen nu" under Ordrehandlinger på ordren, eller kontakt udvikleren:';
				foreach ( array_map( 'wc_get_order', $late ) as $order ) {
					$lines[] = sprintf( 'Ordre #%s (%s), sendt %s', $order->get_order_number(), self::money( $order, self::capture_amount( $order ) ), wp_date( 'j. F Y', $order->get_date_completed()->getTimestamp() ) );
				}
			}
			if ( $warned ) {
				$lines[] = sprintf( 'Disse ordrer har ventet mere end %d dage på at blive sendt. Betalingen er kun reserveret, og reservationen udløber normalt efter 7 dage. Send dem, og markér dem som Gennemført – ellers kan beløbet ikke trækkes:', $days );
				foreach ( array_map( 'wc_get_order', $warned ) as $order ) {
					$lines[] = sprintf( 'Ordre #%s (%s), reserveret %s', $order->get_order_number(), self::money( $order, (float) $order->get_total() ), wp_date( 'j. F Y', (int) $order->get_meta( WCHC_META_AUTHORIZED_AT ) ) );
				}
			}
			$orders = array_map( 'wc_get_order', array_merge( $late, $warned ) );
			if ( count( $orders ) > 1 ) {
				$subject = $late ? sprintf( '%d ordrer venter på betalingen', count( $orders ) ) : sprintf( '%d reservationer udløber snart', count( $orders ) );
			} else {
				$subject = $late ? sprintf( 'Betalingen for ordre #%s er ikke trukket', $orders[0]->get_order_number() ) : sprintf( 'Reservationen for ordre #%s udløber snart', $orders[0]->get_order_number() );
			}
			self::mail_admin( $orders[0], $subject, $lines );
		}
		return array(
			'settle' => $settle,
			'warned' => array_merge( $late, $warned ),
		);
	}

	/**
	 * A sent order whose payment is still to be captured more than a day after it was completed,
	 * not warned about for this attempt yet.
	 *
	 * @param WC_Order $order Order.
	 */
	private static function capture_late( WC_Order $order ): bool {
		$completed = $order->get_date_completed();
		$warned    = $order->get_meta( WCHC_META_CAPTURE_LATE_WARNED );
		return 'capture' === self::settle_action( $order )
			&& $completed && $completed->getTimestamp() < time() - DAY_IN_SECONDS
			&& ( '' === $warned || (int) $warned !== (int) $order->get_meta( WCHC_META_CAPTURE_ATTEMPT ) );
	}

	/**
	 * Note on a sent order that its payment is still not captured, once per attempt (under the
	 * order lock; skipped while busy).
	 *
	 * @param int $order_id Order ID.
	 */
	private static function warn_late( int $order_id ): bool {
		$lock = 'order:' . $order_id;
		if ( ! WCHC_Lock::acquire( $lock, 0 ) ) {
			return false;
		}
		try {
			$order = WCHC_Orders::load_fresh( $order_id );
			if ( ! $order || ! self::capture_late( $order ) ) {
				return false;
			}
			$order->update_meta_data( WCHC_META_CAPTURE_LATE_WARNED, (int) $order->get_meta( WCHC_META_CAPTURE_ATTEMPT ) );
			$order->save();
			$order->add_order_note( 'Ordren er sendt, men betalingen er endnu ikke trukket. Den daglige kørsel prøver igen; vælg "Træk eller frigiv betalingen nu" under Ordrehandlinger, eller kontakt udvikleren.' );
			return true;
		} finally {
			WCHC_Lock::release( $lock );
		}
	}

	/**
	 * Note the old reservation on the order, once (under the order lock; skipped while busy).
	 *
	 * @param int $order_id Order ID.
	 * @param int $days     Days.
	 */
	private static function warn( int $order_id, int $days ): bool {
		$lock = 'order:' . $order_id;
		if ( ! WCHC_Lock::acquire( $lock, 0 ) ) {
			return false;
		}
		try {
			$order = WCHC_Orders::load_fresh( $order_id );
			if ( ! $order || 'authorized' !== self::status( $order ) || $order->get_meta( WCHC_META_RESERVATION_WARNED ) ) {
				return false;
			}
			$order->update_meta_data( WCHC_META_RESERVATION_WARNED, time() );
			$order->save();
			$order->add_order_note( sprintf( 'Betalingen har været reserveret i mere end %d dage. Reservationen udløber normalt efter 7 dage: send ordren, og markér den som Gennemført, ellers kan beløbet ikke trækkes.', $days ) );
			return true;
		} finally {
			WCHC_Lock::release( $lock );
		}
	}

	/**
	 * IDs of a webshop's orders whose payment Stripe may still hold (authorized or failed), oldest
	 * first. Direct lookup: wc_get_orders() meta query arguments differ between the order stores.
	 *
	 * @param string $store_id Store ID.
	 * @param int    $limit    Most IDs.
	 * @return int[]
	 */
	private static function held_order_ids( string $store_id, int $limit ): array {
		global $wpdb;

		$held = "'" . implode( "','", self::HELD ) . "'";
		if ( \Automattic\WooCommerce\Utilities\OrderUtil::custom_orders_table_usage_is_enabled() ) {
			$table = \Automattic\WooCommerce\Internal\DataStores\Orders\OrdersTableDataStore::get_meta_table_name();
			$sql   = "SELECT c.order_id FROM {$table} c INNER JOIN {$table} s ON s.order_id = c.order_id AND s.meta_key = %s AND s.meta_value = %s WHERE c.meta_key = %s AND c.meta_value IN ({$held}) ORDER BY c.order_id ASC LIMIT %d";
		} else {
			$sql = "SELECT c.post_id FROM {$wpdb->postmeta} c INNER JOIN {$wpdb->postmeta} s ON s.post_id = c.post_id AND s.meta_key = %s AND s.meta_value = %s WHERE c.meta_key = %s AND c.meta_value IN ({$held}) ORDER BY c.post_id ASC LIMIT %d";
		}
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- table names and the constant list only.
		return array_map( 'intval', (array) $wpdb->get_col( $wpdb->prepare( $sql, WCHC_META_STORE_ID, $store_id, WCHC_META_CAPTURE_STATUS, $limit ) ) );
	}

	/**
	 * E-mail to the shop (the "New order" recipients, else the site's admin e-mail).
	 *
	 * @param WC_Order $order      Order (its webshop and link).
	 * @param string   $subject    Subject (the webshop's name is put in front).
	 * @param string[] $paragraphs Text.
	 */
	private static function mail_admin( WC_Order $order, string $subject, array $paragraphs ): void {
		$mailer = WC()->mailer();
		$emails = $mailer->get_emails();
		$to     = isset( $emails['WC_Email_New_Order'] ) ? (string) $emails['WC_Email_New_Order']->get_recipient() : '';
		if ( '' === $to ) {
			$to = (string) get_option( 'admin_email' );
		}
		$store = WCHC_Emails::sanitize_store( $order->get_meta( WCHC_META_STORE_BRANDING ) );
		if ( isset( $store['name'] ) ) {
			$subject = '[' . $store['name'] . '] ' . $subject;
		}
		$html = '';
		foreach ( $paragraphs as $paragraph ) {
			$html .= '<p>' . esc_html( $paragraph ) . '</p>';
		}
		$html .= '<p><a href="' . esc_url( $order->get_edit_order_url() ) . '">Åbn ordre #' . esc_html( $order->get_order_number() ) . '</a></p>';
		$mailer->send( $to, $subject, $mailer->wrap_message( $subject, $html ) );
	}

	/**
	 * The payment in a reserved order's e-mails: the customer's order confirmation (processing, or
	 * on-hold for orders reserved before 1.6) and completed e-mails say that the amount is reserved
	 * and charged when the order is sent, the refund e-mails that nothing was charged; "New order"
	 * tells the shop. Nothing for a payment collected another way.
	 *
	 * @param mixed $order         Order.
	 * @param bool  $sent_to_admin Whether the e-mail goes to the shop.
	 * @param bool  $plain_text    Plain text instead of HTML.
	 * @param mixed $email         E-mail.
	 */
	public static function payment_notice( $order, $sent_to_admin = false, $plain_text = false, $email = null ): void {
		if ( ! $order instanceof WC_Order || ! $email instanceof WC_Email ) {
			return;
		}
		$status = self::status( $order );
		$amount = self::money( $order, self::capture_amount( $order ) );
		$text   = '';
		if ( 'authorized' === $status && in_array( $email->id, WCHC_Emails::CONFIRMATION_EMAILS, true ) ) {
			$text = sprintf( 'Vi har reserveret %s på dit betalingsmiddel. Beløbet trækkes først, når vi sender din ordre. Annullerer vi ordren, frigives reservationen, og du betaler ingenting.', $amount );
		} elseif ( 'authorized' === $status && 'new_order' === $email->id ) {
			$text = sprintf( 'Betalingen på %s er reserveret, ikke trukket. Markér ordren som Gennemført, når den er sendt – så trækkes beløbet. Annullér ordren, hvis den ikke skal sendes – så frigives reservationen. Reservationen udløber normalt efter 7 dage.', $amount );
		} elseif ( in_array( $status, array( 'authorized', 'captured' ), true ) && 'customer_completed_order' === $email->id ) {
			$text = 'captured' === $status ? sprintf( 'Beløbet på %s er nu trukket.', $amount ) : sprintf( 'Vi trækker nu det reserverede beløb på %s.', $amount );
		} elseif ( 'authorized' === $status && in_array( $email->id, array( 'customer_refunded_order', 'customer_partially_refunded_order' ), true ) ) {
			// WooCommerce's refund e-mail says "refunderet", but nothing was charged: the reservation shrinks.
			$text = self::capture_amount( $order ) > 0
				? sprintf( 'Beløbet er ikke trukket endnu, så der er intet at betale tilbage: vi trækker kun %s, når vi sender din ordre, og resten af reservationen frigives.', $amount )
				: 'Beløbet er ikke trukket, så reservationen frigives, og du betaler ingenting.';
		}
		if ( '' === $text ) {
			return;
		}
		// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped here; plain text is not HTML.
		echo $plain_text ? "BETALING\n\n" . $text . "\n\n" : '<div class="wchc-payment" style="margin-bottom: 24px;"><h2>Betaling</h2><p>' . esc_html( $text ) . '</p></div>';
	}

	/**
	 * WooCommerce formats a text of an e-mail (its subject comes first): for a reserved order's
	 * on-hold e-mail, replace the intro that says the order waits for the payment. (Since 1.6 a
	 * reserved order gets the processing e-mail, whose intro says nothing about the payment.)
	 *
	 * @param string $text  Formatted text.
	 * @param mixed  $email E-mail.
	 * @return string
	 */
	public static function begin_email( $text, $email ) {
		$reserved = $email instanceof WC_Email && 'customer_on_hold_order' === $email->id && $email->object instanceof WC_Order && 'authorized' === self::status( $email->object );
		if ( $reserved !== self::$reserved_intro ) {
			self::$reserved_intro = $reserved;
			if ( $reserved ) {
				add_filter( 'gettext_woocommerce', array( __CLASS__, 'reserved_intro' ), 10, 2 );
			} else {
				remove_filter( 'gettext_woocommerce', array( __CLASS__, 'reserved_intro' ), 10 );
			}
		}
		return $text;
	}

	/**
	 * The e-mail is sent.
	 */
	public static function end_email(): void {
		self::$reserved_intro = false;
		remove_filter( 'gettext_woocommerce', array( __CLASS__, 'reserved_intro' ), 10 );
	}

	/**
	 * The on-hold e-mail's intro (HTML and plain text, with and without WooCommerce's e-mail
	 * improvements) for an order that is paid by a reservation.
	 *
	 * @param string $translation Translated text.
	 * @param string $text        Original text.
	 * @return string
	 */
	public static function reserved_intro( $translation, $text ) {
		$intros = array(
			'We’ve received your order and it’s currently on hold until we can confirm your payment has been processed.',
			'Thanks for your order. It’s on-hold until we confirm that payment has been received.',
		);
		return in_array( $text, $intros, true ) ? 'Tak for din ordre. Vi har modtaget den og sender den hurtigst muligt.' : $translation;
	}

	/**
	 * The customer's processing e-mail is the order confirmation of a reserved order, sent once:
	 * not again when the shop puts the order on-hold to clarify something and back to processing.
	 * Sent on purpose (e.g. WooCommerce's order e-mail action), it goes out as always, and orders
	 * without a capture status get WooCommerce's e-mails as always.
	 *
	 * @param bool  $enabled Whether the e-mail is enabled.
	 * @param mixed $order   Order (null outside an order, e.g. in the settings).
	 * @return bool
	 */
	public static function confirmation_enabled( $enabled, $order = null ) {
		if ( $enabled && $order instanceof WC_Order && doing_action( 'woocommerce_order_status_on-hold_to_processing_notification' ) && '' !== self::status( $order ) && $order->get_meta( WCHC_META_CONFIRMATION_SENT ) ) {
			return false;
		}
		return $enabled;
	}

	/**
	 * Note on a reserved order that its processing e-mail is sent.
	 *
	 * @param bool   $sent  Whether WordPress sent it.
	 * @param string $id    E-mail ID.
	 * @param mixed  $email E-mail.
	 */
	public static function confirmation_sent( $sent, $id = '', $email = null ): void {
		if ( ! $sent || 'customer_processing_order' !== $id || ! $email instanceof WC_Email || ! $email->object instanceof WC_Order || '' === self::status( $email->object ) ) {
			return;
		}
		$email->object->update_meta_data( WCHC_META_CONFIRMATION_SENT, time() );
		$email->object->save_meta_data();
	}
}
