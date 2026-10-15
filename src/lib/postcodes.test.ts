import { describe, expect, it } from "vitest";
import { ESTIMATE_ADDRESS } from "@/lib/checkout/quote";
import { cityForPostcode, townForPostcode } from "./postcodes";

describe("postcode → town", () => {
  it("knows the towns of Danish postcodes", () => {
    expect(townForPostcode("8000")).toBe("Aarhus C");
    expect(townForPostcode("2100")).toBe("København Ø");
    expect(townForPostcode("1050")).toBe("København K");
    expect(townForPostcode("3700")).toBe("Rønne");
    expect(townForPostcode("9990")).toBe("Skagen");
    expect(townForPostcode("0000")).toBeNull();
    expect(townForPostcode(ESTIMATE_ADDRESS.postcode)).toBe(ESTIMATE_ADDRESS.city);
  });

  it("fills in an empty town, and follows a postcode change while the town is still the filled-in one", () => {
    const first = cityForPostcode({ country: "DK", postcode: "8000", city: "", filled: null });
    expect(first).toEqual({ city: "Aarhus C", filled: "Aarhus C" });
    expect(cityForPostcode({ country: "DK", postcode: "2100", city: first.city, filled: first.filled })).toEqual({ city: "København Ø", filled: "København Ø" });
  });

  it("keeps a town the customer typed, an incomplete postcode and other countries", () => {
    expect(cityForPostcode({ country: "DK", postcode: "8000", city: "Århus", filled: null })).toEqual({ city: "Århus", filled: null });
    expect(cityForPostcode({ country: "DK", postcode: "80", city: "", filled: null })).toEqual({ city: "", filled: null });
    expect(cityForPostcode({ country: "DK", postcode: "0000", city: "", filled: null })).toEqual({ city: "", filled: null });
    expect(cityForPostcode({ country: "SE", postcode: "8000", city: "", filled: null })).toEqual({ city: "", filled: null });
  });
});
