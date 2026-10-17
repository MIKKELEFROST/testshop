import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";
import { clientIp, isSameOrigin, readJson } from "./request";

describe("rate limiter", () => {
  it("allows up to the limit per window and then blocks", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000 });
    const t = 1_000_000;
    expect([1, 2, 3].map(() => limiter.check("ip", t).allowed)).toEqual([true, true, true]);
    const blocked = limiter.check("ip", t + 10);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(1);
    expect(limiter.check("other-ip", t).allowed).toBe(true);
    expect(limiter.check("ip", t + 1001).allowed).toBe(true);
  });

  it("bounds memory use", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 10 });
    for (let i = 0; i < 100; i++) limiter.check(`ip-${i}`, 0);
    expect(limiter.check("ip-new", 0).allowed).toBe(true);
  });
});

describe("request helpers", () => {
  const req = (headers: Record<string, string>) => new Request("http://shop.test/api/checkout", { method: "POST", headers });

  it("accepts same-origin and rejects cross-origin browser requests", () => {
    expect(isSameOrigin(req({ origin: "http://shop.test", host: "shop.test" }))).toBe(true);
    expect(isSameOrigin(req({ origin: "https://evil.example", host: "shop.test" }))).toBe(false);
    expect(isSameOrigin(req({ origin: "null", host: "shop.test" }))).toBe(false);
    expect(isSameOrigin(req({ host: "shop.test", "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isSameOrigin(req({ host: "shop.test" }))).toBe(true);
  });

  it("extracts the client IP from proxy headers", () => {
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe("203.0.113.5");
    expect(clientIp(req({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
    expect(clientIp(req({}))).toBe("unknown");
  });

  it("only parses bounded JSON bodies", async () => {
    const json = (body: string, type = "application/json") =>
      new Request("http://shop.test", { method: "POST", headers: { "content-type": type }, body });
    expect(await readJson(json('{"a":1}'))).toEqual({ a: 1 });
    expect(await readJson(json('{"a":1}', "text/plain"))).toBeUndefined();
    expect(await readJson(json("{bad"))).toBeUndefined();
    expect(await readJson(json(JSON.stringify({ a: "x".repeat(40_000) })))).toBeUndefined();
  });
});
