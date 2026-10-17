import { afterEach, describe, expect, it, vi } from "vitest";
import { describeError } from "./log";

async function freshEnv(values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
  vi.resetModules();
  return import("./env");
}

describe("env", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("trims secrets pasted with surrounding whitespace", async () => {
    const env = await freshEnv({
      STRIPE_SECRET_KEY: "sk_test_abc\n",
      STRIPE_WEBHOOK_SECRET: " whsec_abc\r\n",
      WOOCOMMERCE_URL: " https://shop.example/ \n",
      WOOCOMMERCE_CONSUMER_KEY: "ck_abc ",
      WOOCOMMERCE_CONSUMER_SECRET: "\tcs_abc",
    });
    expect(env.stripeEnv().STRIPE_SECRET_KEY).toBe("sk_test_abc");
    expect(env.stripeWebhookEnv().STRIPE_WEBHOOK_SECRET).toBe("whsec_abc");
    expect(env.wooEnv()).toMatchObject({
      WOOCOMMERCE_URL: "https://shop.example",
      WOOCOMMERCE_CONSUMER_KEY: "ck_abc",
      WOOCOMMERCE_CONSUMER_SECRET: "cs_abc",
    });
  });

  it("names invalid variables without revealing their values", async () => {
    const env = await freshEnv({ STRIPE_SECRET_KEY: "pk_test_secretvalue" });
    expect(() => env.stripeEnv()).toThrow(env.ConfigError);
    expect(() => env.stripeEnv()).toThrow(/STRIPE_SECRET_KEY/);
    expect(() => env.stripeEnv()).not.toThrow(/secretvalue/);
  });
});

describe("describeError", () => {
  it("includes the underlying cause of a wrapped error", () => {
    const wrapped = Object.assign(new Error("An error occurred with our connection to Stripe."), {
      detail: new TypeError('Invalid character in header content ["Authorization"]'),
    });
    expect(describeError(wrapped)).toBe(
      'An error occurred with our connection to Stripe. (cause: Invalid character in header content ["Authorization"])',
    );
    expect(describeError(new Error("outer", { cause: new Error("inner") }))).toBe("outer (cause: inner)");
    expect(describeError(new Error("plain"))).toBe("plain");

    const socket = Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" });
    const fetchFailed = new TypeError("fetch failed", { cause: socket });
    expect(describeError(new Error("WooCommerce is unreachable (POST x, attempt 1/1)", { cause: fetchFailed }))).toBe(
      "WooCommerce is unreachable (POST x, attempt 1/1) (cause: fetch failed <- other side closed [UND_ERR_SOCKET])",
    );
    expect(describeError("not an error")).toBe("unknown error");
  });
});
