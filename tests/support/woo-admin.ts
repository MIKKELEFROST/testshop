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

type Product = { id: number; price: string; regular_price: string; stock_quantity: number | null; stock_status: string };
type Order = {
  id: number;
  status: string;
  total: string;
  total_tax: string;
  shipping_total: string;
  shipping_tax: string;
  transaction_id: string;
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

/** Cancel every unpaid order (releases stock holds) so tests don't affect each other. */
export async function cancelOpenOrders() {
  for (const status of ["pending", "on-hold", "failed"]) {
    const orders = await admin<{ id: number }[]>(`orders?status=${status}&per_page=100`);
    for (const order of orders) await admin(`orders/${order.id}`, { method: "PUT", body: { status: "cancelled" } });
  }
}

/** Simulate the passing of WooCommerce's "hold stock" period (local Docker database only). */
export async function expireStockHolds() {
  const { execFileSync } = await import("node:child_process");
  execFileSync("docker", ["exec", "wcdb", "mariadb", "-uwp", "-pwp", "wp", "-e", "UPDATE wp_wc_reserved_stock SET expires = NOW() - INTERVAL 1 MINUTE"]);
}
