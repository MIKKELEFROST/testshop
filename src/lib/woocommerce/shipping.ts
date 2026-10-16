import "server-only";
import { cacheTag } from "next/cache";
import { z } from "zod";
import { storeConfig } from "@/config/store";
import { HOURS, fetched, orFailure, type Read } from "./cache";
import { wooRequest } from "./client";
import { CATALOG_TAG } from "./products";
import { wcShippingLocationSchema, wcShippingMethodSchema, wcShippingZoneSchema } from "./schemas";

/** Setting the Headless Checkout Bridge plugin (1.3+) adds to flat rates: free from this amount. */
const FREE_FROM = "wchc_free_from";

/**
 * The lowest "Fri fragt fra" amount (decimal string, e.g. "599.00") of the enabled flat rates
 * that deliver to the shop's country, or null when no method is free from an amount. The
 * selling points ("Fri fragt v/ 599 kr.") and the cart use it, so they always match WooCommerce.
 * A failed refresh keeps the last amount (see ./cache.ts).
 */
export async function getFreeShippingFrom(): Promise<string | null> {
  const result = await readFreeShippingFrom().catch(orFailure);
  return result.ok ? result.data : null;
}

async function readFreeShippingFrom(): Promise<Read<string | null>> {
  "use cache: remote";
  cacheTag(CATALOG_TAG);
  return fetched("getFreeShippingFrom", HOURS, async () => {
    const { data: zones } = await wooRequest("wc/v3/shipping/zones", { schema: z.array(wcShippingZoneSchema) });
    const amounts: number[] = [];
    for (const zone of zones) {
      // Zone 0 ("Locations not covered by your other zones") has no locations of its own.
      if (zone.id !== 0) {
        const { data: locations } = await wooRequest(`wc/v3/shipping/zones/${zone.id}/locations`, {
          schema: z.array(wcShippingLocationSchema),
        });
        if (!locations.some((l) => l.type === "country" && l.code === storeConfig.defaultCountry)) continue;
      }
      const { data: methods } = await wooRequest(`wc/v3/shipping/zones/${zone.id}/methods`, {
        schema: z.array(wcShippingMethodSchema),
      });
      amounts.push(...freeFromAmounts(methods));
    }
    return amounts.length > 0 ? Math.min(...amounts).toFixed(2) : null;
  });
}

/** "Fri fragt fra" amounts of the enabled flat rates (empty or invalid values are ignored). */
export function freeFromAmounts(methods: z.infer<typeof wcShippingMethodSchema>[]): number[] {
  return methods
    .filter((m) => m.enabled && m.method_id === "flat_rate")
    .map((m) => String(m.settings[FREE_FROM]?.value ?? "").trim().replace(",", "."))
    .filter((value) => /^\d+(\.\d+)?$/.test(value))
    .map(Number);
}
