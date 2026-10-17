import { describe, expect, it } from "vitest";
import { isTemporaryQuoteFailure, QUOTE_RETRY_DELAY_MS, quoteFailureResponse, quoteRetryDelay, retryAfterMs } from "./quote-retry";

describe("quote retries in the browser", () => {
  it("asks once more by itself when there was no connection or WooCommerce was too busy", () => {
    for (const failure of [
      { status: 503, code: "backend_busy" },
      { status: 0, code: "network" },
    ]) {
      expect(quoteRetryDelay(failure, 0, () => 0)).toBe(QUOTE_RETRY_DELAY_MS);
      expect(quoteRetryDelay(failure, 1, () => 0)).toBeNull();
    }
  });

  it("waits as long as the server says, plus up to half again", () => {
    const busy = { status: 503, code: "backend_busy", retryAfterMs: 4000 };
    expect(quoteRetryDelay(busy, 0, () => 0)).toBe(4000);
    expect(quoteRetryDelay(busy, 0, () => 0.999)).toBe(5998);
    expect(quoteRetryDelay({ status: 0, code: "network" }, 0, () => 0.5)).toBe(QUOTE_RETRY_DELAY_MS * 1.25);
  });

  it("leaves a timeout and other outages to the customer's \"Prøv igen\"", () => {
    expect(quoteRetryDelay({ status: 504, code: "backend_timeout" }, 0)).toBeNull();
    expect(quoteRetryDelay({ status: 503, code: "backend_unavailable" }, 0)).toBeNull();
    expect(quoteRetryDelay({ status: 500, code: null }, 0)).toBeNull();
  });

  it("does not retry answers that will not change", () => {
    expect(quoteRetryDelay({ status: 400, code: "invalid_request" }, 0)).toBeNull();
    expect(quoteRetryDelay({ status: 429, code: "rate_limited", retryAfterMs: 1000 }, 0)).toBeNull();
    expect(quoteRetryDelay({ status: 503, code: "not_configured" }, 0)).toBeNull();
  });

  it("treats only outages as temporary, so the cart can still go to the checkout", () => {
    expect(isTemporaryQuoteFailure({ status: 503, code: "backend_busy" })).toBe(true);
    expect(isTemporaryQuoteFailure({ status: 504, code: "backend_timeout" })).toBe(true);
    expect(isTemporaryQuoteFailure({ status: 0, code: "network" })).toBe(true);
    expect(isTemporaryQuoteFailure({ status: 400, code: "invalid_request" })).toBe(false);
    expect(isTemporaryQuoteFailure({ status: 503, code: "not_configured" })).toBe(false);
  });

  it("reads Retry-After in seconds", () => {
    expect(retryAfterMs("2")).toBe(2000);
    expect(retryAfterMs(" 3 ")).toBe(3000);
    expect(retryAfterMs("600")).toBe(30_000);
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs("Wed, 21 Oct 2026 07:28:00 GMT")).toBeNull();
  });
});

describe("the quote route's failures", () => {
  it("reports a busy host as 503 with Retry-After, which the browser retries once", () => {
    for (const status of [508, 429, 503]) {
      const failure = quoteFailureResponse({ status, code: `http_${status}` });
      expect(failure).toMatchObject({ status: 503, code: "backend_busy" });
      expect(failure.retryAfter).toBeGreaterThan(0);
    }
  });

  it("reports a timeout as 504, which only the customer retries", () => {
    expect(quoteFailureResponse({ status: 0, code: "timeout" })).toEqual({ status: 504, code: "backend_timeout", retryAfter: null });
    expect(quoteFailureResponse({ status: 504, code: "http_504" }).code).toBe("backend_timeout");
  });

  it("reports anything else as unavailable (the server has retried a dropped connection already)", () => {
    expect(quoteFailureResponse({ status: 0, code: "network_error" })).toMatchObject({ status: 503, code: "backend_unavailable" });
    expect(quoteFailureResponse({ status: 502, code: "invalid_response" }).code).toBe("backend_unavailable");
    expect(quoteFailureResponse({ status: 500, code: "internal_server_error" }).code).toBe("backend_unavailable");
  });
});
