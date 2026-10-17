import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({ revalidateTag: (...args: unknown[]) => revalidateTag(...args), cacheLife: () => {}, cacheTag: () => {} }));

let revalidate: typeof import("./revalidate");

beforeEach(async () => {
  revalidateTag.mockClear();
  vi.useFakeTimers();
  vi.resetModules(); // the 5-minute memory belongs to the server instance
  revalidate = await import("./revalidate");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("catalogue revalidation", () => {
  it("marks a product's entries stale every time, with stale-while-revalidate", () => {
    revalidate.revalidateProduct(5);
    revalidate.revalidateProduct(5);
    expect(revalidateTag.mock.calls).toEqual([
      ["wc-product-5", "max"],
      ["wc-product-5", "max"],
    ]);
  });

  it("marks the whole catalogue stale at most once per 5 minutes", () => {
    expect(revalidate.revalidateCatalog()).toBe(true);
    vi.advanceTimersByTime(4 * 60_000);
    expect(revalidate.revalidateCatalog()).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(revalidate.revalidateCatalog()).toBe(true);
    expect(revalidateTag.mock.calls).toEqual([
      ["wc-catalog", "max"],
      ["wc-catalog", "max"],
    ]);
  });
});
