"use client";

import { cartReducer, deserializeCart, serializeCart, type CartAction, type CartLine } from "./cart";

/**
 * External cart store backed by localStorage, consumed with useSyncExternalStore.
 * Falls back to memory when storage is unavailable (private mode, quota).
 */

const EMPTY: CartLine[] = [];
const listeners = new Set<() => void>();
let cache: { key: string; raw: string | null; lines: CartLine[] } | null = null;
let memoryOnly = false;
const memory = new Map<string, string>();

function getRaw(key: string): string | null {
  if (memoryOnly) return memory.get(key) ?? null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    memoryOnly = true;
    return memory.get(key) ?? null;
  }
}

function setRaw(key: string, raw: string) {
  memory.set(key, raw);
  if (memoryOnly) return;
  try {
    window.localStorage.setItem(key, raw);
  } catch {
    memoryOnly = true;
  }
}

export function readCart(key: string): CartLine[] {
  const raw = getRaw(key);
  if (cache && cache.key === key && cache.raw === raw) return cache.lines;
  cache = { key, raw, lines: deserializeCart(raw) };
  return cache.lines;
}

export function serverCartSnapshot(): CartLine[] {
  return EMPTY;
}

export function subscribeCart(listener: () => void): () => void {
  listeners.add(listener);
  // Other tabs.
  const onStorage = () => listener();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function dispatchCart(key: string, action: CartAction) {
  const next = cartReducer(readCart(key), action);
  const raw = serializeCart(next);
  setRaw(key, raw);
  cache = { key, raw, lines: next };
  for (const listener of listeners) listener();
}
