<?php
// LOCAL TEST ONLY: WooCommerce allows Basic auth only over HTTPS. Treat REST calls as HTTPS locally.
if ( isset( $_SERVER['REQUEST_URI'] ) && false !== strpos( $_SERVER['REQUEST_URI'], '/wp-json/' ) ) { $_SERVER['HTTPS'] = 'on'; }
