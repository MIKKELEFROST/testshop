"use client";

import { usePathname } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ComponentProps, type MouseEvent, type PointerEvent } from "react";
import { DispatchCountdown } from "@/components/marketing/dispatch-countdown";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import type { CartLine } from "@/lib/cart/cart";
import { useCart } from "./cart-provider";
import { CartLineItem, CartTotals, CheckoutButton, EmptyCart, useCartQuote } from "./cart-view";

const DRAWER_ID = "kurv-slider";

// Slides in from the right. @starting-style animates the opening; allow-discrete keeps `display`
// and the top layer (`overlay`) around while it slides out, where supported. Elsewhere it just
// appears and disappears.
const drawerClasses = [
  "fixed inset-y-0 right-0 left-auto z-50 m-0 h-dvh max-h-none w-[min(100vw,420px)] max-w-none overflow-hidden bg-surface p-0 text-ink shadow-2xl",
  "translate-x-full open:translate-x-0 starting:open:translate-x-full",
  "transition-[translate,display,overlay] transition-discrete duration-300 ease-out",
  "backdrop:bg-transparent open:backdrop:bg-ink/40 starting:open:backdrop:bg-transparent",
  "backdrop:transition-[background-color,display,overlay] backdrop:transition-discrete backdrop:duration-300",
  "motion-reduce:transition-none motion-reduce:backdrop:transition-none",
].join(" ");

/**
 * Cart that slides in from the right ("kurv-slider"), so adding to or looking at the cart does
 * not leave the page. Opens on "Læg i kurv" and from the cart buttons; /kurv stays available.
 *
 * A native modal <dialog> provides the focus trap, Esc, the top layer and returning focus to
 * the button that opened it. Mounted once in the root layout.
 */
export function CartDrawer() {
  const { lines, count, isOpen, closeCart, lastAdded } = useCart();
  // Prices are only fetched while the drawer is open (which also means the cart is hydrated).
  const { quote, loading, error, canCheckout } = useCartQuote(isOpen);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!isOpen) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
    // Screen readers skip text that is already in a live region when it appears, so the
    // confirmation is announced just after the dialog has opened.
    const message = lastAdded ? `Lagt i kurven: ${lastAdded.name}${lastAdded.variantLabel ? `, ${lastAdded.variantLabel}` : ""}` : "";
    const timer = window.setTimeout(() => setAnnouncement(message), 100);
    return () => window.clearTimeout(timer);
  }, [isOpen, lastAdded]);

  // The page behind must not scroll. Keep the scrollbar's space so the layout does not shift.
  useEffect(() => {
    if (!isOpen) return;
    const root = document.documentElement;
    const hadScrollbar = window.innerWidth > root.clientWidth;
    const previous = { overflow: root.style.overflow, scrollbarGutter: root.style.scrollbarGutter };
    root.style.overflow = "hidden";
    if (hadScrollbar) root.style.scrollbarGutter = "stable";
    return () => {
      root.style.overflow = previous.overflow;
      root.style.scrollbarGutter = previous.scrollbarGutter;
    };
  }, [isOpen]);

  // Esc, the close button, the backdrop and navigation all end here.
  function handleClose() {
    setAnnouncement("");
    closeCart();
  }

  // A click on the <dialog> itself (not its content) is a click on the backdrop. The press must
  // start there too, so dragging out of the panel (e.g. while selecting text) does not close it.
  function handlePointerDown(event: PointerEvent<HTMLDialogElement>) {
    pressedBackdrop.current = event.target === event.currentTarget;
  }
  function handleClick(event: MouseEvent<HTMLDialogElement>) {
    if (pressedBackdrop.current && event.target === event.currentTarget) closeCart();
  }

  return (
    <>
      <dialog
        ref={dialogRef}
        id={DRAWER_ID}
        aria-labelledby={`${DRAWER_ID}-titel`}
        className={drawerClasses}
        onClose={handleClose}
        onPointerDown={handlePointerDown}
        onClick={handleClick}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-4 border-b border-line py-2 pr-3 pl-5">
            <h2 id={`${DRAWER_ID}-titel`} className="text-lg font-semibold">
              Kurv
              {count > 0 && <span className="font-normal text-muted"> ({count})</span>}
            </h2>
            <button
              type="button"
              onClick={closeCart}
              aria-label="Luk kurven"
              className="inline-flex size-11 items-center justify-center rounded-full text-ink-soft hover:bg-black/5 hover:text-ink"
            >
              <svg viewBox="0 0 20 20" className="size-5" fill="currentColor" aria-hidden="true">
                <path d="m5.3 4.2 4.7 4.7 4.7-4.7 1.1 1.1-4.7 4.7 4.7 4.7-1.1 1.1-4.7-4.7-4.7 4.7-1.1-1.1 4.7-4.7-4.7-4.7z" />
              </svg>
            </button>
          </div>

          <p role="status" className="sr-only">
            {announcement}
          </p>
          {lastAdded && <AddedConfirmation line={lastAdded} />}

          {lines.length === 0 ? (
            <EmptyCart className="flex flex-1 flex-col items-center justify-center px-6 text-center" onNavigate={closeCart} />
          ) : (
            <>
              <ul className="flex-1 divide-y divide-line overflow-y-auto overscroll-contain px-5">
                {lines.map((line) => (
                  <CartLineItem key={line.key} line={line} quote={quote} compact onNavigate={closeCart} />
                ))}
              </ul>

              <div className="border-t border-line px-5 pt-4 pb-5">
                <CartTotals quote={quote} loading={loading} />
                {error && (
                  <div className="mt-3">
                    <Alert tone="error">{error}</Alert>
                  </div>
                )}
                <DispatchCountdown className="mt-4 text-sm" />
                <div className="mt-3 grid gap-2">
                  <CheckoutButton canCheckout={canCheckout} loading={loading} onNavigate={closeCart}>
                    Til kassen
                  </CheckoutButton>
                  <ButtonLink href="/kurv" variant="secondary" full onNavigate={closeCart}>
                    Se hele kurven
                  </ButtonLink>
                </div>
              </div>
            </>
          )}
        </div>
      </dialog>

      <Suspense fallback={null}>
        <CloseOnRouteChange onChange={closeCart} />
      </Suspense>
    </>
  );
}

