/**
 * Capture at shipment against a real WooCommerce (local Docker, see
 * scripts/local-woocommerce/setup.sh) with the Headless Checkout Bridge plugin 1.5: the payment
 * is authorized when the order is placed and captured when the shop marks it completed.
 *
 * WordPress reports sent and cancelled orders over HTTP to a server in this test process
 * (host.docker.internal), which runs the storefront's real /api/payments/settle route. Stripe is
 * the in-memory fake.
 *
 *   ./scripts/local-woocommerce/setup.sh && npm run test:integration
 */
import { createServer, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventFor, FakeStripe, FakeStripeError } from "../support/fake-stripe";
import {
  cancelOpenOrders,
  clearMails,
  configureLocalWooEnv,
  getOrder,
  getProduct,
  metaValue,
  orderActions,
  orderNotes,
  paymentHandled,
  productBySku,
  refundOrder,
  sentMails,
  setOrderStatus,
  updateProduct,
  wpEval,
} from "../support/woo-admin";
import type { CheckoutRequest } from "@/lib/validation/checkout";

const enabled = Boolean(process.env.WC_INTEGRATION);
const PORT = Number(process.env.SETTLE_TEST_PORT ?? 3234);
const SECRET = "sk_test_capture_at_shipment_integration";
const ADMIN_EMAIL = "admin@example.com";

// The route's after() and deps: the work it schedules is collected so a test can wait for it.
const state = vi.hoisted(() => ({ deps: undefined as unknown, later: [] as Promise<unknown>[], callbacks: [] as { orders: { id: number }[]; status: number }[] }));
vi.mock("next/server", () => ({ after: (task: () => unknown) => void state.later.push(Promise.resolve().then(task)) }));
vi.mock("@/lib/checkout/deps", () => ({ settleSecret: () => SECRET, settleDeps: () => state.deps }));

if (enabled) {
  configureLocalWooEnv();
  // Where the plugin reports the orders (settleUrl() without Vercel's production address).
  process.env.NEXT_PUBLIC_SITE_URL = `http://host.docker.internal:${PORT}`;
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
}

const { attachPaymentIntent, createOrder, fetchQuote, getOrderDetails, sendPaymentEvent, sweepPayments } = await import("@/lib/woocommerce/checkout-api");
const { finalizePayment, startCheckout } = await import("@/lib/checkout/service");
const { handleStripeEvent } = await import("@/lib/checkout/webhook");
const { runSettleSweep, settleCallbackFor, settleToken, settleUrl } = await import("@/lib/checkout/settle");
const { POST: settleRoute } = await import("@/app/api/payments/settle/route");

const storeId = "piece-dk";
const customerEmail = "integration@example.com";
const address = { firstName: "Test", lastName: "Kunde", company: "", address1: "Testvej 1", address2: "", postcode: "8000", city: "Aarhus C", country: "DK" };
let ids: { tshirt: number; hat: number };
let seq = 0;

/** The storefront's deps, with this test's Stripe; the callback URL the authorization sends. */
function depsFor(stripe: FakeStripe, url = settleUrl()) {
  const deps = {
    backend: { createOrder, attachPaymentIntent, sendPaymentEvent, getOrder: getOrderDetails, sweepPayments },
    gateway: stripe,
    settleCallback: settleCallbackFor(SECRET, url),
  };
  state.deps = deps;
  return deps;
}

/** Wait for the work the settle route started after answering WordPress. */
async function settled() {
  while (state.later.length) await Promise.all(state.later.splice(0));
}

async function requestFor(productId: number, quantity: number): Promise<CheckoutRequest> {
  const items = [{ product_id: productId, variation_id: 0, quantity }];
  const where = { country: "DK", postcode: address.postcode, city: address.city };
  const first = await fetchQuote({ store_id: storeId, items, address: where, email: customerEmail });
  const rate = first.shipping_rates.find((r) => r.method_id === "flat_rate") ?? first.shipping_rates[0];
  const quote = await fetchQuote({ store_id: storeId, items, address: where, shipping_rate_id: rate?.id ?? null, email: customerEmail });
  return {
    items: [{ productId, variationId: 0, quantity }],
    contact: { email: customerEmail, phone: "12345678" },
    shipping: address,
    billingSameAsShipping: true,
    shippingRateId: quote.shipping_rate_id,
    expectedTotal: quote.totals.total,
    customerNote: "",
    coupons: [],
  };
}

