import { describe, expect, it } from "vitest";
import { formatPrice, fromMinorUnits, multiplyAmount, sameAmount, stripeCurrencyExponent, toMinorUnits } from "./money";

describe("money", () => {
  it("converts decimal strings to minor units without float errors", () => {
    expect(toMinorUnits("547.00", 2)).toBe(54700);
    expect(toMinorUnits("0.1", 2)).toBe(10);
    expect(toMinorUnits("19.99", 2)).toBe(1999);
    expect(toMinorUnits("1005.10", 2)).toBe(100510);
    expect(toMinorUnits("8.075", 2)).toBe(808); // half-up on extra precision
    expect(toMinorUnits("100", 0)).toBe(100);
    expect(toMinorUnits("1.234", 3)).toBe(1234);
  });

  it("rejects malformed amounts", () => {
    expect(() => toMinorUnits("1,00", 2)).toThrow();
    expect(() => toMinorUnits("abc", 2)).toThrow();
    expect(() => toMinorUnits("", 2)).toThrow();
    expect(() => toMinorUnits("1e5", 2)).toThrow();
  });

  it("converts back to decimal strings", () => {
    expect(fromMinorUnits(54700, 2)).toBe("547.00");
    expect(fromMinorUnits(5, 2)).toBe("0.05");
    expect(fromMinorUnits(-1250, 2)).toBe("-12.50");
    expect(fromMinorUnits(100, 0)).toBe("100");
  });

  it("knows Stripe's currency exponents", () => {
    expect(stripeCurrencyExponent("DKK")).toBe(2);
    expect(stripeCurrencyExponent("eur")).toBe(2);
    expect(stripeCurrencyExponent("JPY")).toBe(0);
    expect(stripeCurrencyExponent("KWD")).toBe(3);
  });

  it("compares and multiplies amounts exactly", () => {
    expect(sameAmount("547", "547.00")).toBe(true);
    expect(sameAmount("547.01", "547.00")).toBe(false);
    expect(multiplyAmount("0.10", 3)).toBe("0.30");
    expect(multiplyAmount("249.00", 2)).toBe("498.00");
  });

  it("formats Danish prices", () => {
    expect(formatPrice("249.00").replace(/\s/g, " ")).toBe("249,00 kr.");
    expect(formatPrice("1249.5").replace(/\s/g, " ")).toBe("1.249,50 kr.");
    expect(formatPrice(null)).toBe("");
  });
});
