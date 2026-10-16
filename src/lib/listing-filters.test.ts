import { describe, expect, it } from "vitest";
import { activeFilterCount, filteredHref, filterParams, findSizeOption, parseFilters, priceBandsBetween, sizeGroups } from "./listing-filters";

// The live shop's size terms (pa_storrelse), as the Guirca import names them.
const TERMS = [
  { id: 28, name: "12-18 mdr." },
  { id: 29, name: "18-24 mdr." },
  { id: 158, name: "2-3 år" },
  { id: 21, name: "3-4 år" },
  { id: 160, name: "3-6 år" },
  { id: 22, name: "5-6 år" },
  { id: 161, name: "5-8 år" },
  { id: 26, name: "7-9 år" },
  { id: 162, name: "7-10 år" },
  { id: 163, name: "9-12 år" },
  { id: 27, name: "10-12 år" },
  { id: 164, name: "14-16 år" },
  { id: 31, name: "S (36-38)" },
  { id: 166, name: "S (46-48)" },
  { id: 30, name: "S" },
  { id: 33, name: "M (38-40)" },
  { id: 35, name: "L (42-44)" },
  { id: 36, name: "L (52-54)" },
  { id: 169, name: "XXL (56-58)" },
  { id: 172, name: "37-41" },
  { id: 170, name: "22-28" },
  { id: 999, name: "Universal" },
];

describe("sizeGroups", () => {
  const groups = sizeGroups(TERMS);
  const options = (key: string) => groups.find((g) => g.key === key)?.options.map((o) => [o.label, o.termIds]);

  it("offers children's sizes by age, each size under every age it fits", () => {
    expect(options("boern")).toEqual([
      ["Under 2 år", [28, 29]],
      ["2-4 år", [158, 21, 160]],
      ["5-6 år", [160, 22, 161]],
      ["7-9 år", [161, 26, 162, 163]],
      ["10-12 år", [162, 163, 27]],
      ["13-16 år", [164]],
    ]);
  });

  it("offers adult sizes by letter (women's and men's together), then shoe sizes; unknown sizes are left out", () => {
    expect(options("voksne")).toEqual([
      ["S", [31, 166, 30]],
      ["M", [33]],
      ["L", [35, 36]],
      ["XXL", [169]],
    ]);
    expect(options("sko")).toEqual([
      ["22-28", [170]],
      ["37-41", [172]],
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Børn", "Voksne", "Sko"]);
  });

  it("leaves out groups without sizes", () => {
    expect(sizeGroups([{ id: 1, name: "M (48-50)" }]).map((g) => g.key)).toEqual(["voksne"]);
    expect(sizeGroups([])).toEqual([]);
  });

  it("finds an option by its URL key", () => {
    expect(findSizeOption(groups, "5-6-aar")?.termIds).toEqual([160, 22, 161]);
    expect(findSizeOption(groups, "l")?.label).toBe("L");
    expect(findSizeOption(groups, "sko-37-41")?.termIds).toEqual([172]);
    expect(findSizeOption(groups, "xl")).toBeUndefined();
    expect(findSizeOption(groups, undefined)).toBeUndefined();
  });
});

describe("price bands", () => {
  it("offers the bands a listing's prices reach", () => {
    expect(priceBandsBetween(9, 8769).map((b) => b.key)).toEqual(["under-100", "100-250", "250-500", "over-500"]);
    expect(priceBandsBetween(39, 229).map((b) => b.key)).toEqual(["under-100", "100-250"]);
    expect(priceBandsBetween(259, 259).map((b) => b.key)).toEqual(["250-500"]);
  });
});

describe("filters in the URL", () => {
  it("reads the filters and leaves out unknown values", () => {
    expect(parseFilters({ str: "5-6-aar", pris: "under-100", lager: "ja" })).toEqual({ size: "5-6-aar", price: "under-100", inStock: true });
    expect(parseFilters({ str: ["l", "m"], pris: "billig", lager: "1" })).toEqual({ size: "l" });
    expect(parseFilters({ str: "<script>", side: "2" })).toEqual({});
  });

  it("writes them back, with the sorting, from page 1", () => {
    expect(filterParams({ size: "l", inStock: true })).toEqual({ str: "l", lager: "ja" });
    expect(filteredHref("/kategori/pigekostumer", { sorter: "nyeste" }, { size: "5-6-aar", price: "100-250" })).toBe(
      "/kategori/pigekostumer?sorter=nyeste&str=5-6-aar&pris=100-250",
    );
    expect(filteredHref("/produkter", { side: "3", str: "m" }, {})).toBe("/produkter");
    expect(activeFilterCount({ size: "l", price: "over-500" })).toBe(2);
    expect(activeFilterCount({})).toBe(0);
  });
});