/** Opens the cart drawer. Can be rendered from server components (e.g. the footer). */
export function OpenCartButton(props: Omit<ComponentProps<"button">, "type" | "onClick">) {
  const { isOpen, openCart } = useCart();
  return (
    <button type="button" onClick={openCart} aria-haspopup="dialog" aria-expanded={isOpen} aria-controls={DRAWER_ID} {...props} />
  );
}

/** Visual confirmation; screen readers get it from the live region above instead. */
function AddedConfirmation({ line }: { line: CartLine }) {
  return (
    <div
      aria-hidden="true"
      className="mx-5 mt-4 flex items-center gap-3 rounded-[var(--radius-control)] border border-success/30 bg-success/5 px-4 py-3 text-sm motion-safe:animate-fade-in"
    >
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-success text-white">
        <svg viewBox="0 0 20 20" className="size-3.5" fill="currentColor">
          <path d="M8.1 13.4 4.7 10l-1.2 1.2 4.6 4.6 9-9-1.2-1.2z" />
        </svg>
      </span>
      <p className="min-w-0 truncate">
        <span className="font-medium text-success">Lagt i kurven:</span> {line.name}
        {line.variantLabel && <span className="text-muted"> · {line.variantLabel}</span>}
      </p>
    </div>
  );
}

/**
 * Closes the drawer when the route changes, including browser back/forward. (Links inside the
 * drawer close it right away through `onNavigate`, also when they point at the current page.)
 * usePathname needs a Suspense boundary on routes whose params are only known at request time.
 */
function CloseOnRouteChange({ onChange }: { onChange: () => void }) {
  const pathname = usePathname();
  const previous = useRef(pathname);
  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    onChange();
  }, [pathname, onChange]);
  return null;
}
