import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ProductGrid, ProductGridSkeleton } from "@/components/products/product-card";
import { Alert } from "@/components/ui/alert";
import { getCategories, getProducts } from "@/lib/woocommerce/products";

export default function CategoryPage(props: PageProps<"/kategori/[slug]">) {
  return (
    <div className="container-shop pt-10">
      <Suspense
        fallback={
          <>
            <div className="h-10 w-48 animate-pulse rounded bg-black/5" />
            <div className="mt-8">
              <ProductGridSkeleton />
            </div>
          </>
        }
      >
        <CategoryContent params={props.params} />
      </Suspense>
    </div>
  );
}

async function CategoryContent({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const categories = await getCategories();
  if (!categories.ok) return <Alert tone="warning">{categories.error}</Alert>;

  const category = categories.data.find((c) => c.slug === slug);
  if (!category) notFound();

  const products = await getProducts({ categoryId: category.id });

  return (
    <>
      <nav aria-label="Brødkrummer" className="text-sm text-muted">
        <Link href="/produkter" className="hover:text-ink">
          Alle produkter
        </Link>{" "}
        / <span className="text-ink">{category.name}</span>
      </nav>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{category.name}</h1>
      {category.description && <p className="mt-3 max-w-2xl text-muted">{category.description}</p>}
      <div className="mt-8">
        {products.ok ? <ProductGrid products={products.data} /> : <Alert tone="warning">{products.error}</Alert>}
      </div>
    </>
  );
}
