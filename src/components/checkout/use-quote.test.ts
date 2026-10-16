import { describe, expect, it } from "vitest";
import { quoteProgress } from "./use-quote";

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
