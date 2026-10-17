"use client";

import { useCallback, useSyncExternalStore } from "react";
import { storeConfig } from "@/config/store";
import { parseFavorites, toggleFavorite } from "./favorites";

/**
 * Favourites in localStorage (per shop), shared by every heart on the page and other tabs.
 * Nothing is sent to the server until the favourites page asks for the products.
 */

const KEY = `favorites:${storeConfig.id}`;
const EMPTY: number[] = [];
const listeners = new Set<() => void>();
let cache: { raw: string | null; ids: number[] } | null = null;

function read(): number[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    // Storage unavailable (private mode): favourites live in memory for this page only.
    raw = cache?.raw ?? null;
  }
  if (cache && cache.raw === raw) return cache.ids;
  cache = { raw, ids: parseFavorites(raw) };
  return cache.ids;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function write(ids: number[]) {
  const raw = JSON.stringify(ids);
  try {
    window.localStorage.setItem(KEY, raw);
  } catch {
    // Kept in memory only.
  }
  cache = { raw, ids };
  for (const listener of listeners) listener();
}

export function useFavorites() {
  const ids = useSyncExternalStore(subscribe, read, () => EMPTY);
  const toggle = useCallback((id: number) => write(toggleFavorite(read(), id)), []);
  const has = useCallback((id: number) => ids.includes(id), [ids]);
  return { ids, has, toggle };
}
