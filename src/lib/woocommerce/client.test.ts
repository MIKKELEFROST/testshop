import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

type Client = typeof import("./client");
type CheckoutApi = typeof import("./checkout-api");

// Fresh modules for each test: the breaker and the read slots belong to the server instance (module state).
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

/** A fetch whose requests stay open until answered, each on its own. */
function hang() {
  const answers: (() => void)[] = [];
  const fetch = vi.fn((url: URL) => {
    void url;
    return new Promise<Response>((resolve) => answers.push(() => resolve(Response.json({ ok: true }))));
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, answers };
}

/** A fetch whose requests stay open until `release()`; after that every request is answered at once. */
function hold() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const fetch = vi.fn(async () => {
    await gate;
    return Response.json({ ok: true });
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, release };
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
const get = (path: string, priority?: "critical" | "background") => wooRequest(path, { schema: okSchema, priority });
/** A critical read (the default): e.g. a product. */
const read = () => get("wc/v3/products");
/** A background read: e.g. related products. */
const background = () => get("wc/v3/products/related", "background");
const failure = (error: unknown) => error as InstanceType<Client["WooCommerceError"]>;
/** The request's error, or undefined when it succeeded. */
const caught = (request: Promise<unknown>) => request.then(() => undefined, (error: unknown) => failure(error));
const timeout = () => new DOMException("The operation was aborted due to timeout", "TimeoutError");
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const pathOf = (call: unknown[]) => (call[0] as URL).pathname;

/**
 * Request timeouts on the fake clock (vitest's fake timers don't drive AbortSignal.timeout), and
 * a host that answers every request after `latency(url)` ms unless the request is aborted first.
 */
function slowHost(latency: (url: URL) => number) {
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(timeout()), ms);
    return controller.signal;
  });
  const fetch = vi.fn(
    (url: URL, init: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(Response.json({ ok: true })), latency(url));
        init.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(init.signal!.reason);
        });
      }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** Opens the breaker: three reads in a row find the host too slow (one request each). */
async function trip() {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeout()));
  for (let i = 0; i < 3; i++) expect(failure((await settle(read())).error).code).toBe("timeout");
}

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
  vi.restoreAllMocks();
});

