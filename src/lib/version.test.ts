import { describe, expect, it } from "vitest";
import { versionAtLeast } from "./version";

describe("versionAtLeast", () => {
  it("compares versions part by part", () => {
    expect(versionAtLeast("1.4.0", "1.4.0")).toBe(true);
    expect(versionAtLeast("1.10.0", "1.4.0")).toBe(true);
    expect(versionAtLeast("1.3.1", "1.4.0")).toBe(false);
    expect(versionAtLeast("2", "1.4.0")).toBe(true);
    expect(versionAtLeast("1.4", "1.4.0")).toBe(true);
  });
});
