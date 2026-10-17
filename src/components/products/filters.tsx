import { Check, X } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { filteredHref, priceBand, type FilterOptions, type FilterSelection } from "@/lib/listing-filters";

/** A listing's filters: the choices it offers and what is chosen, on `path` with its other parameters (the sorting). */
export type ListingFiltersProps = { path: string; params: Record<string, string>; options: FilterOptions; selection: FilterSelection };

/** Whether there is anything to filter by. */
export function hasFilterChoices(options: FilterOptions): boolean {
  return options.sizes.length > 0 || options.prices.length > 1 || options.stock;
}

// Filter links are left to search engines' discretion (rel="nofollow"): filtered pages are not
// indexed, and every combination would be another page for the WordPress host to serve.
// 44 px tall below the large screens, a finger's size (WCAG's touch guideline).
const chip = "inline-flex h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm whitespace-nowrap transition-colors lg:h-9";

/** Larger screens: the filters as rows of choices above the products; a click applies one. */
export function FilterBar({ path, params, options, selection }: ListingFiltersProps) {
  const href = (change: FilterSelection) => filteredHref(path, params, { ...selection, ...change });
  return (
    <div className="mt-6 hidden space-y-2.5 rounded-[var(--radius-card)] border border-line bg-surface px-5 py-4 lg:block">
      {options.sizes.length > 0 && (
        <FilterRow label="Størrelse">
          {options.sizes.map((group) => (
            <div key={group.key} role="group" aria-label={group.label} className="flex flex-wrap items-center gap-2">
              <span aria-hidden="true" className="mr-0.5 text-xs font-bold tracking-[0.12em] text-muted uppercase">
                {group.label}
              </span>
              {group.options.map((option) => (
                <FilterChip key={option.key} href={href({ size: selection.size === option.key ? undefined : option.key })} selected={selection.size === option.key}>
                  {option.label}
                </FilterChip>
              ))}
            </div>
          ))}
        </FilterRow>
      )}
      {options.prices.length > 1 && (
        <FilterRow label="Pris">
          <div className="flex flex-wrap items-center gap-2">
            {options.prices.map((band) => (
              <FilterChip key={band.key} href={href({ price: selection.price === band.key ? undefined : band.key })} selected={selection.price === band.key}>
                {band.label}
              </FilterChip>
            ))}
          </div>
        </FilterRow>
      )}
      {options.stock && (
        <FilterRow label="Lager">
          <FilterChip href={href({ inStock: selection.inStock ? undefined : true })} selected={Boolean(selection.inStock)}>
            Kun på lager
          </FilterChip>
        </FilterRow>
      )}
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex items-start gap-4">
      <p aria-hidden="true" className="w-20 shrink-0 pt-2 text-sm font-bold text-ink">
        {label}
      </p>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">{children}</div>
    </div>
  );
}

function FilterChip({ href, selected, children }: { href: string; selected: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      rel="nofollow"
      aria-current={selected ? "true" : undefined}
      className={`${chip} ${selected ? "border-ink bg-ink font-semibold text-white" : "border-line-strong bg-surface text-ink hover:border-ink"}`}
    >
      {selected && <Check className="-ml-1 size-4" aria-hidden="true" />}
      {children}
    </Link>
  );
}

/** The chosen filters, each with its own remove link, and "Ryd alle". */
export function ActiveFilters({ path, params, options, selection }: ListingFiltersProps) {
  const chosen: { label: string; without: FilterSelection }[] = [];
  const size = options.sizes.flatMap((g) => g.options).find((o) => o.key === selection.size);
  const band = priceBand(selection.price);
  if (size) chosen.push({ label: size.label, without: { ...selection, size: undefined } });
  if (band) chosen.push({ label: band.label, without: { ...selection, price: undefined } });
  if (selection.inStock) chosen.push({ label: "Kun på lager", without: { ...selection, inStock: undefined } });
  if (chosen.length === 0) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {chosen.map((c) => (
        <Link
          key={c.label}
          href={filteredHref(path, params, c.without)}
          scroll={false}
          rel="nofollow"
          aria-label={`Fjern filteret ${c.label}`}
          className="inline-flex h-8 items-center gap-1 rounded-full border border-ink bg-surface pr-2 pl-3 text-sm font-semibold text-ink hover:bg-tint"
        >
          {c.label}
          <X className="size-4" aria-hidden="true" />
        </Link>
      ))}
      <Link href={filteredHref(path, params, {})} scroll={false} rel="nofollow" className="ml-1 text-sm font-semibold text-ink-soft underline underline-offset-4 hover:text-ink">
        Ryd alle
      </Link>
    </div>
  );
}
