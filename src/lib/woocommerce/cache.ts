import "server-only";
import { cacheLife } from "next/cache";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { describeError } from "@/lib/log";

/**
 * How catalogue reads keep the last good data when WooCommerce fails.
 *
 * A cached ("use cache: remote") read goes through `fetched`, which throws when WooCommerce
 * can't be read. Next.js then saves nothing: a stale entry keeps being served while its
 * refresh failed, and a page regenerated in the background keeps its last good version
 * (Next.js discards a page render in which a cache threw). The exported, uncached function
 * turns the error into its fallback (e.g. "Vi kan ikke hente produkterne lige nu") with
 * `orFailure`; that is only shown when nothing is cached, and the page then retries by itself
 * (components/ui/catalog-retry.tsx).
 *
 * Returning the fallback from the cached read instead would replace good data with it.
 */

export type CacheLife = { stale: number; revalidate: number; expire: number };

/**
 * How long an entry is kept without a refresh: 30 days. Until then a page view is served the
 * entry at once (stale-while-revalidate) and refreshes it in the background once it is older
 * than `revalidate`; a failed refresh keeps it (see `fetched`). So a product read once is
 * never cold again in that deployment (a deploy starts a new cache), and WooCommerce is asked
 * at most once per `revalidate` for it, only while it is viewed. Product webhooks (see
 * /api/revalidate) refresh a changed product at once.
 */
const KEEP = 30 * 86_400;

/** A product page's product: refreshed 5 minutes after it was read, when it is viewed. */
export const CATALOG: CacheLife = { stale: 300, revalidate: 300, expire: KEEP };

/**
 * Product lists (category pages, theme pages, front page rows, search) and the menu's
 * categories: refreshed after 15 minutes. Prices and stock on cards are informational (the
 * cart and the checkout ask WooCommerce), and the front page and theme pages are rebuilt
 * from these, so a shorter time would only ask WooCommerce more often.
 */
export const CATALOG_LISTS: CacheLife = { stale: 300, revalidate: 900, expire: KEEP };

/**
 * What rarely changes, or a page can do without for a while: related products, photos for the
 * front page, filter choices, shipping amounts, the sitemap, the plugin's version. Refreshed
 * after an hour.
 */
export const CATALOG_SLOW: CacheLife = { stale: 300, revalidate: 3600, expire: KEEP };

/**
 * Lifetime for a read that failed while building: retried after 30 s. (Kept at the 5-minute
 * "expire" minimum so Next.js can still prerender the friendly error state.)
 */
export const FAILURE_LIFE: CacheLife = { stale: 30, revalidate: 30, expire: 300 };

export type Read<T> = { ok: true; data: T } | { ok: false };

/**
 * Runs a WooCommerce read for the cached function it is called from and sets that function's
 * lifetime. A failure is logged and thrown on. Not while building, though: there is no good
 * entry to keep then, and Next.js fails the build on any error thrown in a cache, even a
 * caught one. The failure is cached for 30 s instead, as the build's pages are.
 */
export async function fetched<T>(operation: string, life: CacheLife, read: () => Promise<T>): Promise<Read<T>> {
  let data: T;
  try {
    data = await read();
  } catch (error) {
    // Messages from our client never contain credentials or customer data.
    console.error(`[catalog] ${operation} failed:`, describeError(error));
    if (!isBuilding()) throw error;
    cacheLife(FAILURE_LIFE);
    return { ok: false };
  }
  cacheLife(life);
  return { ok: true, data };
}

/** For `.catch()` on a cached read: its error (already logged by `fetched`) as a failure. */
export function orFailure(): { ok: false } {
  return { ok: false };
}

/** Whether `next build` is running (a failed read does not throw then, see `fetched`). */
export function isBuilding(): boolean {
  return process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD;
}
