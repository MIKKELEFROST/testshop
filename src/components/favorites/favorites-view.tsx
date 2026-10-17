"use client";

import { Heart } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ProductGrid, ProductGridSkeleton } from "@/components/products/product-card";
import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { catalogRetryDelay } from "@/lib/catalog-retry";
import { favoritesRequest } from "@/lib/favorites/favorites";
import { useFavorites } from "@/lib/favorites/use-favorites";
import type { ProductSummary } from "@/types/commerce";

/** The saved products, fetched fresh (current prices and stock); removed products drop out. */
const noopSubscribe = () => () => {};

/** `attempt`: which try for this request the answer is (see the retries below). */
type Fetched = { key: string; attempt: number; ids: ReadonlySet<number>; products: ProductSummary[] | null; error: boolean };

export function FavoritesView() {
  const { ids } = useFavorites();
  // The server can't know the favourites: show the placeholder until the browser has read them.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [state, setState] = useState<Fetched>({ key: "", attempt: 0, ids: new Set(), products: null, error: false });
  // A failed request is asked for again (a failure keeps the same request, so only a new attempt
  // fetches anew): by itself after a pause, like the catalogue pages (CatalogRetry), and with
  // "Prøv igen" once those are used up.
  const [attempt, setAttempt] = useState(0);
  // A removed favourite just drops out of the grid (no reload, no skeleton).
  const key = favoritesRequest(ids, state.ids, state.key);

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const asked = new Set(key.split(",").map(Number));
    fetch(`/api/products?ids=${key}`, { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ products: ProductSummary[] }>) : Promise.reject(new Error(String(r.status)))))
      .then((data) => setState({ key, attempt, ids: asked, products: data.products, error: false }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ key, attempt, ids: new Set(), products: null, error: Boolean(error) });
      });
    return () => controller.abort();
  }, [key, attempt]);

  // Products whose IDs are still being looked up (the list may have changed since).
  const current = state.key === key && state.attempt === attempt ? state : null;
  const retryDelay = current?.error ? catalogRetryDelay(attempt) : null;
  useEffect(() => {
    if (retryDelay === null) return;
    // As in CatalogRetry: a due retry waits until the browser is online and the tab visible.
    let due = false;
    const fire = () => {
      if (!due || !navigator.onLine || document.visibilityState === "hidden") return;
      due = false;
      setAttempt((n) => n + 1);
    };
    const timer = setTimeout(() => {
      due = true;
      fire();
    }, retryDelay);
    window.addEventListener("online", fire);
    document.addEventListener("visibilitychange", fire);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", fire);
      document.removeEventListener("visibilitychange", fire);
    };
  }, [retryDelay]);

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
  if (current?.error && retryDelay !== null) {
    return (
      <div role="status" className="mt-8 flex items-start gap-3 rounded-[var(--radius-control)] border border-line bg-surface px-4 py-3 text-sm text-ink">
        <Spinner className="mt-0.5 size-4 shrink-0 text-muted" />
        <div>
          <p className="font-medium">Henter dine favoritter…</p>
          <p className="mt-0.5 text-muted">Det tager lidt længere end normalt. Siden prøver igen af sig selv.</p>
        </div>
      </div>
    );
  }
  if (current?.error) {
    return (
      <div className="mt-8">
        <Alert tone="warning">
          <p>Vi kan ikke hente dine favoritter lige nu.</p>
          <Button className="mt-3" size="sm" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
            Prøv igen
          </Button>
        </Alert>
      </div>
    );
  }
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
