import { describe, expect, it } from "vitest";
import { closedDays, danishTime, daysBetween, easterSunday, fastelavn, formatDanishDate, halloween, nextOccurrence } from "./seasons";

describe("seasons", () => {
  it("finds Easter and fastelavn (seven weeks before)", () => {
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");
    expect(easterSunday(2028)).toBe("2028-04-16");
    expect(fastelavn(2026)).toBe("2026-02-15");
    expect(fastelavn(2027)).toBe("2027-02-07");
    expect(halloween(2026)).toBe("2026-10-31");
  });

  it("counts down to the next holiday, the day itself included", () => {
    expect(nextOccurrence("halloween", "2026-10-15")).toBe("2026-10-31");
    expect(nextOccurrence("halloween", "2026-10-31")).toBe("2026-10-31");
    expect(nextOccurrence("halloween", "2026-11-01")).toBe("2027-10-31");
    expect(nextOccurrence("fastelavn", "2026-10-15")).toBe("2027-02-07");
    expect(nextOccurrence("fastelavn", "2026-02-15")).toBe("2026-02-15");
    expect(daysBetween("2026-10-15", "2026-10-31")).toBe(16);
    expect(daysBetween("2026-10-15", "2027-02-07")).toBe(115);
  });

  it("knows the days nothing is sent", () => {
    const days = closedDays(2026);
    for (const day of ["2026-01-01", "2026-04-02", "2026-04-03", "2026-04-05", "2026-04-06", "2026-05-14", "2026-05-24", "2026-05-25", "2026-06-05", "2026-12-24", "2026-12-25", "2026-12-26", "2026-12-31"]) {
      expect(days.has(day), day).toBe(true);
    }
    expect(days.has("2026-10-15")).toBe(false);
  });

  it("reads the time in Denmark, summer and winter time", () => {
    expect(danishTime(new Date("2026-10-15T17:30:00Z"))).toEqual({ date: "2026-10-15", weekday: 4, minutes: 19 * 60 + 30 });
    expect(danishTime(new Date("2026-12-01T08:00:00Z"))).toEqual({ date: "2026-12-01", weekday: 2, minutes: 9 * 60 });
    expect(danishTime(new Date("2026-10-31T23:30:00Z")).date).toBe("2026-11-01");
  });

  it("writes dates in Danish", () => {
    expect(formatDanishDate("2027-02-07")).toBe("søndag 7. februar");
    expect(formatDanishDate("2026-10-31", { weekday: false, year: true })).toBe("31. oktober 2026");
  });
});
