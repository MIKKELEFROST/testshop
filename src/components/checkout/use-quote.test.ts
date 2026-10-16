import { describe, expect, it } from "vitest";
import { ESTIMATE_ADDRESS, type ClientQuote } from "@/lib/checkout/quote";
import { quotePayload, quoteProgress, recentQuote, rememberQuote } from "./use-quote";

const failed = { error: "Vi kan ikke beregne priser lige nu. Prøv igen om lidt.", failure: { status: 503, code: "backend_busy" } };
const want = (attempt: number, manual = false) => ({ payload: "{}", attempt, manual });

describe("quote progress", () => {
  it("loads until the first answer for this cart and address", () => {
    expect(quoteProgress(true, want(0), null)).toEqual({ loading: true, retrying: false, shown: null });
    expect(quoteProgress(true, want(0), { attempt: 0, error: null, failure: null })).toMatchObject({ loading: false, retrying: false });
  });

  it("keeps the error shown, not loading, while an automatic retry runs", () => {
    const progress = quoteProgress(true, want(1), { attempt: 0, ...failed });
    expect(progress).toEqual({ loading: false, retrying: false, shown: { attempt: 0, ...failed } });
  });

  it("keeps the error and its button while \"Prøv igen\" runs, so focus stays on it", () => {
    const progress = quoteProgress(true, want(1, true), { attempt: 0, ...failed });
    expect(progress.loading).toBe(true);
    expect(progress.retrying).toBe(true);
    expect(progress.shown?.error).toBe(failed.error);
  });

  it("is done retrying once the answer for that attempt is here", () => {
    expect(quoteProgress(true, want(1, true), { attempt: 1, error: null, failure: null })).toMatchObject({ loading: false, retrying: false });
    expect(quoteProgress(true, want(1, true), { attempt: 1, ...failed })).toMatchObject({ loading: false, retrying: false, shown: { error: failed.error } });
  });

  it("shows nothing while it is not fetched", () => {
    expect(quoteProgress(false, want(1, true), { attempt: 0, ...failed })).toEqual({ loading: false, retrying: false, shown: null });
  });
});

describe("recent quotes", () => {
  const lines = [{ productId: 18, variationId: 0, quantity: 1 }];
  const quote = { totals: { total: "218.00" } } as ClientQuote;

  it("gives the wallet the cart's quote for the same cart (the same request body)", () => {
    // The cart and the drawer ask without coupons; so does the wallet's estimate when none apply.
    const cart = quotePayload(lines, ESTIMATE_ADDRESS, null);
    expect(quotePayload(lines, ESTIMATE_ADDRESS, null, { codes: [] })).toBe(cart);
    rememberQuote(cart, quote, 1_000);
    expect(recentQuote(cart, 2_000)).toBe(quote);
    expect(recentQuote(quotePayload(lines, ESTIMATE_ADDRESS, null, { codes: ["test10"] }), 2_000)).toBeNull();
    expect(recentQuote(quotePayload([{ ...lines[0]!, quantity: 2 }], ESTIMATE_ADDRESS, null), 2_000)).toBeNull();
  });

  it("forgets them after 2 minutes, and keeps only a few", () => {
    const payload = quotePayload(lines, { country: "DK" }, null);
    rememberQuote(payload, quote, 0);
    expect(recentQuote(payload, 119_000)).toBe(quote);
    expect(recentQuote(payload, 120_000)).toBeNull();
    for (let i = 0; i < 10; i++) rememberQuote(`other ${i}`, quote, 0);
    expect(recentQuote(payload, 1_000)).toBeNull();
    expect(recentQuote("other 9", 1_000)).toBe(quote);
  });
});