/** Place an order and let the customer confirm the payment: authorized, reported as the return page does. */
async function authorizedOrder(deps: ReturnType<typeof depsFor>, productId: number, quantity: number) {
  const checkoutId = `chk_cap_${Date.now().toString(36)}_${++seq}_${Math.random().toString(36).slice(2, 8)}`;
  const ready = await startCheckout(await requestFor(productId, quantity), { checkoutId }, deps);
  if (ready.type !== "ready") throw new Error(`Expected ready, got ${ready.type}`);
  deps.gateway.confirm(ready.paymentIntentId);
  const outcome = await finalizePayment(await deps.gateway.retrieve(ready.paymentIntentId), deps);
  expect(outcome).toMatchObject({ type: "applied", result: "authorized" });
  return { id: ready.order.id, key: ready.order.key, pi: ready.paymentIntentId };
}

/** The shop changes the order's status; WordPress reports it before answering. */
async function shop(orderId: number, status: string) {
  await setOrderStatus(orderId, status);
  await settled();
}

const notesWith = async (orderId: number, text: string) => (await orderNotes(orderId)).filter((n) => n.includes(text));
const mailsFor = async (orderId: number, emailId: string) => (await sentMails()).filter((m) => m.order_id === orderId && m.email_id === emailId);
const adminMails = async (subject: string) => (await sentMails()).filter((m) => m.to === ADMIN_EMAIL && m.subject.includes(subject));

