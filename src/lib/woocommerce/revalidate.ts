import "server-only";
import { revalidateTag } from "next/cache";
import { CATALOG_TAG, productTag } from "./products";

/**
 * Marking cached catalogue data stale, after a product webhook (/api/revalidate) or an order
 * that changed stock (/api/stripe/webhook). Stale-while-revalidate (`max`): the next view gets
 * the old copy at once while the new one is read. Except for a product that was deleted or is
 * no longer published: its own entries expire at once (`{ expire: 0 }`), so the next view,
 * maybe weeks later, reads it again and gets a 404 instead of the old product with its buy
 * button. Only that product's entries are read again, so it costs the host one read.
 *
 * A product's own entries (its page, related rows, photo) at once. The whole catalogue (every
 * list, the menu's counts, the sitemap) at most once per CATALOG_INTERVAL_MS per server
 * instance: an import, a stock update of thousands of products or a busy sales day would
 * otherwise have every list read again from the WordPress host after each change. Lists refresh
 * by themselves every 15 minutes (./cache.ts).
 */

const CATALOG_INTERVAL_MS = 5 * 60_000;
let lastCatalog = -Infinity;

/** `gone`: the product was deleted or is no longer published. */
export function revalidateProduct(id: number, gone = false) {
  revalidateTag(productTag(id), gone ? { expire: 0 } : "max");
}

/** Marks the whole catalogue stale unless that was done less than 5 minutes ago; whether it did. */
export function revalidateCatalog(): boolean {
  const now = Date.now();
  if (now - lastCatalog < CATALOG_INTERVAL_MS) return false;
  lastCatalog = now;
  revalidateTag(CATALOG_TAG, "max");
  return true;
}
