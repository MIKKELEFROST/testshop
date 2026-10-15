"use client";

import { Heart } from "lucide-react";
import { useFavorites } from "@/lib/favorites/use-favorites";

/** The heart on a product card or product page: saves the product to the favourites. */
export function FavoriteButton({ productId, name, variant = "card" }: { productId: number; name: string; variant?: "card" | "page" }) {
  const { has, toggle } = useFavorites();
  const saved = has(productId);

  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        toggle(productId);
      }}
      aria-pressed={saved}
      aria-label={saved ? `Fjern ${name} fra favoritter` : `Gem ${name} som favorit`}
      title={saved ? "Fjern fra favoritter" : "Gem som favorit"}
      className={
        variant === "card"
          ? "flex size-10 items-center justify-center rounded-full bg-white/90 text-ink-soft shadow-sm ring-1 ring-black/5 transition hover:scale-105 hover:text-sale"
          : "flex size-12 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-line-strong bg-surface text-ink-soft transition-colors hover:border-ink hover:text-sale"
      }
    >
      <Heart className={`${variant === "card" ? "size-5" : "size-6"} ${saved ? "fill-sale text-sale" : ""}`} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}