describe.skipIf(!enabled)("capture at shipment against WooCommerce", () => {
  let server: Server;

  beforeAll(async () => {
    ids = { tshirt: (await productBySku("TS-001")).id, hat: (await productBySku("HUE-001")).id };
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks).toString();
      if (req.url === "/redirect/api/payments/settle") {
        // The shop's address redirects (e.g. the apex domain to www).
        res.writeHead(308, { Location: `http://host.docker.internal:${PORT}/api/payments/settle` }).end();
        return;
      }
      if (req.url !== "/api/payments/settle") {
        res.writeHead(404).end();
        return;
      }
      const headers = Object.entries(req.headers).flatMap(([name, value]) => (value === undefined ? [] : [[name, String(value)] as [string, string]]));
      const response = await settleRoute(new Request(`http://localhost:${PORT}${req.url}`, { method: req.method, headers, body }));
      state.callbacks.push({ ...(JSON.parse(body) as { orders: { id: number }[] }), status: response.status });
      res.writeHead(response.status, { "Content-Type": "application/json" }).end(await response.text());
    });
    await new Promise<void>((resolve) => server.listen(PORT, "0.0.0.0", resolve));
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(async () => {
    await cancelOpenOrders();
    await settled();
    await updateProduct(ids.tshirt, { stock_quantity: 25, regular_price: "249" });
    await updateProduct(ids.hat, { stock_quantity: 10, regular_price: "199", sale_price: "149" });
    await clearMails();
    state.callbacks.length = 0;
  });

  afterEach(async () => {
    await cancelOpenOrders();
    await settled();
    // Releases what WordPress could not report (the daily job's work), so later runs start clean.
    if (state.deps) await runSettleSweep(state.deps as ReturnType<typeof depsFor>);
  });

  it("reserves the order when the payment is authorized: on-hold, stock and e-mails once, nothing paid", async () => {
    const stripe = new FakeStripe();
    const deps = depsFor(stripe);
    const checkoutId = `chk_cap_${Date.now().toString(36)}_auth`;
    const ready = await startCheckout(await requestFor(ids.tshirt, 2), { checkoutId }, deps);
    if (ready.type !== "ready") throw new Error(`Expected ready, got ${ready.type}`);
    expect((await stripe.retrieve(ready.paymentIntentId)).capture_method).toBe("manual");
    stripe.confirm(ready.paymentIntentId);

    // The return page and Stripe's webhook (twice) report it at the same time.
    const event = eventFor({ id: ready.paymentIntentId }, "payment_intent.amount_capturable_updated");
    const [fromPage, ...fromWebhook] = await Promise.all([
      finalizePayment(await stripe.retrieve(ready.paymentIntentId), deps),
      handleStripeEvent(event, deps),
      handleStripeEvent(event, deps),
    ]);
    const results = [fromPage, ...fromWebhook.map((r) => r.outcome)].map((o) => (o?.type === "applied" ? o.result : o?.type)).sort();
    expect(results).toEqual(["already_authorized", "already_authorized", "authorized"]);

    const order = await getOrder(ready.order.id);
    expect(order).toMatchObject({ status: "on-hold", transaction_id: "", date_paid: null, payment_method_title: "Visa-kort (Stripe)" });
    expect(metaValue(order, "_wchc_capture_status")).toBe("authorized");
    expect(metaValue(order, "_wchc_payment_intent_id")).toBe(ready.paymentIntentId);
    expect(metaValue(order, "_wchc_settle_callback")).toMatchObject({ url: `http://host.docker.internal:${PORT}/api/payments/settle` });
    expect((await getProduct(ids.tshirt)).stock_quantity).toBe(23);
    expect(await notesWith(order.id, "Betalingen er reserveret og trækkes, når ordren sendes")).toHaveLength(1);
    expect((await stripe.retrieve(ready.paymentIntentId)).status).toBe("requires_capture");

    // The customer's on-hold e-mail (with the withdrawal information) and "New order", once each.
    const [onHold, ...moreOnHold] = await mailsFor(order.id, "customer_on_hold_order");
    expect(moreOnHold).toHaveLength(0);
    expect(onHold!.message).toContain("Beløbet trækkes først, når vi sender din ordre.");
    expect(onHold!.message).toContain("Tak for din ordre. Vi har modtaget den og sender den hurtigst muligt.");
    expect(onHold!.message).not.toContain("until we can confirm your payment");
    expect(onHold!.message).toContain("Standardfortrydelsesformular");
    const newOrder = await mailsFor(order.id, "new_order");
    expect(newOrder).toHaveLength(1);
    expect(newOrder[0]!.message).toContain("reserveret, ikke trukket");

    // The confirmation page reads what is reserved.
    expect((await getOrderDetails(order.id, ready.order.key))?.capture).toMatchObject({ status: "authorized", amount: "547.00" });
  });

  it("captures the payment when the shop marks the order completed, once, however often it is reported", async () => {
    const stripe = new FakeStripe();
    const deps = depsFor(stripe);
    const order = await authorizedOrder(deps, ids.tshirt, 2);

    // Completed twice at the same time (two shop windows): each request reports it.
    await Promise.all([setOrderStatus(order.id, "completed"), setOrderStatus(order.id, "completed")]);
    await settled();
    expect(state.callbacks.length).toBeGreaterThanOrEqual(1);
    expect(state.callbacks.every((c) => c.status === 202 && c.orders[0]!.id === order.id)).toBe(true);

    expect(await stripe.retrieve(order.pi)).toMatchObject({ status: "succeeded", amount_received: 54700 });
    expect(stripe.calls.capture).toBe(1);
    const paid = await getOrder(order.id);
    expect(paid).toMatchObject({ status: "completed", transaction_id: order.pi });
    expect(paid.date_paid).not.toBeNull();
    expect(metaValue(paid, "_wchc_capture_status")).toBe("captured");
    expect(await notesWith(order.id, "Betalingen er trukket")).toHaveLength(1);
    expect((await getProduct(ids.tshirt)).stock_quantity).toBe(23);

    // A replayed callback, the webhook for the capture, completing it again and the daily job change nothing.
    const replay = await fetch(`http://localhost:${PORT}/api/payments/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orders: [{ id: order.id, order_key: order.key, token: settleToken(SECRET, storeId, order.id, order.key) }] }),
    });
    expect(replay.status).toBe(202);
    await settled();
    expect((await handleStripeEvent(eventFor({ id: order.pi }, "payment_intent.succeeded"), deps)).outcome).toMatchObject({ result: "already_paid" });
    const callbacks = state.callbacks.length;
    await shop(order.id, "processing");
    await shop(order.id, "completed");
    expect(state.callbacks.length).toBe(callbacks);
    expect((await sweepPayments(storeId)).settle.map((o) => o.id)).not.toContain(order.id);
    expect(stripe.calls.capture).toBe(1);
    expect(await notesWith(order.id, "Betalingen er trukket")).toHaveLength(1);
  });

  it("captures only what the order still costs after a refund before it was sent", async () => {
    const stripe = new FakeStripe();
    const order = await authorizedOrder(depsFor(stripe), ids.tshirt, 2);
    await refundOrder(order.id, "249.00"); // one T-shirt could not be sent
    // WooCommerce's refund e-mail to the customer says that nothing was charged.
    const [refundMail] = await mailsFor(order.id, "customer_partially_refunded_order");
    expect(refundMail!.message).toContain("Beløbet er ikke trukket endnu, så der er intet at betale tilbage: vi trækker kun 298");

    // Being packed (Behandler): not paid yet, although WooCommerce sets a date paid on that status.
    await shop(order.id, "processing");
    expect(await getOrder(order.id)).toMatchObject({ status: "processing", date_paid: null, transaction_id: "" });

    await shop(order.id, "completed");
    expect(await stripe.retrieve(order.pi)).toMatchObject({ status: "succeeded", amount_received: 29800, amount_capturable: 0 });
    const paid = await getOrder(order.id);
    expect(metaValue(paid, "_wchc_capture_status")).toBe("captured");
    expect(paid.date_paid).not.toBeNull();
  });

  it("captures when the shop's address redirects (e.g. the apex domain to www)", async () => {
    const stripe = new FakeStripe();
    const order = await authorizedOrder(depsFor(stripe, `http://host.docker.internal:${PORT}/redirect/api/payments/settle`), ids.tshirt, 1);
    await shop(order.id, "completed");
    expect(state.callbacks.map((c) => c.status)).toEqual([202]);
    expect(await getOrder(order.id)).toMatchObject({ status: "completed", transaction_id: order.pi });
    expect(stripe.calls.capture).toBe(1);
  });

  it("refuses callbacks without the order's token", async () => {
    const stripe = new FakeStripe();
    const order = await authorizedOrder(depsFor(stripe), ids.tshirt, 1);
    const other = await authorizedOrder(depsFor(stripe), ids.hat, 1);
    // Sent, but WordPress has not told the storefront (yet).
    await wpEval(`remove_action( 'woocommerce_order_status_changed', array( 'WCHC_Capture', 'status_changed' ), 20 ); $o = wc_get_order(${order.id}); $o->set_status('completed'); $o->save();`);
    expect(state.callbacks).toHaveLength(0);

    const post = (orders: unknown[]) =>
      fetch(`http://localhost:${PORT}/api/payments/settle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orders }) });
    const forged = await post([{ id: order.id, order_key: order.key, token: "x".repeat(43) }]);
    const borrowed = await post([{ id: order.id, order_key: order.key, token: settleToken(SECRET, storeId, other.id, other.key) }]);
    const otherShop = await post([{ id: order.id, order_key: order.key, token: settleToken(SECRET, "halloween-kostumer-dk", order.id, order.key) }]);
    const missing = await post([{ id: order.id, order_key: order.key }]);
    expect([forged.status, borrowed.status, otherShop.status, missing.status]).toEqual([401, 401, 401, 400]);
    await settled();
    expect(stripe.calls.capture).toBe(0);
    expect((await stripe.retrieve(order.pi)).status).toBe("requires_capture");
    await shop(order.id, "cancelled");
  });

  it("releases the reservation when the order is cancelled before it is sent; WooCommerce restores the stock", async () => {
    const stripe = new FakeStripe();
    const deps = depsFor(stripe);
    const order = await authorizedOrder(deps, ids.hat, 2);
    expect((await getProduct(ids.hat)).stock_quantity).toBe(8);

    await shop(order.id, "cancelled");
    expect((await stripe.retrieve(order.pi)).status).toBe("canceled");
    expect(stripe.calls.capture).toBe(0);
    const cancelled = await getOrder(order.id);
    expect(cancelled).toMatchObject({ status: "cancelled", transaction_id: "", date_paid: null });
    expect(metaValue(cancelled, "_wchc_capture_status")).toBe("released");
    expect(await notesWith(order.id, "er frigivet")).toHaveLength(1);
    expect((await getProduct(ids.hat)).stock_quantity).toBe(10);

    // Stripe's webhook for the cancellation: already noted.
    await handleStripeEvent(eventFor({ id: order.pi }, "payment_intent.canceled"), deps);
    expect(await notesWith(order.id, "er frigivet")).toHaveLength(1);
  });

  it("releases the reservation of an order set to Refunded before it is sent, without restocking (WooCommerce's rule)", async () => {
    const stripe = new FakeStripe();
    const order = await authorizedOrder(depsFor(stripe), ids.hat, 2);
    await shop(order.id, "refunded");
    expect((await stripe.retrieve(order.pi)).status).toBe("canceled");
    expect(metaValue(await getOrder(order.id), "_wchc_capture_status")).toBe("released");
    const [refundMail] = await mailsFor(order.id, "customer_refunded_order");
    expect(refundMail!.message).toContain("Beløbet er ikke trukket, så reservationen frigives, og du betaler ingenting.");
    // Only Annulleret puts the items back on stock (see WOOCOMMERCE.md).
    expect((await getProduct(ids.hat)).stock_quantity).toBe(8);
  });

  it("puts the order back on-hold and e-mails the shop when the capture is refused; completing it again retries", async () => {
    const stripe = new FakeStripe();
    const order = await authorizedOrder(depsFor(stripe), ids.tshirt, 1);
    stripe.failNextCapture(order.pi, "card_declined");

    await shop(order.id, "completed");
    const failed = await getOrder(order.id);
    expect(failed).toMatchObject({ status: "on-hold", transaction_id: "" });
    // WooCommerce set a date paid when the order was completed: nothing is paid.
    expect(failed.date_paid).toBeNull();
    expect(metaValue(failed, "_wchc_capture_status")).toBe("failed");
    expect(await notesWith(order.id, "Betalingen kunne ikke trækkes: Stripe afviste at trække beløbet (card_declined)")).toHaveLength(1);
    const alerts = await adminMails(`Betalingen for ordre #${order.id} kunne ikke trækkes`);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.message).toContain("card_declined");
    expect((await getProduct(ids.tshirt)).stock_quantity).toBe(24);

    await shop(order.id, "completed");
    const paid = await getOrder(order.id);
    expect(paid).toMatchObject({ status: "completed", transaction_id: order.pi });
    expect(paid.date_paid).not.toBeNull();
    expect(stripe.calls.capture).toBe(1);
    expect((await getProduct(ids.tshirt)).stock_quantity).toBe(24);
  });

  it("tells the shop when Stripe lets a reservation expire, and does not capture it when the order is sent anyway", async () => {
    const stripe = new FakeStripe();
    const deps = depsFor(stripe);
    const order = await authorizedOrder(deps, ids.tshirt, 1);
    stripe.expire(order.pi);

    const event = eventFor({ id: order.pi }, "payment_intent.canceled");
    await handleStripeEvent(event, deps);
    await handleStripeEvent(event, deps);
    const expired = await getOrder(order.id);
    expect(expired.status).toBe("on-hold");
    expect(metaValue(expired, "_wchc_capture_status")).toBe("expired");
    expect(await notesWith(order.id, "Reservationen er udløbet eller annulleret i Stripe (automatic)")).toHaveLength(1);
    expect(await adminMails(`Reservationen for ordre #${order.id} er udløbet`)).toHaveLength(1);

    await shop(order.id, "completed");
    expect((await getOrder(order.id)).status).toBe("on-hold");
    expect(await notesWith(order.id, "Betalingen kunne ikke trækkes: reservationen er udløbet")).toHaveLength(1);
    expect(stripe.calls.capture).toBe(0);

    // The customer pays another way: the shop says so (order action), and the order stays sent.
    expect(await orderActions(order.id)).toContain("wchc_payment_handled");
    await clearMails();
    await paymentHandled(order.id);
    expect(await notesWith(order.id, "Betalingen er markeret som klaret uden om webshoppen (af admin)")).toHaveLength(1);
    await shop(order.id, "completed");
    const sent = await getOrder(order.id);
    expect(sent.status).toBe("completed");
    expect(metaValue(sent, "_wchc_capture_status")).toBe("manual");
    expect(await adminMails("kunne ikke trækkes")).toHaveLength(0);
    expect(await orderActions(order.id)).not.toContain("wchc_payment_handled");
    expect(stripe.calls.capture).toBe(0);
    expect((await sweepPayments(storeId)).settle.map((o) => o.id)).not.toContain(order.id);
  });

  it("tells the shop when a sent order's reservation is gone, also while another request holds the order", async () => {
    const stripe = new FakeStripe();
    const deps = depsFor(stripe);
    const order = await authorizedOrder(deps, ids.tshirt, 1);
    // The shop cancelled it (released), then reopens it and sends it while a payment event holds the order lock.
    await shop(order.id, "cancelled");
    await shop(order.id, "on-hold");
    const { spawn } = await import("node:child_process");
    const holder = spawn("docker", ["exec", "wcwp", "wp", "--allow-root", "--path=/var/www/html", "eval", `WCHC_Lock::acquire( 'order:${order.id}', 0 ); echo "locked\n"; sleep( 9 );`]);
    await new Promise<void>((resolve) => holder.stdout.on("data", (chunk: Buffer) => chunk.toString().includes("locked") && resolve()));
    await shop(order.id, "completed");
    await new Promise((resolve) => holder.on("close", resolve));

    const sent = await getOrder(order.id);
    expect(sent.status).toBe("completed");
    expect(await notesWith(order.id, "Betalingen kan ikke trækkes: reservationen er udløbet eller frigivet")).toHaveLength(1);
    expect(await adminMails(`Betalingen for ordre #${order.id} kunne ikke trækkes`)).toHaveLength(1);
    expect(stripe.calls.capture).toBe(0);
  });

  it("warns the shop once when a sent order's payment is still not captured a day later", async () => {
    const stripe = new FakeStripe();
    const order = await authorizedOrder(depsFor(stripe), ids.tshirt, 1);
    // Stripe fails (not a refusal) every time: the storefront accepted the callback, but nothing is written.
    const capture = stripe.capture.bind(stripe);
    stripe.capture = async () => {
      throw new FakeStripeError("An error occurred with our API.", "api_error");
    };
    await shop(order.id, "completed");
    expect(state.callbacks.map((c) => c.status)).toEqual([202]);
    expect(await getOrder(order.id)).toMatchObject({ status: "completed", transaction_id: "" });

    // The next morning nothing is due yet; a day after it was sent, the shop is told.
    expect((await runSettleSweep(depsFor(stripe))).warned).toBe(0);
    await wpEval(`$o = wc_get_order(${order.id}); $o->set_date_completed( time() - DAY_IN_SECONDS - HOUR_IN_SECONDS ); $o->save();`);
    const run = await runSettleSweep(depsFor(stripe));
    expect(run).toMatchObject({ failed: 1, warned: 1 });
    expect(await notesWith(order.id, "Ordren er sendt, men betalingen er endnu ikke trukket")).toHaveLength(1);
    const alerts = await adminMails(`Betalingen for ordre #${order.id} er ikke trukket`);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.message).toContain(`Ordre #${order.id}`);

    // Once per attempt; the next run that reaches Stripe captures it.
    expect((await runSettleSweep(depsFor(stripe))).warned).toBe(0);
    expect(await notesWith(order.id, "Ordren er sendt, men betalingen er endnu ikke trukket")).toHaveLength(1);
    stripe.capture = capture;
    expect(await runSettleSweep(depsFor(stripe))).toMatchObject({ captured: 1, warned: 0 });
    expect(await getOrder(order.id)).toMatchObject({ status: "completed", transaction_id: order.pi });
  });

  it("the daily job captures and releases what WordPress could not report, and warns about old reservations", async () => {
    const stripe = new FakeStripe();
    // These orders' storefront cannot be reached (e.g. a preview behind Vercel's protection).
    const unreachable = depsFor(stripe, `http://host.docker.internal:${PORT}/nowhere`);
    const sent = await authorizedOrder(unreachable, ids.tshirt, 1);
    const ended = await authorizedOrder(unreachable, ids.hat, 1);
    const old = await authorizedOrder(unreachable, ids.tshirt, 1);
    const recent = await authorizedOrder(unreachable, ids.hat, 1);
    await shop(sent.id, "completed");
    await shop(ended.id, "cancelled");
    expect(await notesWith(sent.id, "Webshoppen kunne ikke få besked om betalingen (HTTP 404)")).toHaveLength(1);
    expect(stripe.calls.capture).toBe(0);
    await wpEval(`$o = wc_get_order(${old.id}); $o->update_meta_data('_wchc_authorized_at', time() - 6 * DAY_IN_SECONDS); $o->save();`);

    const run = await runSettleSweep(depsFor(stripe));
    expect(run.warned).toBe(1);
    expect(await getOrder(sent.id)).toMatchObject({ status: "completed", transaction_id: sent.pi });
    expect((await stripe.retrieve(ended.pi)).status).toBe("canceled");
    expect(metaValue(await getOrder(ended.id), "_wchc_capture_status")).toBe("released");
    expect(await notesWith(old.id, "reserveret i mere end 5 dage")).toHaveLength(1);
    expect(await notesWith(recent.id, "reserveret i mere end 5 dage")).toHaveLength(0);
    const warning = await adminMails(`Reservationen for ordre #${old.id} udløber snart`);
    expect(warning).toHaveLength(1);
    expect(warning[0]!.message).toContain(`Ordre #${old.id}`);

    // The next run has nothing new: no second capture, release or warning.
    expect((await runSettleSweep(depsFor(stripe))).warned).toBe(0);
    expect((await sweepPayments(storeId)).settle.map((o) => o.id)).not.toEqual(expect.arrayContaining([sent.id]));
    expect((await sweepPayments(storeId)).settle.map((o) => o.id)).not.toEqual(expect.arrayContaining([ended.id]));
    expect(stripe.calls.capture).toBe(1);
    expect(await notesWith(old.id, "reserveret i mere end 5 dage")).toHaveLength(1);
  });

  it("leaves an order paid before capture at shipment (charged at once) alone when it is completed", async () => {
    const stripe = new FakeStripe();
    const deps = depsFor(stripe);
    const checkoutId = `chk_cap_${Date.now().toString(36)}_old`;
    const ready = await startCheckout(await requestFor(ids.tshirt, 1), { checkoutId }, deps);
    if (ready.type !== "ready") throw new Error(`Expected ready, got ${ready.type}`);
    stripe.intents.get(ready.paymentIntentId)!.capture_method = "automatic"; // created by the previous version
    stripe.succeed(ready.paymentIntentId);
    await handleStripeEvent(eventFor({ id: ready.paymentIntentId }, "payment_intent.succeeded"), deps);
    const paid = await getOrder(ready.order.id);
    expect(paid).toMatchObject({ status: "processing", transaction_id: ready.paymentIntentId });
    expect(metaValue(paid, "_wchc_capture_status")).toBeUndefined();

    await shop(ready.order.id, "completed");
    expect(state.callbacks).toHaveLength(0);
    expect(await getOrder(ready.order.id)).toMatchObject({ status: "completed", transaction_id: ready.paymentIntentId });
    expect((await getOrderDetails(ready.order.id, ready.order.key))?.capture).toBeNull();
    expect((await sweepPayments(storeId)).settle.map((o) => o.id)).not.toContain(ready.order.id);
    expect(await notesWith(ready.order.id, "trukket")).toHaveLength(0);
    expect(stripe.calls.capture).toBe(0);
  });
});
