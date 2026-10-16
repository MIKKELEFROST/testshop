<?php
// LOCAL TEST ONLY (integration tests), never on a real shop:
// - The plugin may report sent and cancelled orders over http to the test runner on the Docker
//   host (host.docker.internal, any port), which wp_safe_remote_post() refuses otherwise.
// - E-mails are kept in the option wchc_test_mails (the last 40: to, subject, message, the
//   WooCommerce e-mail and its order) instead of being sent.
add_filter( 'wchc_allow_insecure_settle_url', function ( $allow, $url ) { return 'host.docker.internal' === wp_parse_url( $url, PHP_URL_HOST ) ? true : $allow; }, 10, 2 );
add_filter( 'http_request_host_is_external', function ( $external, $host ) { return 'host.docker.internal' === $host ? true : $external; }, 10, 2 );
add_filter( 'http_allowed_safe_ports', function ( $ports, $host, $url ) { return 'host.docker.internal' === $host ? array_merge( $ports, array( (int) wp_parse_url( $url, PHP_URL_PORT ) ) ) : $ports; }, 10, 3 );

add_filter( 'pre_wp_mail', function ( $short, $atts ) {
	$log   = (array) get_option( 'wchc_test_mails', array() );
	$log[] = array(
		'to'       => is_array( $atts['to'] ) ? implode( ',', $atts['to'] ) : (string) $atts['to'],
		'subject'  => (string) $atts['subject'],
		'message'  => substr( (string) $atts['message'], 0, 40000 ),
		'email_id' => '',
		'order_id' => 0,
	);
	update_option( 'wchc_test_mails', array_slice( $log, -40 ), false );
	return null === $short ? true : $short;
}, 5, 2 );
add_action( 'woocommerce_email_sent', function ( $sent, $id, $email ) {
	$log  = (array) get_option( 'wchc_test_mails', array() );
	$last = count( $log ) - 1;
	if ( $last >= 0 && '' === $log[ $last ]['email_id'] ) {
		$log[ $last ]['email_id'] = (string) $id;
		$log[ $last ]['order_id'] = $email instanceof WC_Email && $email->object instanceof WC_Order ? $email->object->get_id() : 0;
		update_option( 'wchc_test_mails', $log, false );
	}
}, 10, 3 );
