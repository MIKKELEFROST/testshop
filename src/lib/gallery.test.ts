import { describe, expect, it } from "vitest";
import { slideAt, stepSlide } from "./gallery";

describe("gallery strip", () => {
  it("shows the nearest slide while swiping", () => {
    expect(slideAt(0, 390, 4)).toBe(0);
    expect(slideAt(194, 390, 4)).toBe(0);
    expect(slideAt(196, 390, 4)).toBe(1);
    expect(slideAt(780, 390, 4)).toBe(2);
    expect(slideAt(779.5, 390, 4)).toBe(2);
  });

  it("stays on the first and last slide when the strip bounces past an end", () => {
    expect(slideAt(-40, 390, 4)).toBe(0);
    expect(slideAt(1300, 390, 4)).toBe(3);
  });

  it("reads 0 from a strip that is not laid out or has no slides", () => {
    expect(slideAt(200, 0, 4)).toBe(0);
    expect(slideAt(200, 390, 0)).toBe(0);
  });

  it("steps forwards and back, going round at the ends", () => {
    expect(stepSlide(0, 1, 4)).toBe(1);
    expect(stepSlide(3, 1, 4)).toBe(0);
    expect(stepSlide(0, -1, 4)).toBe(3);
    expect(stepSlide(2, -1, 4)).toBe(1);
    expect(stepSlide(0, 1, 1)).toBe(0);
    expect(stepSlide(0, 1, 0)).toBe(0);
  });
});
