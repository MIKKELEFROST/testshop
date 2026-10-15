/**
 * Webshops: several storefronts sharing one WooCommerce, each selling its own products
 * (Headless Checkout Bridge 1.2). Runs against the local Docker WooCommerce.
 *
 *   ./scripts/local-woocommerce/setup.sh && npm run test:integration
 *
 * Uses its own webshops ("it-shop-a", "it-shop-b"), so the default store of the other
 * integration tests stays unrestricted.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cancelOpenOrders, configureLocalWooEnv, listProducts, plugin, productBySku, saveWebshop, updateProduct } from "../support/woo-admin";

const enabled = Boolean(process.env.WC_INTEGRATION);
if (enabled) configureLocalWooEnv();

const { createOrder, fetchQuote } = await import("@/lib/woocommerce/checkout-api");

const A = "it-shop-a";
const B = "it-shop-b";
const where = { country: "DK", postcode: "8000", city: "Aarhus C" };
const customer = {
  first_name: "Test",
  last_name: "Kunde",
  address_1: "Testvej 1",
  postcode: "8000",
  city: "Aarhus C",
  country: "DK",
};

let ids: { shared: number; onlyA: number; onlyB: number; nowhere: number };
let slugs: { onlyA: string; onlyB: string; shared: string };

describe.skipIf(!enabled)("webshops", () => {
  beforeAll(async () => {
    await saveWebshop(A, "Testshop A");
    await saveWebshop(B, "Testshop B");
    const [tshirt, hat, tote, candle] = await Promise.all(["TS-001", "HUE-001", "TOTE-001", "LYS-001"].map(productBySku));
    ids = { shared: tshirt!.id, onlyA: hat!.id, onlyB: tote!.id, nowhere: candle!.id };
    slugs = { shared: tshirt!.slug, onlyA: hat!.slug, onlyB: tote!.slug };
    await updateProduct(ids.shared, { webshops: [A, B] });
    await updateProduct(ids.onlyA, { webshops: [A] });
    await updateProduct(ids.onlyB, { webshops: [B], stock_quantity: 5 });
    await updateProduct(ids.nowhere, { webshops: [] });
  });

  afterAll(async () => {
    await cancelOpenOrders();
    for (const id of Object.values(ids ?? {})) await updateProduct(id, { webshops: [] });
  });

  it("creates and renames webshops, and lists them with their product counts", async () => {
    expect(await saveWebshop(A, "Testshop A (omdøbt)")).toMatchObject({ slug: A, name: "Testshop A (omdøbt)", products: 2 });
    await saveWebshop(A, "Testshop A");

    const { body } = await plugin("shops");
    expect(body).toEqual(expect.arrayContaining([expect.objectContaining({ slug: B, name: "Testshop B", products: 2 })]));
    const status = (await plugin("status")).body as { version: string; shops: { slug: string }[] };
    expect(status.version).toBe("1.2.0");
    expect(status.shops.map((s) => s.slug)).toEqual(expect.arrayContaining([A, B]));
  });

  it("rejects an invalid webshop name or ID", async () => {
    expect((await plugin(`shops/${A}`, { method: "PUT", body: { name: "" } })).status).toBe(400);
    expect((await plugin("shops/Ikke%20gyldig", { method: "PUT", body: { name: "x" } })).status).toBe(404);
  });

  it("shows and sets a product's webshops through the REST API", async () => {
    const [product] = await listProducts({ include: String(ids.shared) });
    expect(product?.webshops?.sort()).toEqual([A, B]);

    const auth = Buffer.from(`${process.env.WOOCOMMERCE_CONSUMER_KEY}:${process.env.WOOCOMMERCE_CONSUMER_SECRET}`).toString("base64");
    const response = await fetch(`${process.env.WOOCOMMERCE_URL}/wp-json/wc/v3/products/${ids.nowhere}`, {
      method: "PUT",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({ webshops: ["findes-ikke"] }),
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe("wchc_invalid_webshop");
  });

  it("lists only the webshop's own products", async () => {
    const inA = (await listProducts({ wchc_shop: A })).map((p) => p.id);
    const inB = (await listProducts({ wchc_shop: B })).map((p) => p.id);
    expect(inA.sort()).toEqual([ids.shared, ids.onlyA].sort());
    expect(inB.sort()).toEqual([ids.shared, ids.onlyB].sort());
  });

  it("finds a product page by slug only in a webshop that sells it", async () => {
    expect((await listProducts({ wchc_shop: A, slug: slugs.onlyA })).map((p) => p.id)).toEqual([ids.onlyA]);
    expect(await listProducts({ wchc_shop: A, slug: slugs.onlyB })).toEqual([]);
    expect((await listProducts({ wchc_shop: B, slug: slugs.shared })).map((p) => p.id)).toEqual([ids.shared]);
  });

  it("a store ID that is not a webshop sees every product, as before", async () => {
    const all = (await listProducts({ wchc_shop: "ikke-en-webshop" })).map((p) => p.id);
    expect(all).toEqual(expect.arrayContaining(Object.values(ids)));
    expect((await listProducts({ wchc_shop: "ikke-en-webshop", slug: slugs.onlyB })).map((p) => p.id)).toEqual([ids.onlyB]);
  });

  it("quotes refuse products the webshop does not sell", async () => {
    const items = [
      { product_id: ids.shared, variation_id: 0, quantity: 1 },
      { product_id: ids.onlyB, variation_id: 0, quantity: 1 },
    ];
    const inA = await fetchQuote({ store_id: A, items, address: where });
    expect(inA.errors).toEqual([expect.objectContaining({ code: "not_in_shop", product_id: ids.onlyB, message: "Produktet sælges ikke i denne webshop." })]);
    expect(inA.items.map((i) => i.product_id)).toEqual([ids.shared]);

    const inB = await fetchQuote({ store_id: B, items, address: where });
    expect(inB.errors).toEqual([]);
    expect(inB.items).toHaveLength(2);

    const unknown = await fetchQuote({ store_id: "ikke-en-webshop", items, address: where });
    expect(unknown.errors).toEqual([]);
  });

  it("orders refuse products the webshop does not sell, and record the webshop", async () => {
    const input = (storeId: string, productId: number, expectedTotal: string) => ({
      checkout_id: `chk_it_shop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      store_id: storeId,
      items: [{ product_id: productId, variation_id: 0, quantity: 1 }],
      billing: { ...customer, email: "webshop@example.com" },
      shipping: customer,
      shipping_rate_id: null,
      expected_total: expectedTotal,
      payment_method_title: "Stripe",
      coupons: [],
    });

    const refused = await createOrder(input(A, ids.onlyB, "1.00"));
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: "cart_invalid" });
    expect(JSON.stringify(refused.body)).toContain("not_in_shop");

    const quote = await fetchQuote({ store_id: B, items: [{ product_id: ids.onlyB, variation_id: 0, quantity: 1 }], address: where });
    const created = await createOrder({ ...input(B, ids.onlyB, quote.totals.total), shipping_rate_id: quote.shipping_rate_id });
    expect(created.status).toBe(201);
    const orderId = (created.body as { order: { id: number } }).order.id;
    const auth = Buffer.from(`${process.env.WOOCOMMERCE_CONSUMER_KEY}:${process.env.WOOCOMMERCE_CONSUMER_SECRET}`).toString("base64");
    const order = (await (
      await fetch(`${process.env.WOOCOMMERCE_URL}/wp-json/wc/v3/orders/${orderId}`, { headers: { Authorization: `Basic ${auth}` } })
    ).json()) as { meta_data: { key: string; value: unknown }[] };
    expect(order.meta_data.find((m) => m.key === "_wchc_store_id")?.value).toBe(B);
  });
});
