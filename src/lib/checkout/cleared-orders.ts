import { storeConfig } from "@/config/store";

/**
 * The newest order whose confirmation emptied the cart in this browser, per shop (localStorage).
 * The confirmation page empties the cart, the saved checkout form and the checkout session once
 * per order: a second order in the same tab is handled too, and an old confirmation opened again
 * (from the history, a bookmark or the e-mail) never empties a cart built since. Order numbers
 * only grow, so "older than the last one handled" is enough to know.
 */
export function clearedOrderStorageKey(storeId: string) {
  return `cart-cleared:${storeId}`;
}

type Store = Pick<Storage, "getItem" | "setItem">;

/** localStorage, or null on the server and where storage is blocked (it can throw just by being read). */
function local(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Whether the confirmation of `orderId` should empty the cart now; records it when it should.
 * Without storage it always should (as before: the cart is emptied after every order).
 */
export function claimCartClearing(orderId: number, storage: Store | null = local(), storeId: string = storeConfig.id): boolean {
  if (!storage) return true;
  try {
    const key = clearedOrderStorageKey(storeId);
    const last = Number(storage.getItem(key));
    if (Number.isSafeInteger(last) && last >= orderId) return false;
    storage.setItem(key, String(orderId));
  } catch {
    // Full or blocked storage: empty the cart anyway.
  }
  return true;
}
