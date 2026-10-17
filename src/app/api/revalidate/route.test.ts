import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({ revalidateTag: (...args: unknown[]) => revalidateTag(...args), cacheLife: () => {}, cacheTag: () => {} }));

const SECRET = "test-webhook-secret";

/** A WooCommerce webhook delivery: the product (or variation) as JSON, signed. */
function delivery(topic: string | null, body: unknown, secret = SECRET) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const headers: Record<string, string> = { "x-wc-webhook-signature": createHmac("sha256", secret).update(text, "utf8").digest("base64") };
  if (topic) headers["x-wc-webhook-topic"] = topic;
  return new Request("https://shop.example/api/revalidate", { method: "POST", headers, body: text });
}

let POST: (request: Request) => Promise<Response>;
const tags = () => revalidateTag.mock.calls.map((call) => call[0]);

beforeEach(async () => {
  revalidateTag.mockClear();
  vi.stubEnv("WOOCOMMERCE_WEBHOOK_SECRET", SECRET);
  vi.useFakeTimers();
  vi.resetModules(); // the once-per-5-minutes memory belongs to the server instance
  ({ POST } = await import("./route"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("POST /api/revalidate", () => {
  it("answers 503 without a secret and 401 for a wrong signature, and marks nothing stale", async () => {
    expect((await POST(delivery("product.updated", { id: 5, status: "publish" }, "wrong"))).status).toBe(401);
    vi.stubEnv("WOOCOMMERCE_WEBHOOK_SECRET", "");
    expect((await POST(delivery("product.updated", { id: 5, status: "publish" }))).status).toBe(503);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("marks only the changed product stale when it is updated (price, stock, text)", async () => {
    const response = await POST(delivery("product.updated", { id: 5, status: "publish" }));
    expect(await response.json()).toEqual({ ok: true, product: 5, catalog: false });
    expect(revalidateTag.mock.calls).toEqual([["wc-product-5", "max"]]);
  });

  it("marks a variation's product stale, not the lists, also when the size is disabled", async () => {
    await POST(delivery("product.updated", { id: 51, parent_id: 5, status: "private" }));
    expect(tags()).toEqual(["wc-product-5"]);
  });

  it("marks the lists stale too when products come or go: created, deleted, restored, unpublished", async () => {
    for (const [i, [topic, body]] of ([
      ["product.created", { id: 6, status: "publish" }],
      ["product.deleted", { id: 7 }],
      ["product.restored", { id: 8, status: "publish" }],
      ["product.updated", { id: 9, status: "draft" }],
    ] as const).entries()) {
      revalidateTag.mockClear();
      await POST(delivery(topic, body));
      expect(tags(), topic).toEqual([`wc-product-${body.id}`, "wc-catalog"]);
      vi.advanceTimersByTime(5 * 60_000 + i);
    }
  });

  it("marks the lists stale at most once per 5 minutes, e.g. during an import", async () => {
    await POST(delivery("product.created", { id: 1, status: "publish" }));
    vi.advanceTimersByTime(60_000);
    const later = await POST(delivery("product.created", { id: 2, status: "publish" }));
    expect((await later.json()).catalog).toBe(false);
    expect(tags()).toEqual(["wc-product-1", "wc-catalog", "wc-product-2"]);
    vi.advanceTimersByTime(4 * 60_000);
    await POST(delivery("product.deleted", { id: 3 }));
    expect(tags().slice(-2)).toEqual(["wc-product-3", "wc-catalog"]);
  });

  it("treats a delivery without a known topic as a change to the lists, and answers WooCommerce's ping", async () => {
    await POST(delivery(null, { id: 4, status: "publish" }));
    expect(tags()).toEqual(["wc-product-4", "wc-catalog"]);
    revalidateTag.mockClear();
    expect(await (await POST(delivery("product.updated", "webhook_id=12"))).json()).toEqual({ ok: true, ping: true });
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
