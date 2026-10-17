import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ProductListing } from "@/components/products/listing";
import { CardBand, ProductGridSkeleton } from "@/components/products/product-card";
import { CatalogRetry } from "@/components/ui/catalog-retry";
import { pageHref } from "@/components/ui/pagination";
import { activeFilterCount, parseFilters } from "@/lib/listing-filters";
import { parsePage } from "@/lib/pagination";
import { getSeasonalProducts } from "@/lib/woocommerce/collections";
import { getFilterOptions, resolveFilters } from "@/lib/woocommerce/filters";
import { parseSort, type ProductFilters, type SortKey } from "@/lib/woocommerce/products";

export async function generateMetadata(props: PageProps<"/produkter">): Promise<Metadata> {
  const query = await props.searchParams;
  // As on category pages, search engines get the metadata first: a 404 for a page past the last one.
  const page = parsePage(query.side);
  const filters = await resolveFilters(parseFilters(query));
  const result = await allProducts(page, parseSort(query.sorter), filters.query);
  if (result.ok && result.data.products.length === 0 && page > 1) notFound();
  return {
    title: page > 1 ? `Alle produkter – side ${page}` : "Alle produkter",
    alternates: { canonical: pageHref("/produkter", page) },
    // A filtered view is not a page of its own for search engines (its links are followed), and
    // a page whose products couldn't be read is not one to show in search results.
    robots: activeFilterCount(filters.selection) > 0 || !result.ok ? { index: false, follow: true } : undefined,
  };
}

/** A page of all the shop's products except the 18+ ones, the season's first. */
function allProducts(page: number, sort: SortKey, filters: ProductFilters) {
  return getSeasonalProducts({ page, sort, hideAdult: true, ...filters });
}

export default function ProductsPage(props: PageProps<"/produkter">) {
  return (
    <CardBand>
      <div className="container-shop pt-10">
        <h1 className="heading text-[34px] text-ink sm:text-5xl">Alle produkter</h1>
        <Suspense
          fallback={
            <div className="mt-8">
              <ProductGridSkeleton />
            </div>
          }
        >
          <AllProducts searchParams={props.searchParams} />
        </Suspense>
      </div>
    </CardBand>
  );
}

async function AllProducts({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const page = parsePage(query.side);
  const sort = parseSort(query.sorter);
  const filters = await resolveFilters(parseFilters(query));
  const [result, options] = await Promise.all([allProducts(page, sort, filters.query), getFilterOptions({}, filters.selection)]);
  if (!result.ok) {
    return (
      <div className="mt-8">
        <CatalogRetry loading="Vi henter varerne …" message={result.error} />
      </div>
    );
  }
  if (result.data.products.length === 0 && page > 1) notFound();
  return <ProductListing list={result.data} sort={sort} path="/produkter" filters={{ options, selection: filters.selection }} />;
}