describe("wooRequest retries", () => {
  it("retries a GET when the host is busy", async () => {
    const fetch = respond(508, 200);
    const { value } = await settle(read());
    expect(value?.data).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("asks a busy host (508, 429) twice more for a critical read, once more for a background read", async () => {
    for (const busy of [508, 429]) {
      vi.resetModules();
      ({ wooRequest } = await import("./client"));
      const critical = respond(busy, busy, busy, 200);
      expect(failure((await settle(read())).error).status).toBe(busy);
      expect(critical).toHaveBeenCalledTimes(3);
      const later = respond(busy, busy, 200);
      expect(failure((await settle(background())).error).status).toBe(busy);
      expect(later).toHaveBeenCalledTimes(2);
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
  it("stays closed after one or two reads that found the host down: the next read is sent", async () => {
    const fetch = respond(508, 508, 508, 508, 508, 508, 200, 200);
    expect(failure((await settle(read())).error).status).toBe(508);
    expect(failure((await settle(read())).error).status).toBe(508);
    expect((await settle(read())).value?.data).toEqual({ ok: true });
    expect((await settle(background())).value?.data).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(8);
  });

  it("opens after three within 10 s; background reads then fail at once without asking", async () => {
    await trip();
    const fetch = respond(200);
    const { error } = await settle(background());
    expect(failure(error).code).toBe("circuit_open");
    expect(failure(error).retryable).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forgets a read that found the host down more than 10 s ago", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeout()));
    await settle(read());
    await settle(read());
    await advance(10_001);
    await settle(read());
    const fetch = respond(200);
    expect((await settle(background())).value?.data).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("opens after timeouts and dropped connections, but not after answers that are just errors", async () => {
    const fetch = respond(404, 400, 500, 500, 500, 200);
    expect(failure((await settle(read())).error).status).toBe(404);
    expect(failure((await settle(read())).error).status).toBe(400);
    expect(failure((await settle(read())).error).status).toBe(500);
    expect((await settle(background())).value?.data).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(6);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    for (let i = 0; i < 3; i++) expect(failure((await settle(read())).error).code).toBe("network_error");
    expect(failure((await settle(background())).error).code).toBe("circuit_open");
  });

  it("sends a critical read as a trial 2 s after it opened instead of failing it; the answer closes it", async () => {
    await trip();
    const fetch = respond(200, 200);
    const request = read();
    await advance(1_900);
    expect(fetch).not.toHaveBeenCalled();
    await advance(100);
    expect((await request).data).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    // Closed again: background reads are sent.
    expect((await settle(background())).value?.data).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("lets critical reads wait for the trial under way, then go on as soon as it is answered", async () => {
    await trip();
    let answerTrial!: () => void;
    let calls = 0;
    const fetch = vi.fn((url: URL) => {
      void url;
      if (++calls === 1) return new Promise<Response>((resolve) => (answerTrial = () => resolve(Response.json({ ok: true }))));
      return Promise.resolve(Response.json({ ok: true }));
    });
    vi.stubGlobal("fetch", fetch);
    const reads = Array.from({ length: 6 }, () => caught(read()));
    await advance(2_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    await advance(1_500); // the others wait, they don't fail
    expect(fetch).toHaveBeenCalledTimes(1);
    answerTrial();
    const results = await Promise.all(reads);
    expect(results).toEqual(Array(6).fill(undefined));
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it("lets critical reads wait for a trial that takes longer than their 4 s: it may close the breaker", async () => {
    await trip();
    const fetch = slowHost(() => 3_000);
    const reads = Array.from({ length: 6 }, () => caught(read()));
    await advance(2_000 + 3_000); // the trial is answered: the others go on (4 at a time)
    expect(fetch).toHaveBeenCalledTimes(5);
    await advance(6_000);
    expect(await Promise.all(reads)).toEqual(Array(6).fill(undefined));
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it("closes when a trial is answered within the usual 10 s timeout, also after 5 s", async () => {
    await trip();
    const fetch = slowHost(() => 6_000);
    const request = read();
    await advance(2_000 + 6_000);
    expect((await request).data).toEqual({ ok: true });
    expect(AbortSignal.timeout).toHaveBeenCalledWith(10_000);
    // Closed: a background read is sent.
    const later = background();
    await advance(6_000);
    expect((await later).data).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("fails a critical read that got no turn within 4 s once no trial is under way", async () => {
    await trip();
    const answers: ((response: Response) => void)[] = [];
    const fetch = vi.fn((url: URL) => {
      void url;
      return new Promise<Response>((resolve) => answers.push(resolve));
    });
    vi.stubGlobal("fetch", fetch);
    const trial = caught(read());
    await advance(2_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    let settled = false;
    const waiting = caught(read()).finally(() => (settled = true));
    await advance(5_000); // past its 4 s, but the trial is under way
    expect(settled).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    answers[0]!(Response.json({ code: "http_508" }, { status: 508 }));
    expect((await trial)?.status).toBe(508);
    expect((await waiting)?.code).toBe("circuit_open");
    expect(fetch).toHaveBeenCalledTimes(1);

    // A read that comes now waits 2 s for the next trial.
    const next = read();
    await advance(1_900);
    expect(fetch).toHaveBeenCalledTimes(1);
    await advance(100);
    answers[1]!(Response.json({ ok: true }));
    expect((await next).data).toEqual({ ok: true });
  });

  it("sends a trial once, with the usual timeout, and the next one 2 s after a failed one", async () => {
    await trip();
    const timeouts = vi.spyOn(AbortSignal, "timeout");
    const fetch = respond(508, 200);
    const first = caught(read());
    await advance(2_000);
    expect((await first)?.status).toBe(508);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(timeouts).toHaveBeenLastCalledWith(10_000);

    const second = read();
    await advance(1_900);
    expect(fetch).toHaveBeenCalledTimes(1);
    await advance(100);
    expect((await second).data).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("never lets a background read be the trial, however long it has been open: a critical read is the trial at once", async () => {
    await trip();
    await advance(60_000);
    const fetch = slowHost((url) => (url.pathname.endsWith("/collection-data") ? 60_000 : 300));
    // E.g. a listing's facets, which the host counts slowly, and then the listing itself.
    const facets = caught(get("wc/store/v1/products/collection-data", "background"));
    await advance(100);
    const critical = [read(), read(), read()];
    await advance(300);
    expect((await facets)?.code).toBe("circuit_open");
    await advance(300);
    expect((await Promise.all(critical)).map((response) => response.data)).toEqual(Array(3).fill({ ok: true }));
    expect(fetch.mock.calls.map(pathOf)).toEqual(Array(3).fill("/wp-json/wc/v3/products"));
  });

  it("stops the retries of reads under way once it opens: background reads fail, critical ones wait for a trial", async () => {
    const busy = () => Response.json({ code: "http_508" }, { status: 508 });
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(timeout())
      .mockRejectedValueOnce(timeout())
      .mockResolvedValueOnce(busy())
      .mockResolvedValueOnce(busy())
      .mockRejectedValueOnce(timeout())
      .mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    await settle(read());
    await settle(read());
    // Both find the host busy and wait to ask again; meanwhile a third read opens the breaker.
    const later = caught(background());
    const critical = read();
    await advance(0);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(failure((await settle(read())).error).code).toBe("timeout");

    expect((await later)?.code).toBe("circuit_open");
    expect((await critical).data).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(6); // the critical read's retry was the trial
  });

  it("does not send a read that got a slot only after it opened, unless as the trial", async () => {
    // Up to 4 reads at a time: the others wait for a slot, and the breaker can open meanwhile.
    let healthy = false;
    const pending: { resolve: (response: Response) => void; reject: (error: unknown) => void }[] = [];
    const fetch = vi.fn((url: URL) => {
      void url;
      if (healthy) return Promise.resolve(Response.json({ ok: true }));
      return new Promise<Response>((resolve, reject) => pending.push({ resolve, reject }));
    });
    vi.stubGlobal("fetch", fetch);
    const reads = Array.from({ length: 8 }, () => caught(read()));
    await advance(0);
    expect(fetch).toHaveBeenCalledTimes(4);
    for (let i = 0; i < 3; i++) {
      pending[i]!.reject(timeout());
      await advance(0);
    }
    // Three timeouts opened it; a read whose slot came free after that was not sent.
    const sent = fetch.mock.calls.length;
    expect(sent).toBeLessThanOrEqual(7);
    pending[3]!.resolve(Response.json({ ok: true })); // sent before it opened: its answer does not close it
    await advance(0);
    expect(fetch).toHaveBeenCalledTimes(sent);
    await advance(2_000);
    expect(fetch).toHaveBeenCalledTimes(sent + 1); // one of them, as the trial

    healthy = true;
    for (const request of pending.slice(4)) request.resolve(Response.json({ ok: true }));
    const results = await Promise.all(reads);
    expect(results.filter((error) => error !== undefined).map((error) => error.code)).toEqual(["timeout", "timeout", "timeout"]);
    expect(fetch).toHaveBeenCalledTimes(8);
  });

  it("stays open when a read sent before it opened answers: only a trial closes it", async () => {
    // At the host's entry-process limit, requests it has already admitted still finish while new ones get 508.
    const fetch = vi.fn(async (url: URL) => {
      if (url.pathname.endsWith("/slow")) {
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        return Response.json({ ok: true });
      }
      throw timeout();
    });
    vi.stubGlobal("fetch", fetch);
    const slow = get("wc/v3/slow");
    const failed = await Promise.all([read(), read(), read()].map(caught));
    expect(failed.map((error) => error?.code)).toEqual(["timeout", "timeout", "timeout"]);
    await advance(3_000);
    expect((await slow).data).toEqual({ ok: true }); // answers after it opened
    expect(failure((await settle(background())).error).code).toBe("circuit_open");
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("never holds back writes, nor reading a paying customer's order", async () => {
    await trip();
    const fetch = respond(200, 200, 200);
    expect(failure((await settle(background())).error).code).toBe("circuit_open");
    await settle(fetchQuote({ store_id: "piece-dk", items: [], address: {} }));
    await settle(createOrder({} as Parameters<typeof createOrder>[0]));
    await settle(getOrderDetails(1, "wc_order_x"));
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe("the read slots", () => {
  it("lets a critical read wait 12 s for a free slot and a background read 3 s, without asking WooCommerce or opening the breaker", async () => {
    const { fetch, answers } = hang();
    const running = [read(), read(), read(), read()];
    await advance(0);
    expect(fetch).toHaveBeenCalledTimes(4);

    const later = caught(background());
    const critical = caught(read());
    await advance(3_000);
    expect((await later)?.code).toBe("busy");
    await advance(9_000);
    const error = await critical;
    expect(error?.code).toBe("busy");
    expect(error?.retryable).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(4);

    for (const answer of answers) answer();
    await Promise.all(running);
    respond(200);
    expect((await settle(background())).value?.data).toEqual({ ok: true });
  });

  it("keeps one of the four slots for critical reads", async () => {
    const { fetch, release } = hold();
    const later = [background(), background(), background(), background()];
    await advance(0);
    expect(fetch).toHaveBeenCalledTimes(3);
    const critical = read();
    await advance(0);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(pathOf(fetch.mock.calls[3]!)).toBe("/wp-json/wc/v3/products");
    release();
    await Promise.all([...later, critical]);
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it("gives a freed slot to a waiting critical read before background reads that waited longer", async () => {
    const { fetch, answers } = hang();
    const running = [read(), read(), read(), read()];
    await advance(0);
    const later = background();
    await advance(0);
    const critical = read();
    await advance(0);
    expect(fetch).toHaveBeenCalledTimes(4);
    answers[0]!();
    await advance(0);
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(pathOf(fetch.mock.calls[4]!)).toBe("/wp-json/wc/v3/products");
    // The background read gets a slot once two are free (one stays kept for critical reads).
    answers[1]!();
    await advance(0);
    expect(fetch).toHaveBeenCalledTimes(5);
    answers[2]!();
    await advance(0);
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(pathOf(fetch.mock.calls[5]!)).toBe("/wp-json/wc/v3/products/related");
    for (const answer of answers.slice(3)) answer();
    await Promise.all([...running, later, critical]);
  });

  it("starts a queued read as soon as a slot is free", async () => {
    const { fetch, answers } = hang();
    const running = [read(), read(), read(), read(), read()];
    await advance(1_000);
    expect(fetch).toHaveBeenCalledTimes(4);
    answers[0]!();
    await advance(0);
    expect(fetch).toHaveBeenCalledTimes(5);
    for (const answer of answers.slice(1)) answer();
    await Promise.all(running);
  });

  it("does not queue reading a paying customer's order behind slow catalogue reads", async () => {
    const { fetch, answers } = hang();
    const running = [read(), read(), read(), read()];
    await advance(0);
    const order = getOrderDetails(1, "wc_order_x").catch((error: unknown) => error);
    await advance(0);
    expect(fetch).toHaveBeenCalledTimes(5);
    for (const answer of answers) answer();
    await Promise.all([...running, order]);
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
