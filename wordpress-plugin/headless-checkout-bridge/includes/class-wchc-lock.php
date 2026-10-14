<?php
/**
 * Database-level named locks (MySQL/MariaDB GET_LOCK) used to serialise concurrent
 * requests for the same checkout session or order.
 *
 * @package HeadlessCheckoutBridge
 */

defined( 'ABSPATH' ) || exit;

/**
 * Named lock helper.
 */
final class WCHC_Lock {

	/**
	 * Locks held by this request.
	 *
	 * @var array<string,bool>
	 */
	private static $held = array();

	/**
	 * Acquire a named lock, waiting up to $timeout seconds.
	 *
	 * @param string $name    Logical lock name.
	 * @param int    $timeout Seconds to wait.
	 * @return bool True when the lock was acquired.
	 */
	public static function acquire( string $name, int $timeout = 10 ): bool {
		global $wpdb;

		$key = self::key( $name );
		if ( isset( self::$held[ $key ] ) ) {
			return true;
		}

		$result = $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, %d)', $key, $timeout ) );
		if ( '1' === (string) $result ) {
			self::$held[ $key ] = true;
			return true;
		}

		return false;
	}

	/**
	 * Release a named lock.
	 *
	 * @param string $name Logical lock name.
	 */
	public static function release( string $name ): void {
		global $wpdb;

		$key = self::key( $name );
		if ( ! isset( self::$held[ $key ] ) ) {
			return;
		}

		$wpdb->query( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $key ) );
		unset( self::$held[ $key ] );
	}

	/**
	 * Build a server-wide unique lock key (max 64 chars in MySQL).
	 *
	 * @param string $name Logical lock name.
	 */
	private static function key( string $name ): string {
		global $wpdb;

		return 'wchc_' . substr( hash( 'sha256', DB_NAME . '|' . $wpdb->prefix . '|' . $name ), 0, 48 );
	}
}
