"use client";

import { Heart } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ProductGrid, ProductGridSkeleton } from "@/components/products/product-card";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { favoritesRequest } from "@/lib/favorites/favorites";
import { useFavorites } from "@/lib/favorites/use-favorites";
import type { ProductSummary } from "@/types/commerce";

/** The saved products, fetched fresh (current prices and stock); removed products drop out. */
const noopSubscribe = () => () => {};

type Fetched = { key: string; ids: ReadonlySet<number>; products: ProductSummary[] | null; error: boolean };

export function FavoritesView() {
  const { ids } = useFavorites();
  // The server can't know the favourites: show the placeholder until the browser has read them.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [state, setState] = useState<Fetched>({ key: "", ids: new Set(), products: null, error: false });
  // A removed favourite just drops out of the grid (no reload, no skeleton).
  const key = favoritesRequest(ids, state.ids, state.key);

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const asked = new Set(key.split(",").map(Number));
    fetch(`/api/products?ids=${key}`, { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ products: ProductSummary[] }>) : Promise.reject(new Error(String(r.status)))))
      .then((data) => setState({ key, ids: asked, products: data.products, error: false }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ key, ids: new Set(), products: null, error: Boolean(error) });
      });
    return () => controller.abort();
  }, [key]);

  if (!hydrated) return <div className="mt-8"><ProductGridSkeleton count={5} /></div>;
  if (ids.length === 0) {
    return (
      <div className="mt-10 rounded-2xl bg-surface p-8 text-center ring-1 ring-black/5 sm:p-12">
        <Heart className="mx-auto size-10 text-sale" aria-hidden="true" />
        <p className="mt-4 text-lg font-bold">Du har ingen favoritter endnu</p>
        <p className="mt-1 text-muted">Tryk på hjertet ved et produkt for at gemme det her.</p>
        <ButtonLink href="/produkter" className="mt-6">
          Se alle produkter
        </ButtonLink>
      </div>
    );
  }
  // Products whose IDs are still being looked up (the list may have changed since).
  const current = state.key === key ? state : null;
  if (current?.error) return <div className="mt-8"><Alert tone="warning">Vi kan ikke hente dine favoritter lige nu. Prøv igen om lidt.</Alert></div>;
  if (!current?.products) return <div className="mt-8"><ProductGridSkeleton count={Math.min(ids.length, 10)} /></div>;

  const byId = new Map(current.products.map((p) => [p.id, p]));
  const products = ids.map((id) => byId.get(id)).filter((p): p is ProductSummary => p !== undefined);
  return (
    <div className="mt-8">
      <p className="mb-4 text-sm font-semibold text-ink-soft">{products.length === 1 ? "1 favorit" : `${products.length} favoritter`}</p>
      <ProductGrid products={products} />
    </div>
  );
}
