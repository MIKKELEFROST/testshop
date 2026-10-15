"use client";

import { OpenCartButton } from "@/components/cart/cart-drawer";
import { useCart } from "@/components/cart/cart-provider";

/** Header cart icon. Opens the cart drawer instead of going to /kurv. */
export function CartButton() {
  const { count, hydrated } = useCart();
  const label = hydrated && count > 0 ? `Kurv, ${count} ${count === 1 ? "vare" : "varer"}` : "Kurv";

  return (
    <OpenCartButton
      aria-label={label}
      className="relative inline-flex size-11 items-center justify-center rounded-full hover:bg-chrome-ink/10"
    >
      <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M5 7h14l-1.2 12.1a2 2 0 0 1-2 1.9H8.2a2 2 0 0 1-2-1.9L5 7Z" strokeLinejoin="round" />
        <path d="M9 9V6a3 3 0 0 1 6 0v3" strokeLinecap="round" />
      </svg>
      {hydrated && count > 0 && (
        <span className="absolute right-0.5 top-0.5 flex min-w-5 items-center justify-center rounded-full bg-action px-1 text-[11px] font-semibold leading-5 text-on-action">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </OpenCartButton>
  );
}
