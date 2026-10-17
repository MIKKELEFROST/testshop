import { beforeEach, describe, expect, it, vi } from "vitest";
import { settleToken } from "@/lib/checkout/settle";

/**
 * The plugin's callback when the shop has sent or cancelled orders: only orders with this
 * storefront's token are accepted, and they are settled after the answer.
 */

const SECRET = "sk_test_dummy_key_for_settle_tests";
const state = vi.hoisted(() => ({ settled: [] as { id: number; key: string }[][], later: [] as (() => unknown)[] }));

vi.mock("next/server", () => ({ after: (task: () => unknown) => state.later.push(task) }));
vi.mock("@/lib/checkout/deps", () => ({ settleSecret: () => SECRET, settleDeps: () => ({}) }));
vi.mock("@/lib/checkout/settle", async (original) => ({
  ...(await original<typeof import("@/lib/checkout/settle")>()),
  settleOrders: async (refs: { id: number; key: string }[]) => {
    state.settled.push(refs);
    return { outcomes: [], failed: 0, skipped: 0 };
  },
}));

const { POST } = await import("./route");

function callback(body: unknown, contentType = "application/json") {
  return new Request("https://shop.test/api/payments/settle", { method: "POST", headers: { "Content-Type": contentType }, body: JSON.stringify(body) });
}

const order = (id: number, token = settleToken(SECRET, "piece-dk", id, `wc_order_k${id}`)) => ({ id, order_key: `wc_order_k${id}`, token });

describe("POST /api/payments/settle", () => {
  beforeEach(() => {
    state.settled.length = 0;
    state.later.length = 0;
  });

  it("accepts the orders with this shop's token and settles them after answering", async () => {
    const response = await POST(callback({ orders: [order(101), order(102, "forged"), order(103)] }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: [101, 103], rejected: [102] });

    expect(state.settled).toEqual([]);
    for (const task of state.later) await task();
    expect(state.settled).toEqual([[{ id: 101, key: "wc_order_k101" }, { id: 103, key: "wc_order_k103" }]]);
  });

  it("refuses a request without a valid token, and does nothing", async () => {
    const otherShop = { ...order(101), token: settleToken(SECRET, "halloween-kostumer-dk", 101, "wc_order_k101") };
    for (const orders of [[order(101, "")], [order(101, "x".repeat(43))], [otherShop]]) {
      const response = await POST(callback({ orders }));
      expect(response.status).toBe(401);
    }
    // A token for another order key (e.g. one guessed from a confirmation link).
    expect((await POST(callback({ orders: [{ ...order(101), order_key: "wc_order_other" }] }))).status).toBe(401);
    expect(state.later).toEqual([]);
  });

  it("rejects malformed requests", async () => {
    expect((await POST(callback({ orders: [] }))).status).toBe(400);
    expect((await POST(callback({ orders: [{ id: "101", order_key: "wc_order_k101", token: "t" }] }))).status).toBe(400);
    expect((await POST(callback({ orders: [order(101)] }, "text/plain"))).status).toBe(400);
    expect(state.later).toEqual([]);
  });
});
