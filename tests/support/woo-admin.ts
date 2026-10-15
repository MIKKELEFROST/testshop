/**
 * Admin helpers for integration tests against the throwaway local WooCommerce
 * (scripts/local-woocommerce/setup.sh). Uses the standard REST API v3.
 */

export const LOCAL_WOO = {
  url: "http://localhost:8080",
  key: "ck_localtest0000000000000000000000000000",
  secret: "cs_localtest0000000000000000000000000000",
};

export function configureLocalWooEnv() {
  process.env.WOOCOMMERCE_URL ??= LOCAL_WOO.url;
  process.env.WOOCOMMERCE_CONSUMER_KEY ??= LOCAL_WOO.key;
  process.env.WOOCOMMERCE_CONSUMER_SECRET ??= LOCAL_WOO.secret;
  const host = new URL(process.env.WOOCOMMERCE_URL).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    // These tests change stock and cancel orders: never point them at a real shop.
    throw new Error("Integration tests only run against a local WooCommerce");
  }
}

async function admin<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const auth = Buffer.from(`${process.env.WOOCOMMERCE_CONSUMER_KEY}:${process.env.WOOCOMMERCE_CONSUMER_SECRET}`).toString("base64");
  const response = await fetch(`${process.env.WOOCOMMERCE_URL}/wp-json/wc/v3/${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

type Product = {
  id: number;
  slug: string;
  price: string;
  regular_price: string;
  stock_quantity: number | null;
  stock_status: string;
  webshops?: string[];
  categories?: { id: number }[];
  tags?: { id: number }[];
};
type Order = {
  id: number;
  status: string;
  total: string;
  total_tax: string;
  shipping_total: string;
  shipping_tax: string;
  transaction_id: string;
  payment_method_title: string;
  discount_total: string;
  coupon_lines: { code: string; discount: string; discount_tax: string }[];
  date_paid: string | null;
  meta_data: { key: string; value: unknown }[];
  line_items: { product_id: number; variation_id: number; quantity: number; total: string; total_tax: string }[];
};

export async function productBySku(sku: string): Promise<Product & { parent?: number }> {
  const [product] = await admin<Product[]>(`products?sku=${encodeURIComponent(sku)}`);
  if (!product) throw new Error(`Product ${sku} not found`);
  return product;
}

export async function variationBySku(parentId: number, sku: string): Promise<Product> {
  const variations = await admin<(Product & { sku: string })[]>(`products/${parentId}/variations?per_page=100`);
  const variation = variations.find((v) => v.sku === sku);
  if (!variation) throw new Error(`Variation ${sku} not found`);
  return variation;
}

export async function getProduct(id: number, parentId?: number): Promise<Product> {
  return admin<Product>(parentId ? `products/${parentId}/variations/${id}` : `products/${id}`);
}

export async function updateProduct(id: number, data: Record<string, unknown>, parentId?: number) {
  return admin<Product>(parentId ? `products/${parentId}/variations/${id}` : `products/${id}`, { method: "PUT", body: data });
}

export async function getOrder(id: number): Promise<Order> {
  return admin<Order>(`orders/${id}`);
}

export async function orderNotes(id: number): Promise<string[]> {
  const notes = await admin<{ note: string }[]>(`orders/${id}/notes`);
  return notes.map((n) => n.note);
}

type Coupon = { id: number; code: string; usage_count: number };

export async function createCoupon(data: Record<string, unknown>): Promise<Coupon> {
  return admin<Coupon>("coupons", { method: "POST", body: data });
}

export async function getCoupon(id: number): Promise<Coupon> {
  return admin<Coupon>(`coupons/${id}`);
}

export async function deleteCoupon(id: number) {
  await admin(`coupons/${id}?force=true`, { method: "DELETE" });
}

export async function createCategory(name: string, parent = 0): Promise<{ id: number }> {
  return admin<{ id: number }>("products/categories", { method: "POST", body: { name, parent } });
}

export async function deleteCategory(id: number) {
  await admin(`products/categories/${id}?force=true`, { method: "DELETE" });
}

export async function createTag(name: string): Promise<{ id: number }> {
  return admin<{ id: number }>("products/tags", { method: "POST", body: { name } });
}

export async function deleteTag(id: number) {
  await admin(`products/tags/${id}?force=true`, { method: "DELETE" });
}

type ShippingMethod = { instance_id: number; settings: Record<string, { label: string; type: string; value: string }> };

/** Change a shipping method's settings in the local zone "Danmark" (zone 1, see seed.php). */
export async function updateShippingMethod(instanceId: number, settings: Record<string, string>): Promise<ShippingMethod> {
  return admin<ShippingMethod>(`shipping/zones/1/methods/${instanceId}`, { method: "PUT", body: { settings } });
}

export async function getShippingMethod(instanceId: number): Promise<ShippingMethod> {
  return admin<ShippingMethod>(`shipping/zones/1/methods/${instanceId}`);
}

/** Run PHP inside the local WordPress (WP-CLI `eval`). */
export async function wpEval(php: string): Promise<string> {
  const { execFileSync } = await import("node:child_process");
  return execFileSync("docker", ["exec", "wcwp", "wp", "--allow-root", "--path=/var/www/html", "eval", php]).toString();
}

/** The plugin's health endpoint. */
export async function pluginStatus(): Promise<Record<string, unknown>> {
  return (await plugin("status")).body as Record<string, unknown>;
}

/** Call a Headless Checkout Bridge route; returns status and JSON body. */
export async function plugin(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; body: unknown }> {
  const auth = Buffer.from(`${process.env.WOOCOMMERCE_CONSUMER_KEY}:${process.env.WOOCOMMERCE_CONSUMER_SECRET}`).toString("base64");
  const response = await fetch(`${process.env.WOOCOMMERCE_URL}/wp-json/wc-headless/v1/${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

/** Create or rename a webshop (slug = store ID). */
export async function saveWebshop(slug: string, name: string) {
  const { status, body } = await plugin(`shops/${slug}`, { method: "PUT", body: { name } });
  if (status !== 200) throw new Error(`PUT shops/${slug} failed: ${status} ${JSON.stringify(body)}`);
  return body as { slug: string; name: string; products: number };
}

/** Product IDs and slugs as a storefront lists them (REST API v3, optional `wchc_shop`). */
export async function listProducts(query: Record<string, string>): Promise<{ id: number; slug: string; webshops?: string[] }[]> {
  return admin(`products?${new URLSearchParams({ per_page: "100", status: "publish", ...query })}`);
}

/** Cancel every unpaid order (releases stock holds) so tests don't affect each other. */
export async function cancelOpenOrders() {
  for (const status of ["pending", "on-hold", "failed"]) {
    const orders = await admin<{ id: number }[]>(`orders?status=${status}&per_page=100`);
    for (const order of orders) await admin(`orders/${order.id}`, { method: "PUT", body: { status: "cancelled" } });
  }
}

/** Make an order look created and last changed `minutes` ago (local Docker database, both order stores). */
export async function backdateOrder(id: number, minutes: number) {
  const [m, orderId] = [Math.trunc(minutes), Math.trunc(id)];
  const { execFileSync } = await import("node:child_process");
  const sql = (statement: string) => execFileSync("docker", ["exec", "wcdb", "mariadb", "-uwp", "-pwp", "wp", "-N", "-e", statement]).toString();
  sql(
    `UPDATE wp_posts SET post_date = post_date - INTERVAL ${m} MINUTE, post_date_gmt = post_date_gmt - INTERVAL ${m} MINUTE, post_modified = post_modified - INTERVAL ${m} MINUTE, post_modified_gmt = post_modified_gmt - INTERVAL ${m} MINUTE WHERE ID = ${orderId}`,
  );
  if (sql("SHOW TABLES LIKE 'wp_wc_orders'").trim()) {
    sql(`UPDATE wp_wc_orders SET date_created_gmt = date_created_gmt - INTERVAL ${m} MINUTE, date_updated_gmt = date_updated_gmt - INTERVAL ${m} MINUTE WHERE id = ${orderId}`);
  }
}

/** Run the plugin's unpaid-order cleanup now (as WP-Cron would) and return how many orders it cancelled. */
export async function runUnpaidOrderCleanup(): Promise<number> {
  const { execFileSync } = await import("node:child_process");
  const out = execFileSync("docker", ["exec", "wcwp", "wp", "--allow-root", "--path=/var/www/html", "eval", "echo WCHC_Orders::cancel_unpaid_orders();"]);
  return Number(out.toString().trim());
}

/** Simulate the passing of WooCommerce's "hold stock" period (local Docker database only). */
export async function expireStockHolds() {
  const { execFileSync } = await import("node:child_process");
  execFileSync("docker", ["exec", "wcdb", "mariadb", "-uwp", "-pwp", "wp", "-e", "UPDATE wp_wc_reserved_stock SET expires = NOW() - INTERVAL 1 MINUTE"]);
}
