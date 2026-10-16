import { describe, expect, it } from "vitest";
import { ESTIMATE_ADDRESS } from "@/lib/checkout/quote";
import { cityForPostcode, filledTown, townForPostcode } from "./postcodes";

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

describe("postcode → town after the checkout form is restored", () => {
  // Reloaded, or back from a cancelled MobilePay payment: the draft had 8000 with the town filled in.
  const restored = { country: "DK", postcode: "8000", city: "Aarhus C" };

  it("still follows a postcode change when the restored town is the postcode's own", () => {
    const filled = filledTown(restored);
    expect(filled).toBe("Aarhus C");
    expect(cityForPostcode({ ...restored, postcode: "5000", filled })).toEqual({ city: "Odense C", filled: "Odense C" });
  });

  it("keeps a town the customer typed, and other countries", () => {
    const typed = { ...restored, city: "Århus" };
    expect(filledTown(typed)).toBeNull();
    expect(cityForPostcode({ ...typed, postcode: "5000", filled: filledTown(typed) }).city).toBe("Århus");
    expect(filledTown({ ...restored, country: "SE" })).toBeNull();
    expect(filledTown({ ...restored, city: "" })).toBeNull();
    expect(filledTown(null)).toBeNull();
  });
});
