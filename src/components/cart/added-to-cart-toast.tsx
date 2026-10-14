"use client";

import { useEffect } from "react";
import { ButtonLink } from "@/components/ui/button";
import { useCart } from "./cart-provider";

/** Lightweight confirmation after "Læg i kurv", with a direct path to checkout. */
export function AddedToCartToast() {
  const { lastAdded, dismissLastAdded, count } = useCart();

  useEffect(() => {
    if (!lastAdded) return;
    const timer = window.setTimeout(dismissLastAdded, 6000);
    return () => window.clearTimeout(timer);
  }, [lastAdded, dismissLastAdded]);

  if (!lastAdded) return null;

  return (
    <div
      role="status"
      className="animate-fade-in fixed inset-x-3 bottom-3 z-50 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-xl sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-96"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-success text-white">
          <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden="true">
            <path d="M8.1 13.4 4.7 10l-1.2 1.2 4.6 4.6 9-9-1.2-1.2z" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Lagt i kurven</p>
          <p className="truncate text-sm text-muted">
            {lastAdded.name}
            {lastAdded.variantLabel ? ` · ${lastAdded.variantLabel}` : ""}
          </p>
        </div>
        <button onClick={dismissLastAdded} className="-m-1 rounded p-1 text-muted hover:text-ink" aria-label="Luk">
          <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden="true">
            <path d="m5.3 4.2 4.7 4.7 4.7-4.7 1.1 1.1-4.7 4.7 4.7 4.7-1.1 1.1-4.7-4.7-4.7 4.7-1.1-1.1 4.7-4.7-4.7-4.7z" />
          </svg>
        </button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <ButtonLink href="/kurv" variant="secondary" size="sm" onClick={dismissLastAdded}>
          Se kurv ({count})
        </ButtonLink>
        <ButtonLink href="/checkout" size="sm" onClick={dismissLastAdded}>
          Til kassen
        </ButtonLink>
      </div>
    </div>
  );
}
