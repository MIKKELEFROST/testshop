/**
 * Webshops: several storefronts sharing one WooCommerce, each selling its own products
 * (Headless Checkout Bridge 1.2). Runs against the local Docker WooCommerce.
 *
 *   ./scripts/local-woocommerce/setup.sh && npm run test:integration
 *
 * Uses its own webshops ("it-shop-a", "it-shop-b"), so the default store of the other
 * integration tests stays unrestricted. Also covers the category filters of category and theme
 * pages (`wchc_in_category`, `wchc_not_in_category`, `wchc_in_any_category`, plugin 1.4), alone and with a webshop.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cancelOpenOrders,
  configureLocalWooEnv,
  createCategory,
  createTag,
  deleteCategory,
  deleteTag,
  getProduct,
  listProducts,
  plugin,
  productBySku,
  saveWebshop,
  updateProduct,
  wpEval,
} from "../support/woo-admin";

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
    expect(status.version).toBe("1.4.0");
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

  /**
   * Test categories, like "Damekostumer" and "Halloween": all three products are in "women"; onlyB is in
   * "halloween" and shared in its subcategory "witches". Shared and onlyA have the tag "costume".
   */
  async function withCategories(run: (c: { women: number; halloween: number; witches: number; costume: number }) => Promise<void>) {
    const suffix = Date.now().toString(36);
    const women = await createCategory(`IT Damekostumer ${suffix}`);
    const halloween = await createCategory(`IT Halloween ${suffix}`);
    const witches = await createCategory(`IT Hekse ${suffix}`, halloween.id);
    const costume = await createTag(`it-kostume-${suffix}`);
    const original = await Promise.all([ids.shared, ids.onlyA, ids.onlyB].map((id) => getProduct(id)));
    try {
      await updateProduct(ids.shared, { categories: [{ id: women.id }, { id: witches.id }], tags: [{ id: costume.id }] });
      await updateProduct(ids.onlyA, { categories: [{ id: women.id }], tags: [{ id: costume.id }] });
      await updateProduct(ids.onlyB, { categories: [{ id: women.id }, { id: halloween.id }] });
      await run({ women: women.id, halloween: halloween.id, witches: witches.id, costume: costume.id });
    } finally {
      for (const product of original) {
        await updateProduct(product.id, { categories: (product.categories ?? []).map((c) => ({ id: c.id })), tags: (product.tags ?? []).map((t) => ({ id: t.id })) });
      }
      for (const category of [witches, halloween, women]) await deleteCategory(category.id);
      await deleteTag(costume.id);
    }
  }

  const sorted = (values: number[]) => [...values].sort((a, b) => a - b);
  const productIds = async (query: Record<string, string>) => sorted((await listProducts(query)).map((p) => p.id));

  it("lists products in a category that are also in each category of wchc_in_category", async () => {
    // WooCommerce's own `category` matches any of its categories.
    await withCategories(async ({ women, halloween, witches }) => {
      const list = (query: Record<string, string>) => productIds({ category: String(women), ...query });

      expect(await list({})).toEqual(sorted([ids.shared, ids.onlyA, ids.onlyB]));
      expect(await list({ wchc_in_category: String(halloween) })).toEqual(sorted([ids.shared, ids.onlyB])); // shared via the subcategory
      expect(await list({ wchc_in_category: `${halloween},${witches}` })).toEqual([ids.shared]);

      // Together with the webshop: A sells the shared product and onlyA, B the shared product and onlyB.
      expect(await list({ wchc_in_category: String(halloween), wchc_shop: A })).toEqual([ids.shared]);
      expect(await list({ wchc_in_category: String(halloween), wchc_shop: B })).toEqual(sorted([ids.shared, ids.onlyB]));

      // Non-numeric and unknown IDs are ignored.
      expect(await list({ wchc_in_category: `abc,999999,${halloween}` })).toEqual(sorted([ids.shared, ids.onlyB]));
      expect(await list({ wchc_in_category: "abc,999999" })).toEqual(sorted([ids.shared, ids.onlyA, ids.onlyB]));
    });
  });

  it("leaves out products in any category of wchc_not_in_category, also with category, tag, wchc_in_category and webshop", async () => {
    await withCategories(async ({ women, halloween, witches, costume }) => {
      const list = (query: Record<string, string>) => productIds({ category: String(women), ...query });

      // shared (Hekse is a subcategory of Halloween) and onlyB are left out.
      expect(await list({ wchc_not_in_category: String(halloween) })).toEqual([ids.onlyA]);
      expect(await list({ wchc_not_in_category: String(witches) })).toEqual(sorted([ids.onlyA, ids.onlyB]));
      expect(await list({ wchc_not_in_category: `abc,${witches}` })).toEqual(sorted([ids.onlyA, ids.onlyB])); // non-numeric ignored
      expect(await list({ wchc_not_in_category: "abc" })).toEqual(sorted([ids.shared, ids.onlyA, ids.onlyB]));

      expect(await list({ wchc_in_category: String(halloween), wchc_not_in_category: String(witches) })).toEqual([ids.onlyB]);
      expect(await list({ wchc_not_in_category: String(witches), wchc_shop: B })).toEqual([ids.onlyB]);
      expect(await productIds({ tag: String(costume), wchc_not_in_category: String(halloween) })).toEqual([ids.onlyA]);
    });
  });

  it("lists products in any category of wchc_in_any_category: the rest after wchc_not_in_category", async () => {
    await withCategories(async ({ women, halloween, witches }) => {
      const list = (query: Record<string, string>) => productIds({ category: String(women), ...query });

      expect(await list({ wchc_in_any_category: String(witches) })).toEqual([ids.shared]);
      expect(await list({ wchc_in_any_category: String(halloween) })).toEqual(sorted([ids.shared, ids.onlyB])); // with the subcategory
      expect(await list({ wchc_in_any_category: `${witches},abc` })).toEqual([ids.shared]); // non-numeric ignored
      // A category page's own season first, then the rest: together they are the whole category, once.
      const first = await list({ wchc_not_in_category: String(halloween) });
      const rest = await list({ wchc_in_any_category: String(halloween) });
      expect(sorted([...first, ...rest])).toEqual(sorted([ids.shared, ids.onlyA, ids.onlyB]));
      expect(await list({ wchc_in_any_category: String(halloween), wchc_not_in_category: String(witches), wchc_shop: B })).toEqual([ids.onlyB]);
    });
  });

  it("counts each webshop's products per category in one request, subcategories included", async () => {
    await withCategories(async ({ women, halloween, witches }) => {
      const counts = async (shop: string) => {
        const { status, body } = await plugin(`shops/${shop}/category-counts`);
        expect(status).toBe(200);
        const all = body as Record<string, number>;
        return [women, halloween, witches].map((id) => all[String(id)] ?? 0);
      };
      // A sells shared (women, Hekse under Halloween) and onlyA (women); B sells shared and onlyB (women, Halloween).
      expect(await counts(A)).toEqual([2, 1, 1]);
      expect(await counts(B)).toEqual([2, 2, 1]);
      // The same numbers as counting with the REST API's category filter, one request per category.
      for (const id of [women, halloween, witches]) {
        expect((await listProducts({ category: String(id), wchc_shop: B })).length).toBe((await counts(B))[[women, halloween, witches].indexOf(id)]);
      }
      // A store ID that is not a webshop counts every published product.
      expect(await counts("ikke-en-webshop")).toEqual([3, 2, 1]);
    });
  });

  it("recounts after changes WooCommerce's product hooks miss: trash, restore, scheduled publishing, webshops", async () => {
    await withCategories(async ({ women }) => {
      const count = async (shop: string) => ((await plugin(`shops/${shop}/category-counts`)).body as Record<string, number>)[String(women)] ?? 0;
      const C = `it-shop-c-${Date.now().toString(36)}`;
      try {
        expect(await count(A)).toBe(2); // shared and onlyA
        // Trash from the products list, then restore (WooCommerce restores the product's status).
        await wpEval(`wp_trash_post( ${ids.onlyA} );`);
        expect(await count(A)).toBe(1);
        await wpEval(`wp_untrash_post( ${ids.onlyA} );`);
        expect(await count(A)).toBe(2);
        // Unpublished, then published as WP-Cron publishes a scheduled product (wp_publish_post).
        await wpEval(`wp_update_post( array( 'ID' => ${ids.onlyA}, 'post_status' => 'draft' ) );`);
        expect(await count(A)).toBe(1);
        await wpEval(`wp_publish_post( ${ids.onlyA} );`);
        expect(await count(A)).toBe(2);

        // A store ID counts every product until it becomes a webshop, and again once that is deleted.
        expect(await count(C)).toBe(3);
        await saveWebshop(C, "Testshop C");
        expect(await count(C)).toBe(0);
        await wpEval(`wp_delete_term( get_term_by( 'slug', '${C}', 'wchc_shop' )->term_id, 'wchc_shop' );`);
        expect(await count(C)).toBe(3);
      } finally {
        // Restoring from the trash also restores the slug.
        await wpEval(`if ( 'trash' === get_post_status( ${ids.onlyA} ) ) { wp_untrash_post( ${ids.onlyA} ); } if ( 'publish' !== get_post_status( ${ids.onlyA} ) ) { wp_publish_post( ${ids.onlyA} ); }`);
        await wpEval(`$term = get_term_by( 'slug', '${C}', 'wchc_shop' ); if ( $term ) { wp_delete_term( $term->term_id, 'wchc_shop' ); }`);
      }
      expect((await getProduct(ids.onlyA)).slug).toBe(slugs.onlyA);
    });
  });

  it("does not cache a recount that a product change overlapped", async () => {
    const out = await wpEval(`
      $changed = false;
      // A product is saved while the recount's query runs.
      add_filter( 'query', function ( $query ) use ( &$changed ) {
        if ( ! $changed && false !== strpos( $query, "tt.taxonomy = 'product_cat'" ) ) {
          $changed = true;
          WCHC_Shops::forget_category_counts();
        }
        return $query;
      } );
      delete_transient( WCHC_Shops::COUNTS_TRANSIENT );
      WCHC_Shops::category_counts( '${A}' );
      $overlapped = get_transient( WCHC_Shops::COUNTS_TRANSIENT );
      WCHC_Shops::category_counts( '${A}' );
      $next = get_transient( WCHC_Shops::COUNTS_TRANSIENT );
      echo "\\n@@" . wp_json_encode( array( 'changed' => $changed, 'overlapped' => $overlapped, 'next' => is_array( $next ) ? array_keys( $next['shops'] ) : $next ) );
    `);
    expect(JSON.parse(out.slice(out.lastIndexOf("@@") + 2))).toEqual({ changed: true, overlapped: false, next: [A] });
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
