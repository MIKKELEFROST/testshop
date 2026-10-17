import { describe, expect, it } from "vitest";
import { failed, listingPaths, productPaths } from "../scripts/warm.mjs";

describe("scripts/warm.mjs", () => {
  it("takes the category and theme pages from the sitemap", () => {
    const sitemap = [
      "https://fastelavnskostumer.dk/",
      "https://fastelavnskostumer.dk/kategori/drengekostumer",
      "https://fastelavnskostumer.dk/tema/pirater",
      "https://fastelavnskostumer.dk/kategori/drengekostumer",
      "https://fastelavnskostumer.dk/produkter/pirat",
      "https://testshop-weld.vercel.app/kategori/masker",
      "not a url",
    ]
      .map((loc) => `<url><loc>${loc}</loc></url>`)
      .join("");
    expect(listingPaths(sitemap)).toEqual(["/kategori/drengekostumer", "/tema/pirater", "/kategori/masker"]);
  });

  it("finds the product pages a page links to, once each", () => {
    const html = '<a href="/produkter/pirat-kostume">x</a><a href="/produkter/pirat-kostume">y</a><a href="/produkter?side=2">z</a><a href="/produkter/heks">h</a>';
    expect(productPaths(html)).toEqual(["/produkter/pirat-kostume", "/produkter/heks"]);
  });

  it("stops at a server error or a page in its retry state", () => {
    expect(failed(200, "<h1>Pirat</h1>")).toBe(false);
    expect(failed(503, "")).toBe(true);
    expect(failed(200, "<p>Vi henter produktet …</p>")).toBe(true);
    expect(failed(200, "<p>Vi henter varerne …</p>")).toBe(true);
    expect(failed(200, "<p>Vi søger …</p>")).toBe(true);
  });
});
