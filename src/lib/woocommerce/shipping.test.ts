import { describe, expect, it } from "vitest";
import { freeFromAmounts } from "./shipping";
import { wcShippingMethodSchema } from "./schemas";

const method = (overrides: Record<string, unknown>) =>
  wcShippingMethodSchema.parse({ instance_id: 1, method_id: "flat_rate", enabled: true, settings: {}, ...overrides });

describe("freeFromAmounts", () => {
  it("reads the enabled flat rates' free shipping amounts, also with a decimal comma", () => {
    const methods = [
      method({ settings: { wchc_free_from: { value: "599" } } }),
      method({ settings: { wchc_free_from: { value: "499,00" } } }),
      method({ enabled: false, settings: { wchc_free_from: { value: "99" } } }),
      method({ method_id: "free_shipping", settings: { min_amount: { value: "50" } } }),
      method({ settings: { wchc_free_from: { value: "" } } }),
      method({ settings: { wchc_free_from: { value: null } } }),
      method({ settings: { cost: { value: "31.20" } } }),
    ];
    expect(freeFromAmounts(methods)).toEqual([599, 499]);
  });
});
