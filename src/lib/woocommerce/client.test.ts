import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createOrder, fetchQuote } from "./checkout-api";
import { WooCommerceError, wooRequest } from "./client";

/** Answers each request with the next status; 200 with `{ ok: true }`, otherwise a WooCommerce-style error. */
function respond(...statuses: number[]) {
  const fetch = vi.fn(async () => {
    const status = statuses.shift() ?? 200;
    return Response.json(status === 200 ? { ok: true } : { code: `http_${status}` }, { status });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** Runs the request to the end, fast-forwarding the waits between attempts. */
async function settle<T>(request: Promise<T>): Promise<{ value?: T; error?: unknown }> {
  const result = request.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.runAllTimersAsync();
  return result;
}

const okSchema = z.object({ ok: z.literal(true) });

beforeEach(() => {
  vi.stubEnv("WOOCOMMERCE_URL", "https://woo.example");
  vi.stubEnv("WOOCOMMERCE_CONSUMER_KEY", "ck_test");
  vi.stubEnv("WOOCOMMERCE_CONSUMER_SECRET", "cs_test");
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("wooRequest retries", () => {
  it("retries a GET when the host is busy", async () => {
    const fetch = respond(508, 200);
    const { value } = await settle(wooRequest("wc/v3/products", { schema: okSchema }));
    expect(value?.data).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries a POST marked `retry`, at most three attempts in all", async () => {
    const fetch = respond(503, 503, 503, 200);
    const { error } = await settle(wooRequest("wc-headless/v1/quote", { method: "POST", body: {}, schema: okSchema, retry: true }));
    expect(error).toBeInstanceOf(WooCommerceError);
    expect((error as WooCommerceError).status).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("sends any other POST once", async () => {
    const fetch = respond(508, 200);
    const { error } = await settle(wooRequest("wc-headless/v1/orders", { method: "POST", body: {}, schema: okSchema }));
    expect((error as WooCommerceError).status).toBe(508);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry an answer that will not change (4xx)", async () => {
    const fetch = respond(400, 200);
    const { error } = await settle(wooRequest("wc-headless/v1/quote", { method: "POST", body: {}, schema: okSchema, retry: true }));
    expect((error as WooCommerceError).status).toBe(400);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("checkout endpoints", () => {
  const items = [{ product_id: 1, variation_id: 0, quantity: 1 }];

  it("retries the quote, which creates nothing", async () => {
    // Busy twice, then an error that ends the attempts: three requests were sent.
    const fetch = respond(508, 508, 400);
    const { error } = await settle(fetchQuote({ store_id: "piece-dk", items, address: { country: "DK" } }));
    expect((error as WooCommerceError).status).toBe(400);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("never retries creating an order", async () => {
    const fetch = respond(508, 200);
    const order = createOrder({
      checkout_id: "chk_test",
      store_id: "piece-dk",
      items,
      billing: { first_name: "A", last_name: "B", address_1: "Vej 1", postcode: "8000", city: "Aarhus C", country: "DK", email: "a@example.com" },
      shipping: { first_name: "A", last_name: "B", address_1: "Vej 1", postcode: "8000", city: "Aarhus C", country: "DK" },
      shipping_rate_id: null,
      expected_total: "100.00",
      payment_method_title: "Stripe",
      coupons: [],
    });
    const { error } = await settle(order);
    expect((error as WooCommerceError).status).toBe(508);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
