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

describe("openGraphFor", () => {
  it("names the page's address and keeps the shop's share image unless the page has its own", async () => {
    const { openGraphFor } = await import("./seo");
    expect(openGraphFor("/faq")).toMatchObject({ url: "/faq", images: [{ url: "/opengraph-image", width: 1200, height: 630 }] });
    expect(openGraphFor("https://x.dk/produkter/a", [{ url: "https://img/a.jpg", alt: "A" }]).images).toEqual([{ url: "https://img/a.jpg", alt: "A" }]);
  });

  it("names the type, the shop and the language on every page", async () => {
    vi.resetModules();
    const { openGraphFor } = await import("./seo");
    expect(openGraphFor("/faq")).toMatchObject({ type: "website", siteName: "Fastelavnskostumer.dk", locale: "da_DK" });
  });
});

describe("shopData", () => {
  it("gives search engines the company's name, address, phone and VAT number", async () => {
    vi.resetModules();
    const { shopData } = await import("./seo");
    const store = shopData()["@graph"][0]!;
    expect(store).toMatchObject({
      "@type": "OnlineStore",
      legalName: "Frost Digital ApS",
      address: { "@type": "PostalAddress", streetAddress: "Arnold Nielsens Boulevard 62 B", postalCode: "2650", addressLocality: "Hvidovre", addressCountry: "DK" },
      telephone: "+45 41 82 67 99",
      vatID: "DK45737632",
    });
  });
});
