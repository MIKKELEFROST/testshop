import { describe, expect, it } from "vitest";
import { claimCartClearing, clearedOrderStorageKey } from "./cleared-orders";

function memory(): Pick<Storage, "getItem" | "setItem"> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
}

describe("claimCartClearing", () => {
  it("empties the cart once per order, also for a second order in the same tab", () => {
    const storage = memory();
    expect(claimCartClearing(101, storage, "piece-dk")).toBe(true);
    expect(claimCartClearing(101, storage, "piece-dk")).toBe(false);
    expect(claimCartClearing(105, storage, "piece-dk")).toBe(true);
    expect(storage.data.get(clearedOrderStorageKey("piece-dk"))).toBe("105");
  });

  it("never lets an old confirmation link empty a cart built since", () => {
    const storage = memory();
    claimCartClearing(105, storage, "piece-dk");
    expect(claimCartClearing(101, storage, "piece-dk")).toBe(false);
    expect(storage.data.get(clearedOrderStorageKey("piece-dk"))).toBe("105");
  });

  it("keeps each shop apart, and empties the cart when storage is missing or broken", () => {
    const storage = memory();
    claimCartClearing(105, storage, "piece-dk");
    expect(claimCartClearing(101, storage, "halloween-kostumer-dk")).toBe(true);
    expect(claimCartClearing(101, null)).toBe(true);
    const broken = { getItem: () => "x", setItem: () => { throw new Error("QuotaExceededError"); } };
    expect(claimCartClearing(101, broken, "piece-dk")).toBe(true);
  });
});
