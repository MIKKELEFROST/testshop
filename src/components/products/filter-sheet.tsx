"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ChangeEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { activeFilterCount, filteredHref, type FilterSelection } from "@/lib/listing-filters";
import type { ListingFiltersProps } from "./filters";

// Slides up from the bottom, like the cart drawer slides in from the right (see cart-drawer.tsx).
const sheetClasses = [
  "fixed inset-x-0 top-auto bottom-0 z-50 m-0 h-auto max-h-[85dvh] w-full max-w-none overflow-hidden rounded-t-2xl bg-surface p-0 text-ink shadow-2xl",
  "translate-y-full open:translate-y-0 starting:open:translate-y-full",
  "transition-[translate,display,overlay] transition-discrete duration-300 ease-out",
  "backdrop:bg-transparent open:backdrop:bg-ink/40 starting:open:backdrop:bg-transparent",
  "backdrop:transition-[background-color,display,overlay] backdrop:transition-discrete backdrop:duration-300",
  "motion-reduce:transition-none motion-reduce:backdrop:transition-none",
].join(" ");

/**
 * Phones and tablets: "Filtrér" (with the number of chosen filters) opens the filters in a
 * sheet from the bottom. Choices are applied together with "Vis varer"; closing the sheet
 * (×, Esc, the backdrop) leaves the listing as it was. A native modal <dialog> provides the
 * focus trap, Esc, the top layer and returning focus to the button.
 */
export function FilterSheet({ path, params, options, selection }: ListingFiltersProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FilterSelection>(selection);
  const id = useId();
  const count = activeFilterCount(selection);

  // The page behind must not scroll. Keep the scrollbar's space so the layout does not shift.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const hadScrollbar = window.innerWidth > root.clientWidth;
    const previous = { overflow: root.style.overflow, scrollbarGutter: root.style.scrollbarGutter };
    root.style.overflow = "hidden";
    if (hadScrollbar) root.style.scrollbarGutter = "stable";
    return () => {
      root.style.overflow = previous.overflow;
      root.style.scrollbarGutter = previous.scrollbarGutter;
    };
  }, [open]);

  function show() {
    setDraft(selection);
    dialogRef.current?.showModal();
    setOpen(true);
  }

  function apply() {
    dialogRef.current?.close();
    router.push(filteredHref(path, params, draft), { scroll: false });
  }

  // A click on the <dialog> itself (not its content) is a click on the backdrop; the press must start there too.
  function handlePointerDown(event: PointerEvent<HTMLDialogElement>) {
    pressedBackdrop.current = event.target === event.currentTarget;
  }
  function handleClick(event: MouseEvent<HTMLDialogElement>) {
    if (pressedBackdrop.current && event.target === event.currentTarget) dialogRef.current?.close();
  }

  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-haspopup="dialog"
        className="inline-flex h-11 items-center gap-2 rounded-[var(--radius-control)] border border-field bg-surface px-3.5 text-[15px] font-semibold text-ink hover:border-ink lg:hidden"
      >
        <SlidersHorizontal className="size-4" aria-hidden="true" />
        Filtrér
        {count > 0 && (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-ink px-1.5 text-xs font-bold text-white">
            {count}
            <span className="sr-only"> valgt</span>
          </span>
        )}
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={`${id}-title`}
        className={sheetClasses}
        onClose={() => setOpen(false)}
        onPointerDown={handlePointerDown}
        onClick={handleClick}
      >
        <form
          className="flex max-h-[85dvh] flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          <div className="flex items-center justify-between gap-4 border-b border-line py-2 pr-3 pl-5">
            <h2 id={`${id}-title`} className="text-lg font-semibold">
              Filtrér
            </h2>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              aria-label="Luk filtrene"
              className="inline-flex size-11 items-center justify-center rounded-full text-ink-soft hover:bg-black/5 hover:text-ink"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>

          <div className="flex-1 space-y-7 overflow-y-auto overscroll-contain px-5 py-5">
            {options.sizes.length > 0 && (
              <fieldset>
                <legend className="text-base font-bold">Størrelse</legend>
                <div className="mt-3 flex flex-wrap gap-2">
                  <RadioChip name={`${id}-size`} checked={!draft.size} onChange={() => setDraft({ ...draft, size: undefined })}>
                    Alle størrelser
                  </RadioChip>
                </div>
                {options.sizes.map((group) => (
                  <div key={group.key} role="group" aria-labelledby={`${id}-${group.key}`} className="mt-4">
                    <p id={`${id}-${group.key}`} className="text-xs font-bold tracking-[0.12em] text-muted uppercase">
                      {group.label}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {group.options.map((option) => (
                        <RadioChip
                          key={option.key}
                          name={`${id}-size`}
                          checked={draft.size === option.key}
                          onChange={() => setDraft({ ...draft, size: option.key })}
                        >
                          {option.label}
                        </RadioChip>
                      ))}
                    </div>
                  </div>
                ))}
              </fieldset>
            )}

            {options.prices.length > 1 && (
              <fieldset>
                <legend className="text-base font-bold">Pris</legend>
                <div className="mt-3 flex flex-wrap gap-2">
                  <RadioChip name={`${id}-price`} checked={!draft.price} onChange={() => setDraft({ ...draft, price: undefined })}>
                    Alle priser
                  </RadioChip>
                  {options.prices.map((band) => (
                    <RadioChip key={band.key} name={`${id}-price`} checked={draft.price === band.key} onChange={() => setDraft({ ...draft, price: band.key })}>
                      {band.label}
                    </RadioChip>
                  ))}
                </div>
              </fieldset>
            )}

            {options.stock && (
              <label className="flex cursor-pointer items-center justify-between gap-4 text-base font-bold">
                Kun varer på lager
                <input
                  type="checkbox"
                  checked={Boolean(draft.inStock)}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, inStock: event.target.checked || undefined })}
                  className="size-6 accent-ink"
                />
              </label>
            )}
          </div>

          <div className="flex items-center gap-3 border-t border-line px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={() => setDraft({})}
              disabled={activeFilterCount(draft) === 0}
              className="h-12 px-2 text-[15px] font-semibold text-ink underline underline-offset-4 disabled:text-muted disabled:no-underline"
            >
              Ryd alle
            </button>
            <Button type="submit" size="lg" className="flex-1">
              Vis varer
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}

/** A choice styled as a chip; the input stays a real radio button for keyboards (arrow keys) and screen readers. */
function RadioChip({ name, checked, onChange, children }: { name: string; checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label className="relative inline-flex h-10 cursor-pointer items-center rounded-full border border-line-strong bg-surface px-4 text-[15px] text-ink transition-colors select-none has-checked:border-ink has-checked:bg-ink has-checked:font-semibold has-checked:text-white has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent">
      <input type="radio" name={name} checked={checked} onChange={onChange} className="sr-only" />
      {children}
    </label>
  );
}
