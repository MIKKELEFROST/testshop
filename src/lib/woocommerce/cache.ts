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
 * `orFailure`; that is only shown when nothing is cached.
 *
 * Returning the fallback from the cached read instead would replace good data with it.
 */

export type CacheLife = { stale: number; revalidate: number; expire: number };

/** Next.js's "minutes" profile: refreshed after a minute. */
export const MINUTES: CacheLife = { stale: 300, revalidate: 60, expire: 3600 };

/** Next.js's "hours" profile: refreshed after an hour. */
export const HOURS: CacheLife = { stale: 300, revalidate: 3600, expire: 86400 };

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
