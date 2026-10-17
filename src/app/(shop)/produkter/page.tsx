import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ProductListing } from "@/components/products/listing";
import { CardBand, ProductGridSkeleton } from "@/components/products/product-card";
import { CatalogRetry } from "@/components/ui/catalog-retry";
import { pageHref } from "@/components/ui/pagination";
import { activeFilterCount, parseFilters } from "@/lib/listing-filters";
import { allProductsDescription, pageDescription } from "@/lib/meta-description";
import { openGraphFor } from "@/lib/seo";
import { parsePage } from "@/lib/pagination";
import { getSeasonalProducts } from "@/lib/woocommerce/collections";
import { filteredListing, getFilterOptions, resolveFilters } from "@/lib/woocommerce/filters";
import { storeConfig } from "@/config/store";
import { parseSort, type ProductFilters, type SortKey } from "@/lib/woocommerce/products";

export async function generateMetadata(props: PageProps<"/produkter">): Promise<Metadata> {
  const query = await props.searchParams;
  // As on category pages, search engines get the metadata first: a 404 for a page past the last one.
  const page = parsePage(query.side);
  const chosen = parseFilters(query);
  const filters = await resolveFilters(chosen);
  const result = await filteredListing(filters, (filtered) => allProducts(page, parseSort(query.sorter), filtered));
  if (result.ok && result.data.products.length === 0 && page > 1) notFound();
  const canonical = pageHref("/produkter", page);
  return {
    title: page > 1 ? `Alle produkter – side ${page}` : "Alle produkter",
    // Its own description, not the front page's (without the products' number when they can't be read).
    description: result.ok ? pageDescription(allProductsDescription(result.data.total, storeConfig.name), page) : undefined,
    alternates: { canonical },
    openGraph: openGraphFor(canonical),
    // A filtered view (any filter in the address, applied or not) is not a page of its own for
    // search engines (its links are followed), and a page whose products couldn't be read is
    // not one to show in search results.
    robots: activeFilterCount(chosen) > 0 || !result.ok ? { index: false, follow: true } : undefined,
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
  const [result, options] = await Promise.all([
    filteredListing(filters, (filtered) => allProducts(page, sort, filtered)),
    getFilterOptions({}, filters.selection),
  ]);
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
