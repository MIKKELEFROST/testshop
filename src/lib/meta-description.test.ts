import { describe, expect, it } from "vitest";
import { categoryDescription, DESCRIPTION_LENGTH, productDescription, shorten } from "./meta-description";

const shop = "Fastelavnskostumer.dk";

const pirate = {
  name: "Piratkostume til drenge",
  price: "199",
  priceRange: { min: "199", max: "199" },
  shortDescription: ["Kostume til drenge med skjorte og hat"],
  attributes: [{ name: "Størrelse", slug: "pa_stoerrelse", options: ["3-4 år", "5-6 år", "7-9 år", "10-12 år"] }],
};

describe("productDescription", () => {
  it("names the price, text, sizes, holiday, promises and shop when they fit", () => {
    const short = { ...pirate, name: "Piratkostume", shortDescription: ["Med hat"], attributes: [{ name: "Størrelse", slug: "x", options: ["S", "M"] }] };
    expect(productDescription(short, { shop, season: "fastelavn" })).toBe(
      "Piratkostume – 199 kr. Med hat. Str. S, M. Klar til fastelavn med 1-dags levering og gratis retur i 30 dage hos Fastelavnskostumer.dk.",
    );
  });

  it("stays within the length search engines show: without the shop, then without the sizes", () => {
    const text = productDescription(pirate, { shop, season: "fastelavn" });
    expect(text).toBe("Piratkostume til drenge – 199 kr. Kostume til drenge med skjorte og hat. Klar til fastelavn med 1-dags levering og gratis retur i 30 dage.");
    expect(productDescription({ ...pirate, shortDescription: ["Med hat og sabel"] }, { shop, season: "fastelavn" })).toBe(
      "Piratkostume til drenge – 199 kr. Med hat og sabel. Str. 3-4 år til 10-12 år. Klar til fastelavn med 1-dags levering og gratis retur i 30 dage.",
    );
  });

  it("shortens a long text", () => {
    const long = { ...pirate, shortDescription: ["Kostume til drenge med skjorte, bukser, bælte, hat og øjenklap – alt det, en rigtig pirat skal bruge på de syv have"] };
    const text = productDescription(long, { shop, season: "fastelavn" });
    expect(text.length).toBeLessThanOrEqual(DESCRIPTION_LENGTH);
    expect(text).toMatch(/^Piratkostume til drenge – 199 kr\. Kostume til drenge med skjorte, bukser.*… Klar til fastelavn med 1-dags levering og gratis retur i 30 dage\.$/);
  });

  it("says 'fra' for sizes at different prices, and three sizes or fewer by name", () => {
    const text = productDescription(
      { ...pirate, priceRange: { min: "149", max: "199.5" }, shortDescription: ["Med hat"], attributes: [{ name: "Størrelse", slug: "x", options: ["S", "M", "L"] }] },
      { shop, season: null },
    );
    expect(text).toBe("Piratkostume til drenge – fra 149 kr. Med hat. Str. S, M, L. 1-dags levering og gratis retur i 30 dage hos Fastelavnskostumer.dk.");
  });

  it("leaves out the holiday when the name says it, and works without price, text or sizes", () => {
    const text = productDescription(
      { name: "Halloween græskarlygte", price: null, priceRange: null, shortDescription: [], attributes: [] },
      { shop: "Halloweenkostumer.dk", season: "halloween" },
    );
    expect(text).toBe("Halloween græskarlygte. 1-dags levering og gratis retur i 30 dage hos Halloweenkostumer.dk.");
  });

  it("shows simple products' price without øre", () => {
    expect(productDescription({ ...pirate, priceRange: null, price: "49.00", attributes: [] }, { shop, season: null })).toMatch(/^Piratkostume til drenge – 49 kr\. /);
  });
});

describe("categoryDescription", () => {
  it("names the category, its number of products and the promises", () => {
    expect(categoryDescription({ name: "Pigekostumer", count: 812 }, shop)).toBe(
      "Pigekostumer hos Fastelavnskostumer.dk: 812 varer med 1-dags levering (bestil før kl. 19 på hverdage) og gratis retur i 30 dage.",
    );
  });
});

describe("shorten", () => {
  it("cuts at a word boundary with an ellipsis", () => {
    expect(shorten("Et kort ord", 20)).toBe("Et kort ord");
    expect(shorten("Kostume til drenge med skjorte, bukser og hat", 30)).toBe("Kostume til drenge med…");
  });
});
