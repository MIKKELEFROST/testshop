import { describe, expect, it } from "vitest";
import { isTemporaryQuoteFailure, QUOTE_RETRY_DELAYS_MS, quoteRetryDelay } from "./quote-retry";

describe("quote retries in the browser", () => {
  it("retries twice with a growing wait when WooCommerce is busy or the connection dropped", () => {
    for (const failure of [
      { status: 503, code: "backend_unavailable" },
      { status: 0, code: "network" },
      { status: 504, code: null },
    ]) {
      expect(quoteRetryDelay(failure, 0)).toBe(QUOTE_RETRY_DELAYS_MS[0]);
      expect(quoteRetryDelay(failure, 1)).toBe(QUOTE_RETRY_DELAYS_MS[1]);
      expect(quoteRetryDelay(failure, 2)).toBeNull();
    }
    expect(QUOTE_RETRY_DELAYS_MS[1]!).toBeGreaterThan(QUOTE_RETRY_DELAYS_MS[0]!);
  });

  it("does not retry answers that will not change", () => {
    expect(quoteRetryDelay({ status: 400, code: "invalid_request" }, 0)).toBeNull();
    expect(quoteRetryDelay({ status: 429, code: "rate_limited" }, 0)).toBeNull();
    expect(quoteRetryDelay({ status: 503, code: "not_configured" }, 0)).toBeNull();
  });

  it("treats only outages as temporary, so the cart can still go to the checkout", () => {
    expect(isTemporaryQuoteFailure({ status: 503, code: "backend_unavailable" })).toBe(true);
    expect(isTemporaryQuoteFailure({ status: 0, code: "network" })).toBe(true);
    expect(isTemporaryQuoteFailure({ status: 400, code: "invalid_request" })).toBe(false);
    expect(isTemporaryQuoteFailure({ status: 503, code: "not_configured" })).toBe(false);
  });
});
