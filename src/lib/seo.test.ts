import { afterEach, describe, expect, it, vi } from "vitest";

async function siteUrl(env: Record<string, string>) {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  vi.resetModules();
  const seo = await import("./seo");
  return { SITE_URL: seo.SITE_URL, product: seo.absoluteUrl("/produkter/heks") };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SITE_URL", () => {
  it("is NEXT_PUBLIC_SITE_URL when set, without a trailing slash", async () => {
    expect(await siteUrl({ NEXT_PUBLIC_SITE_URL: "https://preview.vercel.app/" })).toEqual({
      SITE_URL: "https://preview.vercel.app",
      product: "https://preview.vercel.app/produkter/heks",
    });
  });

  it("is never a vercel.app address in production: the shop's own domain instead", async () => {
    expect((await siteUrl({ NEXT_PUBLIC_SITE_URL: "https://testshop-weld.vercel.app", VERCEL_ENV: "production", NEXT_PUBLIC_STORE_ID: "piece-dk" })).SITE_URL).toBe("https://fastelavnskostumer.dk");
    // A preview keeps its own address, and production keeps a domain that was set.
    expect((await siteUrl({ NEXT_PUBLIC_SITE_URL: "https://testshop-weld-git-x.vercel.app", VERCEL_ENV: "preview" })).SITE_URL).toBe("https://testshop-weld-git-x.vercel.app");
    expect((await siteUrl({ NEXT_PUBLIC_SITE_URL: "https://www.fastelavnskostumer.dk", VERCEL_ENV: "production" })).SITE_URL).toBe("https://www.fastelavnskostumer.dk");
  });

  it("is the brand's own domain otherwise, never localhost", async () => {
    expect((await siteUrl({ NEXT_PUBLIC_SITE_URL: "", NEXT_PUBLIC_STORE_ID: "piece-dk" })).SITE_URL).toBe("https://fastelavnskostumer.dk");
    expect((await siteUrl({ NEXT_PUBLIC_SITE_URL: "", NEXT_PUBLIC_STORE_ID: "halloween-kostumer-dk" })).product).toBe("https://halloweenkostumer.dk/produkter/heks");
  });
});
