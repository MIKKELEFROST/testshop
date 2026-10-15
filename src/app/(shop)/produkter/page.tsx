import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ProductListing } from "@/components/products/listing";
import { CardBand, ProductGridSkeleton } from "@/components/products/product-card";
import { Alert } from "@/components/ui/alert";
import { parsePage } from "@/lib/pagination";
import { getSeasonalProducts } from "@/lib/woocommerce/collections";
import { parseSort } from "@/lib/woocommerce/products";

export const metadata: Metadata = { title: "Alle produkter", alternates: { canonical: "/produkter" } };

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
  const result = await getSeasonalProducts({ page, sort, hideAdult: true });
  if (!result.ok) {
    return (
      <div className="mt-8">
        <Alert tone="warning">{result.error}</Alert>
      </div>
    );
  }
  if (result.data.products.length === 0 && page > 1) notFound();
  return <ProductListing list={result.data} sort={sort} path="/produkter" />;
}
