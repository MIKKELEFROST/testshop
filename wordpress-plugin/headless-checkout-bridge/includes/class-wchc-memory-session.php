<?php
/**
 * In-memory WooCommerce session used while building a cart inside a REST request.
 *
 * WooCommerce's cart, customer and notices all live in the session. For server-to-server
 * requests we need a fresh, isolated guest session that is never persisted to the
 * database and never sets cookies.
 *
 * @package HeadlessCheckoutBridge
 */

defined( 'ABSPATH' ) || exit;

/**
 * Non-persistent session handler.
 */
class WCHC_Memory_Session extends WC_Session_Handler {

	/**
	 * Start an empty guest session without hooks or cookies.
	 */
	public function init() {
		$this->_customer_id = 't_' . wp_generate_password( 30, false );
		$this->_data        = array();
		$this->_dirty       = false;
	}

	/**
	 * Treat the session as active so WooCommerce never tries to start a cookie session.
	 *
	 * @return bool
	 */
	public function has_session() {
		return true;
	}

	/**
	 * Return the in-memory data.
	 *
	 * @return array
	 */
	public function get_session_data() {
		return $this->_data;
	}

	/**
	 * Never read sessions from the database.
	 *
	 * @param string $customer_id   Customer ID.
	 * @param mixed  $default_value Default.
	 * @return mixed
	 */
	public function get_session( $customer_id, $default_value = false ) {
		return $default_value;
	}

	/**
	 * Never persist.
	 *
	 * @param string|mixed $old_session_key Unused.
	 */
	public function save_data( $old_session_key = '' ) {
		$this->_dirty = false;
	}

	/**
	 * Never set cookies.
	 *
	 * @param bool $set Unused.
	 */
	public function set_customer_session_cookie( $set ) {}

	/**
	 * Never set cookies.
	 */
	public function maybe_set_customer_session_cookie() {}

	/**
	 * Clear in-memory data only.
	 */
	public function destroy_session() {
		$this->_data = array();
	}

	/**
	 * Clear in-memory data only.
	 */
	public function forget_session() {
		$this->_data = array();
	}

	/**
	 * Never touch the sessions table.
	 *
	 * @param string $customer_id Unused.
	 */
	public function delete_session( $customer_id ) {}

	/**
	 * Never touch the sessions table.
	 *
	 * @param string $customer_id Unused.
	 * @param int    $timestamp   Unused.
	 */
	public function update_session_timestamp( $customer_id, $timestamp ) {}
}
