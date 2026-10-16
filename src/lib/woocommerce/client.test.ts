import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

type Client = typeof import("./client");
type CheckoutApi = typeof import("./checkout-api");

// Fresh modules for each test: the breaker belongs to the server instance (module state).
let WooCommerceError: Client["WooCommerceError"];
let wooRequest: Client["wooRequest"];
let createOrder: CheckoutApi["createOrder"];
let fetchQuote: CheckoutApi["fetchQuote"];
let getOrderDetails: CheckoutApi["getOrderDetails"];

/** Answers each request with the next status; 200 with `{ ok: true }`, otherwise a WooCommerce-style error. */
function respond(...statuses: number[]) {
  const fetch = vi.fn(async () => {
    const status = statuses.shift() ?? 200;
    return Response.json(status === 200 ? { ok: true } : { code: `http_${status}` }, { status });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** A fetch whose requests stay open until answered. */
function hang() {
  const answers: (() => void)[] = [];
  const fetch = vi.fn(() => new Promise<Response>((resolve) => answers.push(() => resolve(Response.json({ ok: true })))));
  vi.stubGlobal("fetch", fetch);
  return { fetch, answers };
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
const read = () => wooRequest("wc/v3/products", { schema: okSchema });
const failure = (error: unknown) => error as InstanceType<Client["WooCommerceError"]>;
const timeout = () => new DOMException("The operation was aborted due to timeout", "TimeoutError");

beforeEach(async () => {
  vi.stubEnv("WOOCOMMERCE_URL", "https://woo.example");
  vi.stubEnv("WOOCOMMERCE_CONSUMER_KEY", "ck_test");
  vi.stubEnv("WOOCOMMERCE_CONSUMER_SECRET", "cs_test");
  vi.useFakeTimers();
  vi.resetModules();
  ({ WooCommerceError, wooRequest } = await import("./client"));
  ({ createOrder, fetchQuote, getOrderDetails } = await import("./checkout-api"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("wooRequest retries", () => {
  it("retries a GET when the host is busy", async () => {
    const fetch = respond(508, 200);
    const { value } = await settle(read());
    expect(value?.data).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("asks a busy host (508, 429) only once more", async () => {
    for (const busy of [508, 429]) {
      vi.resetModules();
      ({ wooRequest } = await import("./client"));
      const fetch = respond(busy, busy, 200);
      const { error } = await settle(read());
      expect(failure(error).status).toBe(busy);
      expect(fetch).toHaveBeenCalledTimes(2);
    }
  });

  it("retries a dropped connection and a 5xx, three attempts in all", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(Response.json({ code: "http_500" }, { status: 500 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    expect((await settle(read())).value?.data).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("does not retry a timeout: the host is still working on the request", async () => {
    const fetch = vi.fn().mockRejectedValue(timeout());
    vi.stubGlobal("fetch", fetch);
    expect(failure((await settle(read())).error).code).toBe("timeout");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("sends a POST marked `retry: \"connection\"` once more only after a dropped connection", async () => {
    const quote = () => wooRequest("wc-headless/v1/quote", { method: "POST", body: {}, schema: okSchema, retry: "connection" });
    const dropped = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", dropped);
    expect(failure((await settle(quote())).error).code).toBe("network_error");
    expect(dropped).toHaveBeenCalledTimes(2);

    for (const status of [508, 429, 503]) {
      const fetch = respond(status, 200);
      const { error } = await settle(quote());
      expect(error).toBeInstanceOf(WooCommerceError);
      expect(failure(error).status).toBe(status);
      expect(fetch).toHaveBeenCalledTimes(1);
    }
    const timedOut = vi.fn().mockRejectedValue(timeout());
    vi.stubGlobal("fetch", timedOut);
    expect(failure((await settle(quote())).error).code).toBe("timeout");
    expect(timedOut).toHaveBeenCalledTimes(1);
  });

  it("stops when the caller's signal aborts, also between attempts", async () => {
    const controller = new AbortController();
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetch);
    const request = wooRequest("wc-headless/v1/quote", { method: "POST", body: {}, schema: okSchema, retry: "connection", signal: controller.signal });
    const result = request.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.runAllTimersAsync();
    expect(failure(await result).code).toBe("cancelled");
    expect(fetch).toHaveBeenCalledTimes(1);

    // Aborted while WooCommerce works on it: passed on to fetch, and not taken for a timeout.
    const inFlight = vi.fn((_url: URL, init: RequestInit) => new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))));
    vi.stubGlobal("fetch", inFlight);
    const again = new AbortController();
    const second = wooRequest("wc-headless/v1/quote", { method: "POST", body: {}, schema: okSchema, retry: "connection", signal: again.signal }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    again.abort();
    expect(failure(await second).code).toBe("cancelled");
    expect(inFlight).toHaveBeenCalledTimes(1);
  });

  it("sends any other POST once", async () => {
    const fetch = respond(508, 200);
    const { error } = await settle(wooRequest("wc-headless/v1/orders", { method: "POST", body: {}, schema: okSchema }));
    expect(failure(error).status).toBe(508);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry an answer that will not change (4xx)", async () => {
    const fetch = respond(400, 200);
    const { error } = await settle(wooRequest("wc-headless/v1/quote", { method: "POST", body: {}, schema: okSchema, retry: "connection" }));
    expect(failure(error).status).toBe(400);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("the breaker for reads", () => {
  it("does not ask WooCommerce again within 30 s of a read that found it overloaded", async () => {
    const fetch = respond(508, 508, 200);
    expect(failure((await settle(read())).error).status).toBe(508);
    expect(fetch).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(28_000);
    const { error } = await settle(read());
    expect(failure(error).code).toBe("circuit_open");
    expect(failure(error).retryable).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("then lets one probe through, waits twice as long after another failure, and closes on success", async () => {
    const fetch = respond(508, 508, 508, 200, 200);
    await settle(read());
    await vi.advanceTimersByTimeAsync(30_000);

    // The probe asks once.
    expect(failure((await settle(read())).error).status).toBe(508);
    expect(fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(58_000);
    expect(failure((await settle(read())).error).code).toBe("circuit_open");
    expect(fetch).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(2_000);
    expect((await settle(read())).value?.data).toEqual({ ok: true });
    expect((await settle(read())).value?.data).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it("waits at most 2 minutes between probes", async () => {
    const fetch = respond(508, 508, 508, 508, 508, 200);
    await settle(read()); // open for 30 s
    for (const wait of [30_000, 60_000, 120_000]) {
      await vi.advanceTimersByTimeAsync(wait);
      await settle(read()); // the probe fails: open for 60 s, 120 s, 120 s
    }
    expect(fetch).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(119_000);
    expect(failure((await settle(read())).error).code).toBe("circuit_open");
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await settle(read())).value?.data).toEqual({ ok: true });
  });

  it("lets only one probe through at a time", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeout()));
    expect(failure((await settle(read())).error).code).toBe("timeout");
    await vi.advanceTimersByTimeAsync(30_000);

    const { fetch, answers } = hang();
    const probe = read();
    await vi.advanceTimersByTimeAsync(0);
    expect(failure((await settle(read())).error).code).toBe("circuit_open");
    answers[0]!();
    expect((await probe).data).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    respond(200);
    expect((await settle(read())).value?.data).toEqual({ ok: true });
  });

  it("opens after a dropped connection, but not after an answer that is just an error", async () => {
    const fetch = respond(404, 500, 500, 500);
    expect(failure((await settle(read())).error).status).toBe(404);
    expect(failure((await settle(read())).error).status).toBe(500);
    expect(fetch).toHaveBeenCalledTimes(4);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    expect(failure((await settle(read())).error).code).toBe("network_error");
    expect(failure((await settle(read())).error).code).toBe("circuit_open");
  });

  it("stops the retries of reads under way once one of them has opened it", async () => {
    // Both find the host busy; the first to give up opens the breaker, so the other's retry is not sent.
    const fetch = respond(508, 508, 508, 200);
    const { value } = await settle(Promise.allSettled([read(), read()]));
    const codes = value!.map((result) => (result.status === "rejected" ? failure(result.reason).code : "ok"));
    expect(codes.sort()).toEqual(["circuit_open", "http_508"]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("never holds back writes, nor reading a paying customer's order", async () => {
    respond(508, 508);
    await settle(read());
    const fetch = respond(200, 200, 200);
    expect(failure((await settle(read())).error).code).toBe("circuit_open");
    await settle(fetchQuote({ store_id: "piece-dk", items: [], address: {} }));
    await settle(createOrder({} as Parameters<typeof createOrder>[0]));
    await settle(getOrderDetails(1, "wc_order_x"));
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe("the read queue", () => {
  it("gives up after 5 s without a free slot, without asking WooCommerce or opening the breaker", async () => {
    const { fetch, answers } = hang();
    const running = [read(), read(), read(), read()];
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(4);

    const queued = read().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(5_000);
    const error = await queued;
    expect(failure(error).code).toBe("busy");
    expect(failure(error).retryable).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(4);

    for (const answer of answers) answer();
    await Promise.all(running);
    respond(200);
    expect((await settle(read())).value?.data).toEqual({ ok: true });
  });

  it("starts a queued read as soon as a slot is free", async () => {
    const { fetch, answers } = hang();
    const running = [read(), read(), read(), read(), read()];
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetch).toHaveBeenCalledTimes(4);
    answers[0]!();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(5);
    for (const answer of answers.slice(1)) answer();
    await Promise.all(running);
  });
});

describe("checkout endpoints", () => {
  const items = [{ product_id: 1, variation_id: 0, quantity: 1 }];

  it("sends the quote, which creates nothing, again after a dropped connection", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError("other side closed")).mockResolvedValueOnce(Response.json({}, { status: 400 }));
    vi.stubGlobal("fetch", fetch);
    const { error } = await settle(fetchQuote({ store_id: "piece-dk", items, address: { country: "DK" } }));
    expect(failure(error).status).toBe(400);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
  });

  it("calculates a quote at most twice per cart and address while WooCommerce is in trouble", async () => {
    // The browser (use-quote.ts) and the route together, for each kind of outage.
    const { quoteFailureResponse, quoteRetryDelay } = await import("@/lib/checkout/quote-retry");
    // Calculations sent: busy once by the server and once more by the browser after Retry-After;
    // too slow only once; a dropped connection twice by the server, which the browser leaves be.
    const outages: [string, () => Promise<Response>, number][] = [
      ["busy", async () => Response.json({ code: "http_508" }, { status: 508 }), 2],
      ["too slow", async () => Promise.reject(timeout()), 1],
      ["connection dropped", async () => Promise.reject(new TypeError("other side closed")), 2],
    ];
    for (const [outage, answer, sent] of outages) {
      const fetch = vi.fn(answer);
      vi.stubGlobal("fetch", fetch);
      for (let attempt = 0; ; attempt++) {
        const { error } = await settle(fetchQuote({ store_id: "piece-dk", items, address: { country: "DK" } }));
        const route = quoteFailureResponse(failure(error));
        const delay = quoteRetryDelay({ status: route.status, code: route.code, retryAfterMs: route.retryAfter && route.retryAfter * 1000 }, attempt);
        if (delay === null) break;
        await vi.advanceTimersByTimeAsync(delay);
      }
      expect(fetch.mock.calls.length, outage).toBe(sent);
    }
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
    expect(failure(error).status).toBe(508);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
