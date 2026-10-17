"use client";

import { Heart } from "lucide-react";
import Link from "next/link";
import { useFavorites } from "@/lib/favorites/use-favorites";

/** Header heart: the favourites page, with the number saved. */
export function FavoritesLink() {
  const { ids } = useFavorites();
  const count = ids.length;
  return (
    <Link
      href="/favoritter"
      aria-label={count > 0 ? `Favoritter, ${count}` : "Favoritter"}
      className="relative inline-flex size-11 items-center justify-center rounded-full hover:bg-chrome-ink/10"
    >
      <Heart className="size-6" strokeWidth={1.6} aria-hidden="true" />
      {count > 0 && (
        <span className="absolute top-0.5 right-0.5 flex min-w-5 items-center justify-center rounded-full bg-action px-1 text-[11px] leading-5 font-semibold text-on-action">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
