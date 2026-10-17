import { describe, expect, it } from "vitest";
import { CATALOG_RETRY_SECONDS, catalogRetryDelay } from "./catalog-retry";

describe("catalogRetryDelay", () => {
  it("asks again after 3, 6, 12, 24, 48 and 96 s, then stops", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(catalogRetryDelay)).toEqual([3000, 6000, 12000, 24000, 48000, 96000, null]);
  });

  it("keeps trying for longer than the read breaker can stay open (1 minute) plus a page's waits", () => {
    const total = CATALOG_RETRY_SECONDS.reduce((sum, s) => sum + s, 0);
    expect(total).toBeGreaterThan(120);
    expect(total).toBeLessThanOrEqual(240);
  });
});
