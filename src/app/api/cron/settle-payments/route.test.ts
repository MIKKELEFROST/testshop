import { afterEach, describe, expect, it, vi } from "vitest";

/** The daily safety net only runs for Vercel's cron (or someone with CRON_SECRET). */

const state = vi.hoisted(() => ({ runs: 0 }));

vi.mock("@/lib/checkout/deps", () => ({ settleDeps: () => ({}) }));
vi.mock("@/lib/checkout/settle", () => ({
  runSettleSweep: async () => {
    state.runs += 1;
    return { listed: 2, captured: 1, released: 1, refunded: 0, captureFailed: 0, ignored: 0, failed: 0, skipped: 0, warned: 0 };
  },
}));

const SECRET = "cron-secret-for-unit-tests-0123";

async function get(authorization?: string) {
  vi.resetModules();
  const { GET } = await import("./route");
  return GET(new Request("https://shop.test/api/cron/settle-payments", { headers: authorization ? { authorization } : {} }));
}

describe("GET /api/cron/settle-payments", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    state.runs = 0;
  });

  it("runs with Vercel's Authorization header", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const response = await get(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ captured: 1, released: 1 });
    expect(state.runs).toBe(1);
  });

  it("refuses other callers, and runs nothing without CRON_SECRET", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    expect((await get()).status).toBe(401);
    expect((await get(`Bearer ${SECRET}x`)).status).toBe(401);
    expect((await get(SECRET)).status).toBe(401);

    vi.stubEnv("CRON_SECRET", "");
    expect((await get("Bearer ")).status).toBe(503);
    expect(state.runs).toBe(0);
  });
});
