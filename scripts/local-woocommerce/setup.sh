#!/usr/bin/env bash
# Starts a disposable local WordPress + WooCommerce (Docker) with Danish settings, five test
# products and the Headless Checkout Bridge plugin. Used for development and integration tests.
#
#   ./scripts/local-woocommerce/setup.sh          # create (or recreate) the environment
#   ./scripts/local-woocommerce/setup.sh --down   # remove it
#
# Local REST credentials (never use outside this throwaway environment):
#   WOOCOMMERCE_URL=http://localhost:8080
#   WOOCOMMERCE_CONSUMER_KEY=ck_localtest0000000000000000000000000000
#   WOOCOMMERCE_CONSUMER_SECRET=cs_localtest0000000000000000000000000000
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
NET=wcnet
DB=wcdb
WP=wcwp
# WordPress 7.1 + WooCommerce 11.1.2 from the official wordpress.org downloads (image by BTCPay Server).
IMAGE=${WC_IMAGE:-btcpayserver/woocommerce:11.1.2-amd64}
HPOS=${WC_HPOS:-no}

docker rm -f "$WP" "$DB" >/dev/null 2>&1 || true
if [[ "${1:-}" == "--down" ]]; then
  docker network rm "$NET" >/dev/null 2>&1 || true
  echo "Removed local WooCommerce."
  exit 0
fi

docker network create "$NET" >/dev/null 2>&1 || true
docker run -d --name "$DB" --network "$NET" \
  -e MARIADB_ROOT_PASSWORD=root -e MARIADB_DATABASE=wp -e MARIADB_USER=wp -e MARIADB_PASSWORD=wp \
  mariadb:11 >/dev/null

echo "Waiting for database..."
# The image's entrypoint answers on a temporary server first and restarts it: wait for the real one.
until docker logs "$DB" 2>&1 | grep -q 'MariaDB init process done'; do sleep 1; done
until docker exec "$DB" mariadb -uwp -pwp -e 'select 1' wp >/dev/null 2>&1; do sleep 1; done

# host.docker.internal: the plugin reports sent and cancelled orders to the test runner (capture at shipment).
docker run -d --name "$WP" --network "$NET" -p 8080:80 --add-host=host.docker.internal:host-gateway \
  -e WORDPRESS_DB_HOST="$DB" -e WORDPRESS_DB_USER=wp -e WORDPRESS_DB_PASSWORD=wp -e WORDPRESS_DB_NAME=wp \
  "$IMAGE" >/dev/null

echo "Waiting for WordPress files..."
until docker exec "$WP" test -f /var/www/html/wp-config.php 2>/dev/null; do sleep 1; done
sleep 2

WPCLI=(docker exec "$WP" wp --allow-root --path=/var/www/html)
"${WPCLI[@]}" core install --url=http://localhost:8080 --title="Piece (lokal test)" \
  --admin_user=admin --admin_password=admin --admin_email=admin@example.com --skip-email >/dev/null
"${WPCLI[@]}" rewrite structure '/%postname%/' --hard >/dev/null
"${WPCLI[@]}" plugin activate woocommerce >/dev/null
"${WPCLI[@]}" plugin deactivate btcpay-greenfield-for-woocommerce >/dev/null 2>&1 || true

opt() { "${WPCLI[@]}" option update "$@" >/dev/null; }
opt woocommerce_default_country 'DK'
opt woocommerce_currency 'DKK'
opt woocommerce_currency_pos 'right_space'
opt woocommerce_price_thousand_sep '.'
opt woocommerce_price_decimal_sep ','
opt woocommerce_price_num_decimals 2
opt woocommerce_calc_taxes 'yes'
opt woocommerce_prices_include_tax 'yes'
opt woocommerce_tax_based_on 'shipping'
opt woocommerce_tax_display_shop 'incl'
opt woocommerce_tax_display_cart 'incl'
opt woocommerce_manage_stock 'yes'
opt woocommerce_hold_stock_minutes 60
opt woocommerce_allowed_countries 'specific'
opt woocommerce_specific_allowed_countries '["DK"]' --format=json
opt woocommerce_coming_soon 'no'

# Local only: WooCommerce accepts Basic auth only over HTTPS.
docker exec "$WP" mkdir -p /var/www/html/wp-content/mu-plugins
docker cp "$DIR/local-https-for-rest.php" "$WP":/var/www/html/wp-content/mu-plugins/
docker cp "$DIR/local-test-hooks.php" "$WP":/var/www/html/wp-content/mu-plugins/

docker cp "$DIR/seed.php" "$WP":/tmp/seed.php
"${WPCLI[@]}" eval-file /tmp/seed.php

docker cp "$ROOT/wordpress-plugin/headless-checkout-bridge" "$WP":/var/www/html/wp-content/plugins/
docker exec "$WP" chown -R www-data:www-data /var/www/html/wp-content
"${WPCLI[@]}" plugin activate headless-checkout-bridge >/dev/null

if [[ "$HPOS" == "yes" ]]; then
  "${WPCLI[@]}" wc hpos enable >/dev/null
else
  "${WPCLI[@]}" wc hpos disable >/dev/null 2>&1 || true
fi

echo "Local WooCommerce ready at http://localhost:8080 (admin/admin), HPOS=$HPOS"
