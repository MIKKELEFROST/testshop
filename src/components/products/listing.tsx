import { Suspense } from "react";
import { ButtonLink } from "@/components/ui/button";
import { pageHref, Pagination } from "@/components/ui/pagination";
import { productCount } from "@/lib/format";
import { activeFilterCount, filteredHref, filterParams, type FilterOptions, type FilterSelection } from "@/lib/listing-filters";
import { SORTS, type SortKey } from "@/lib/woocommerce/products";
import type { ProductList } from "@/types/commerce";
import { FilterSheet } from "./filter-sheet";
import { ActiveFilters, FilterBar, hasFilterChoices } from "./filters";
import { ProductGrid } from "./product-card";
import { SortSelect } from "./sort-select";

const SORT_OPTIONS = (Object.keys(SORTS) as SortKey[]).map((key) => ({ key, label: SORTS[key].label }));

/** Listings this small (and not filtered) are shown without filters. */
const FILTER_FROM = 9;

/**
 * A listing's filters (larger screens: rows above the products; phones: a sheet), toolbar
 * (number of products and sorting), the cards and the page links. Sorting, filters and page
 * are URL parameters, so every link keeps the others.
 */
export function ProductListing({
  list,
  sort,
  path,
  params = {},
  filters,
}: {
  list: ProductList;
  sort: SortKey;
  path: string;
  params?: Record<string, string>;
  /** The filters' choices for this listing and what is chosen (see lib/woocommerce/filters.ts). */
  filters?: { options: FilterOptions; selection: FilterSelection };
}) {
  const base = sort === "anbefalet" ? params : { ...params, sorter: sort };
  const selection = filters?.selection ?? {};
  const filtered = activeFilterCount(selection) > 0;
  const offered = filters && hasFilterChoices(filters.options) && (filtered || list.total >= FILTER_FROM) ? { path, params: base, options: filters.options, selection } : null;
  return (
    <>
      {offered && <FilterBar {...offered} />}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <div className="flex items-center gap-3">
          {offered && <FilterSheet {...offered} />}
          <p className="text-sm font-semibold text-ink-soft" aria-live="polite">
            {productCount(list.total)}
          </p>
        </div>
        {list.total > 1 && (
          <Suspense fallback={<div className="h-10 w-52" />}>
            <SortSelect value={sort} options={SORT_OPTIONS} />
          </Suspense>
        )}
      </div>
      {offered && <ActiveFilters {...offered} />}
      <h2 className="sr-only">Produkter</h2>
      <div className="mt-6">
        {filtered && list.total === 0 ? (
          <div className="py-12 text-center">
            <p className="text-lg font-semibold text-ink">Ingen varer passer til dine filtre.</p>
            <p className="mt-1 text-muted">Prøv en anden størrelse eller pris.</p>
            <ButtonLink href={filteredHref(path, base, {})} scroll={false} variant="secondary" className="mt-5">
              Ryd alle filtre
            </ButtonLink>
          </div>
        ) : (
          <ProductGrid products={list.products} />
        )}
      </div>
      <Pagination page={list.page} totalPages={list.totalPages} href={(p) => pageHref(path, p, { ...base, ...filterParams(selection) })} />
    </>
  );
}
