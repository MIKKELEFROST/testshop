import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ProductGrid, ProductGridSkeleton } from "@/components/products/product-card";
import { Alert } from "@/components/ui/alert";
import { pageHref, Pagination } from "@/components/ui/pagination";
import { parsePage } from "@/lib/pagination";
import { getProducts } from "@/lib/woocommerce/products";
import { productCount } from "@/lib/format";

export const metadata: Metadata = { title: "Alle produkter" };

export default function ProductsPage(props: PageProps<"/produkter">) {
  return (
    <div className="container-shop pt-10">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Alle produkter</h1>
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
  );
}

async function AllProducts({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const page = parsePage((await searchParams).side);
  const result = await getProducts({ page });
  if (!result.ok) {
    return (
      <div className="mt-8">
        <Alert tone="warning">{result.error}</Alert>
      </div>
    );
  }
  const { products, total, totalPages } = result.data;
  if (products.length === 0 && page > 1) notFound();
  return (
    <>
      <p className="mt-2 text-sm text-muted">{productCount(total)}</p>
      <div className="mt-8">
        <ProductGrid products={products} />
      </div>
      <Pagination page={page} totalPages={totalPages} href={(p) => pageHref("/produkter", p)} />
    </>
  );
}
