"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ProductImage } from "@/components/products/product-image";
import { formatAmount } from "@/lib/money";
import type { Suggestions } from "@/lib/search";
import { SearchIcon } from "./search-icon";

const EMPTY: Suggestions = { products: [], links: [], searched: null };

/**
 * The search field with suggestions while typing: products (with photo and price), and
 * categories and themes. Arrow keys move through them, Enter opens one, or the search page
 * when none is chosen (a combobox: Tab leaves the field and closes the list). Without
 * JavaScript it is a plain form to /soeg.
 */
export function SearchBox({ defaultValue = "", autoFocus = false, className = "" }: { defaultValue?: string; autoFocus?: boolean; className?: string }) {
  const router = useRouter();
  const id = useId();
  const [query, setQuery] = useState(defaultValue);
  const [results, setResults] = useState<{ q: string; data: Suggestions }>({ q: "", data: EMPTY });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const q = query.replace(/\s+/g, " ").trim();
  useEffect(() => {
    if (q.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (response.ok) setResults({ q, data: (await response.json()) as Suggestions });
      } catch {
        // Aborted or offline: keep the last suggestions; Enter still searches.
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  // Close when clicking elsewhere.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const data = q.length >= 2 && results.q ? results.data : EMPTY;
  const options = [
    ...data.links.map((l) => ({ key: `l-${l.href}`, href: l.href })),
    ...data.products.map((p) => ({ key: `p-${p.id}`, href: `/produkter/${p.slug}` })),
  ];
  const showList = open && q.length >= 2 && (options.length > 0 || results.q === q);
  const optionId = (index: number) => `${id}-option-${index}`;
  // Read out by screen readers when the suggestions for what was typed arrive.
  const status = showList && results.q === q ? (options.length > 0 ? `${options.length} forslag – brug piletasterne til at vælge.` : "Ingen forslag.") : "";

  function go(href: string) {
    setOpen(false);
    setActive(-1);
    router.push(href);
  }

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <form
        action="/soeg"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          const chosen = options[active];
          if (chosen) go(chosen.href);
          else if (q) go(`/soeg?q=${encodeURIComponent(q)}`);
        }}
      >
        <label htmlFor={`${id}-input`} className="sr-only">
          Søg efter produkter
        </label>
        <input
          id={`${id}-input`}
          type="search"
          name="q"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={(event) => {
            // Focus left the field (Tab, or a tap elsewhere): close the list, unless it went into the list.
            if (!listRef.current?.contains(event.relatedTarget as Node | null)) {
              setOpen(false);
              setActive(-1);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && options.length > 0) {
              event.preventDefault();
              setOpen(true);
              setActive((a) => (a + 1) % options.length);
            } else if (event.key === "ArrowUp" && options.length > 0) {
              event.preventDefault();
              setActive((a) => (a <= 0 ? options.length - 1 : a - 1));
            } else if (event.key === "Escape") {
              setOpen(false);
              setActive(-1);
            }
          }}
          autoFocus={autoFocus}
          autoComplete="off"
          placeholder="Søg efter kostume, paryk, maske …"
          enterKeyHint="search"
          maxLength={100}
          role="combobox"
          aria-expanded={showList}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
          className="h-11 w-full rounded-full border border-field bg-surface pr-12 pl-4 text-base text-ink placeholder:text-muted focus:border-ink focus:outline-none sm:text-[15px]"
        />
        <button type="submit" className="absolute top-1 right-1 flex size-9 items-center justify-center rounded-full text-ink hover:bg-tint" aria-label="Søg">
          <SearchIcon />
        </button>
      </form>

      <p role="status" className="sr-only">
        {status}
      </p>

      {showList && (
        <div
          ref={listRef}
          className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-2xl bg-surface text-ink shadow-[0_16px_48px_rgb(0_0_0/0.18)] ring-1 ring-black/5"
          // Keep the focus in the field while an option is clicked (Safari would otherwise blur it and close the list first).
          onMouseDown={(event) => event.preventDefault()}
        >
          {results.q === q && data.searched && <p className="px-4 pt-3 text-xs text-muted">Viser forslag for “{data.searched}”</p>}
          <ul id={`${id}-list`} role="listbox" aria-label="Forslag" className="max-h-[min(70vh,560px)] overflow-y-auto py-2">
            {data.links.map((link, i) => (
              <li key={link.href} id={optionId(i)} role="option" aria-selected={active === i}>
                <a
                  href={link.href}
                  tabIndex={-1}
                  onClick={(event) => {
                    event.preventDefault();
                    go(link.href);
                  }}
                  className={`flex items-center justify-between gap-3 px-4 py-2.5 text-[15px] ${active === i ? "bg-tint" : "hover:bg-tint"}`}
                >
                  <span className="font-semibold">{link.label}</span>
                  <span className="text-xs text-muted">{link.kind}</span>
                </a>
              </li>
            ))}
            {data.products.map((product, j) => {
              const i = data.links.length + j;
              return (
                <li key={product.id} id={optionId(i)} role="option" aria-selected={active === i}>
                  <a
                    href={`/produkter/${product.slug}`}
                    tabIndex={-1}
                    onClick={(event) => {
                      event.preventDefault();
                      go(`/produkter/${product.slug}`);
                    }}
                    className={`flex items-center gap-3 px-4 py-2 ${active === i ? "bg-tint" : "hover:bg-tint"}`}
                  >
                    <span className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-white ring-1 ring-line">
                      <ProductImage image={product.image} name={product.name} sizes="48px" decorative />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm leading-snug font-semibold">
                        {product.adult && <span className="mr-1 rounded bg-ink px-1 text-[11px] font-bold text-white">18+</span>}
                        {product.name}
                      </span>
                      {product.price && (
                        <span className="text-sm font-bold text-price">
                          {product.from && "fra "}
                          {formatAmount(product.price)} kr.
                        </span>
                      )}
                    </span>
                  </a>
                </li>
              );
            })}
            {options.length === 0 && <li className="px-4 py-3 text-sm text-muted">Ingen forslag – tryk Enter for at søge.</li>}
          </ul>
          {q && (
            <a
              href={`/soeg?q=${encodeURIComponent(q)}`}
              tabIndex={-1}
              onClick={(event) => {
                event.preventDefault();
                go(`/soeg?q=${encodeURIComponent(q)}`);
              }}
              className="block border-t border-line px-4 py-3 text-sm font-semibold text-accent hover:bg-tint"
            >
              Se alle resultater for “{q}”
            </a>
          )}
        </div>
      )}
    </div>
  );
}
