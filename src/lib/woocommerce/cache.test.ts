import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cacheLife = vi.fn();
vi.mock("next/cache", () => ({ cacheLife: (...args: unknown[]) => cacheLife(...args) }));

const { FAILURE_LIFE, CATALOG, fetched, orFailure } = await import("./cache");

const down = () => Promise.reject(new Error("WooCommerce is unreachable"));

beforeEach(() => {
  cacheLife.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("fetched", () => {
  it("passes the data on and sets the read's lifetime", async () => {
    expect(await fetched("read", CATALOG, async () => ["a"])).toEqual({ ok: true, data: ["a"] });
    expect(cacheLife).toHaveBeenCalledWith(CATALOG);
  });

  it("logs a failure and throws it on, so Next.js saves nothing and keeps the last good entry", async () => {
    await expect(fetched("read", CATALOG, down)).rejects.toThrow("WooCommerce is unreachable");
    expect(console.error).toHaveBeenCalledWith("[catalog] read failed:", "WooCommerce is unreachable");
    expect(cacheLife).not.toHaveBeenCalled();
    // The uncached caller shows its fallback.
    expect(await fetched("read", CATALOG, down).catch(orFailure)).toEqual({ ok: false });
  });

  it("caches a failure for 30 s instead while building (Next.js fails a build on errors in caches)", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    expect(await fetched("read", CATALOG, down)).toEqual({ ok: false });
    expect(cacheLife).toHaveBeenCalledWith(FAILURE_LIFE);
  });
});
