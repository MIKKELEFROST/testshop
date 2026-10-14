"use client";

import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { storeConfig } from "@/config/store";
import { cartStorageKey, lineKey, type CartLine } from "@/lib/cart/cart";
import { dispatchCart, readCart, serverCartSnapshot, subscribeCart } from "@/lib/cart/cart-store";

/**
 * Browser cart. Persisted in localStorage (per store) and synced across tabs.
 *
 * The cart only remembers WHAT the customer wants and the price they last saw. Prices,
 * stock, tax and shipping are always recalculated by WooCommerce on the server.
 */

type CartContextValue = {
  lines: CartLine[];
  /** False during server rendering and hydration, when the stored cart is not known yet. */
  hydrated: boolean;
  count: number;
  add: (line: Omit<CartLine, "key">) => void;
  setQuantity: (key: string, quantity: number) => void;
  remove: (key: string) => void;
  clear: () => void;
  lastAdded: CartLine | null;
  dismissLastAdded: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

const noopSubscribe = () => () => {};

export function CartProvider({ children }: { children: ReactNode }) {
  const storageKey = cartStorageKey(storeConfig.id);
  const lines = useSyncExternalStore(subscribeCart, () => readCart(storageKey), serverCartSnapshot);
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [lastAdded, setLastAdded] = useState<CartLine | null>(null);

  const add = useCallback(
    (line: Omit<CartLine, "key">) => {
      dispatchCart(storageKey, { type: "add", line });
      setLastAdded({ ...line, key: lineKey(line.productId, line.variationId) });
    },
    [storageKey],
  );
  const setQuantity = useCallback(
    (key: string, quantity: number) => dispatchCart(storageKey, { type: "setQuantity", key, quantity }),
    [storageKey],
  );
  const remove = useCallback((key: string) => dispatchCart(storageKey, { type: "remove", key }), [storageKey]);
  const clear = useCallback(() => dispatchCart(storageKey, { type: "replace", lines: [] }), [storageKey]);
  const dismissLastAdded = useCallback(() => setLastAdded(null), []);

  const value = useMemo(
    () => ({
      lines,
      hydrated,
      count: lines.reduce((sum, line) => sum + line.quantity, 0),
      add,
      setQuantity,
      remove,
      clear,
      lastAdded,
      dismissLastAdded,
    }),
    [lines, hydrated, add, setQuantity, remove, clear, lastAdded, dismissLastAdded],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const value = useContext(CartContext);
  if (!value) throw new Error("useCart must be used inside <CartProvider>");
  return value;
}
