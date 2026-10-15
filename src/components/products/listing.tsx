import { Suspense } from "react";
import { pageHref, Pagination } from "@/components/ui/pagination";
import { productCount } from "@/lib/format";
import { SORTS, type SortKey } from "@/lib/woocommerce/products";
import type { ProductList } from "@/types/commerce";
import { ProductGrid } from "./product-card";
import { SortSelect } from "./sort-select";

const SORT_OPTIONS = (Object.keys(SORTS) as SortKey[]).map((key) => ({ key, label: SORTS[key].label }));

/** A listing's toolbar (number of products and sorting), the cards and the page links. */
export function ProductListing({ list, sort, path, params = {} }: { list: ProductList; sort: SortKey; path: string; params?: Record<string, string> }) {
  const query = sort === "anbefalet" ? params : { ...params, sorter: sort };
  return (
    <>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <p className="text-sm font-semibold text-ink-soft" aria-live="polite">
          {productCount(list.total)}
        </p>
        {list.total > 1 && (
          <Suspense fallback={<div className="h-10 w-52" />}>
            <SortSelect value={sort} options={SORT_OPTIONS} />
          </Suspense>
        )}
      </div>
      <div className="mt-6">
        <ProductGrid products={list.products} />
      </div>
      <Pagination page={list.page} totalPages={list.totalPages} href={(p) => pageHref(path, p, query)} />
    </>
  );
}
