import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { productCount } from "@/lib/format";
import { SearchForm } from "@/components/layout/search-form";
import { ProductGrid, ProductGridSkeleton } from "@/components/products/product-card";
import { Alert } from "@/components/ui/alert";
import { pageHref, Pagination } from "@/components/ui/pagination";
import { parsePage } from "@/lib/pagination";
import { getProducts } from "@/lib/woocommerce/products";

// Result pages are not worth indexing.
export const metadata: Metadata = { title: "Søg", robots: { index: false } };

export default function SearchPage(props: PageProps<"/soeg">) {
  return (
    <div className="container-shop pt-10">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Søg</h1>
      <Suspense
        fallback={
          <div className="mt-8">
            <ProductGridSkeleton />
          </div>
        }
      >
        <SearchResults searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

async function SearchResults({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const raw = Array.isArray(query.q) ? query.q[0] : query.q;
  const q = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
  const page = parsePage(query.side);

  if (!q) {
    return (
      <>
        <SearchForm autoFocus className="mt-6 max-w-xl" />
        <p className="mt-6 text-muted">Skriv, hvad du leder efter – fx “heks”, “paryk” eller “pirat”.</p>
      </>
    );
  }

  const result = await getProducts({ search: q, page });
  return (
    <>
      <SearchForm defaultValue={q} className="mt-6 max-w-xl" />
      {!result.ok ? (
        <div className="mt-8">
          <Alert tone="warning">{result.error}</Alert>
        </div>
      ) : result.data.total === 0 ? (
        <p className="mt-8 text-muted">
          Ingen produkter matcher “{q}”. Prøv et andet ord, eller se{" "}
          <Link href="/produkter" className="underline underline-offset-4">
            alle produkter
          </Link>
          .
        </p>
      ) : (
        <>
          <p className="mt-6 text-sm text-muted" aria-live="polite">
            {productCount(result.data.total)} matcher “{q}”
          </p>
          <div className="mt-6">
            <ProductGrid products={result.data.products} />
          </div>
          <Pagination page={page} totalPages={result.data.totalPages} href={(p) => pageHref("/soeg", p, { q })} />
        </>
      )}
    </>
  );
}
