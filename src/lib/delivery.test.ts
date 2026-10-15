import { describe, expect, it } from "vitest";
import { formatDuration, minutesToCutoff } from "./delivery";

describe("same-day dispatch countdown", () => {
  it("counts down to 19:00 Danish time on working days", () => {
    expect(minutesToCutoff(new Date("2026-10-15T16:00:00Z"))).toBe(60); // Thursday 18:00 (summer time)
    expect(minutesToCutoff(new Date("2026-12-01T08:00:00Z"))).toBe(600); // Tuesday 09:00 (winter time)
    expect(minutesToCutoff(new Date("2026-10-16T16:59:00Z"))).toBe(1); // Friday 18:59
  });

  it("promises nothing after 19:00, at weekends and on closed days", () => {
    expect(minutesToCutoff(new Date("2026-10-15T17:00:00Z"))).toBeNull(); // 19:00
    expect(minutesToCutoff(new Date("2026-10-17T09:00:00Z"))).toBeNull(); // Saturday
    expect(minutesToCutoff(new Date("2026-10-18T09:00:00Z"))).toBeNull(); // Sunday
    expect(minutesToCutoff(new Date("2026-12-24T09:00:00Z"))).toBeNull(); // Juleaften
    expect(minutesToCutoff(new Date("2027-03-25T09:00:00Z"))).toBeNull(); // Skærtorsdag 2027
  });

  it("formats the time left", () => {
    expect(formatDuration(192)).toBe("3 t 12 min");
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(120)).toBe("2 t");
  });
});
