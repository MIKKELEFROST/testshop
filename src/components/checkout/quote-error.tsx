"use client";

import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { Alert } from "@/components/ui/alert";

/**
 * A failed quote with "Prøv igen" (the quote is also asked for again by itself, see use-quote.ts).
 * While the retry runs the button stays, busy, so focus stays on it. When the quote then
 * arrives and the error goes, focus moves to `focusAfter` instead of falling to the page.
 */
export function QuoteError({
  error,
  retrying = false,
  onRetry,
  focusAfter,
  children,
}: {
  error: string;
  retrying?: boolean;
  onRetry: () => void;
  /** A nearby element that stays, e.g. a heading. */
  focusAfter?: RefObject<HTMLElement | null>;
  children?: ReactNode;
}) {
  const button = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const node = button.current;
    const target = focusAfter?.current;
    // Runs before the alert leaves the page, while the button still has focus.
    return () => {
      if (node && target?.isConnected && document.activeElement === node) focusStatic(target);
    };
  }, [focusAfter]);

  return (
    <Alert tone="error">
      <p>{error}</p>
      {children && <p className="mt-1 text-ink-soft">{children}</p>}
      <button
        ref={button}
        type="button"
        // Not `disabled`: that would drop the focus too.
        aria-disabled={retrying || undefined}
        aria-busy={retrying || undefined}
        onClick={retrying ? undefined : onRetry}
        className="-mx-2 mt-1 inline-flex min-h-11 items-center px-2 font-medium underline underline-offset-4 hover:text-ink aria-disabled:cursor-wait aria-disabled:no-underline"
      >
        {retrying ? "Prøver igen…" : "Prøv igen"}
      </button>
    </Alert>
  );
}

/** Focuses an element that cannot take focus by itself (e.g. a heading), until it loses it again. */
function focusStatic(target: HTMLElement) {
  if (!target.hasAttribute("tabindex")) {
    target.setAttribute("tabindex", "-1");
    target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true });
  }
  target.focus();
}
