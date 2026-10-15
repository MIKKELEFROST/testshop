import type { Metadata } from "next";
import { Suspense } from "react";
import { ProductGrid, ProductGridSkeleton } from "@/components/products/product-card";
import { Alert } from "@/components/ui/alert";
import { getProducts } from "@/lib/woocommerce/products";

export const metadata: Metadata = { title: "Alle produkter" };

export default function ProductsPage() {
  return (
    <div className="container-shop pt-10">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Alle produkter</h1>
      <div className="mt-8">
        <Suspense fallback={<ProductGridSkeleton />}>
          <AllProducts />
        </Suspense>
      </div>
    </div>
  );
}

async function AllProducts() {
  const products = await getProducts();
  if (!products.ok) return <Alert tone="warning">{products.error}</Alert>;
  return <ProductGrid products={products.data} />;
}
