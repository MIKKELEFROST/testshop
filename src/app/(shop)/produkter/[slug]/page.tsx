import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ProductUsps } from "@/components/marketing/usps";
import { CardBand } from "@/components/products/product-card";
import { ProductDetail } from "@/components/products/product-detail";
import { ProductInfo } from "@/components/products/product-info";
import { RelatedProducts, RelatedProductsSkeleton } from "@/components/products/related-products";
import { Alert } from "@/components/ui/alert";
import { splitProductText } from "@/lib/product-text";
import { categoryPath, primaryCategory } from "@/lib/woocommerce/category-tree";
import { getCategories, getProductBySlug } from "@/lib/woocommerce/products";

export async function generateMetadata(props: PageProps<"/produkter/[slug]">) {
  const { slug } = await props.params;
  const product = await getProductBySlug(slug);
  if (!product.ok || !product.data) return { title: "Produkt" };
  return {
    title: product.data.name,
    description: product.data.shortDescription.join(" ").slice(0, 160) || undefined,
  };
}

export default function ProductPage(props: PageProps<"/produkter/[slug]">) {
  return (
    <Suspense fallback={<ProductSkeleton />}>
      <ProductContent params={props.params} />
    </Suspense>
  );
}

async function ProductContent({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [result, categories] = await Promise.all([getProductBySlug(slug), getCategories()]);
  if (!result.ok) {
    return (
      <div className="container-shop pt-10">
        <Alert tone="warning">{result.error}</Alert>
      </div>
    );
  }
  const product = result.data;
  if (!product) notFound();

  // File the product under its most specific category, with that category's parents.
  const primary = categories.ok ? primaryCategory(categories.data, product.categories) : undefined;
  const path = primary && categories.ok ? categoryPath(categories.data, primary) : product.categories.slice(0, 1);
  const text = splitProductText(product.description);

  return (
    <>
      <div className="container-shop pt-5 pb-16 sm:pt-8">
        <Breadcrumbs
          className="mb-5"
          items={[{ name: "Alle produkter", href: "/produkter" }, ...path.map((c) => ({ name: c.name, href: `/kategori/${c.slug}` }))]}
        />
        <ProductDetail
          product={product}
          categoryName={path.at(-1)?.name}
          heights={text.heights}
          promises={
            <Suspense fallback={null}>
              <ProductUsps />
            </Suspense>
          }
          details={
            <Suspense fallback={null}>
              <ProductInfo product={product} text={text} />
            </Suspense>
          }
        />
      </div>

      <CardBand className="pt-12">
        <div className="container-shop">
          <Suspense fallback={<RelatedProductsSkeleton />}>
            <RelatedProducts product={product} />
          </Suspense>
        </div>
      </CardBand>
    </>
  );
}

function ProductSkeleton() {
  return (
    <div className="container-shop pt-10">
      <div className="grid animate-pulse gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-14" aria-hidden="true">
        <div className="aspect-square rounded-[var(--radius-card)] bg-black/5" />
        <div className="space-y-4">
          <div className="h-4 w-24 rounded bg-black/5" />
          <div className="h-10 w-3/4 rounded bg-black/5" />
          <div className="h-9 w-32 rounded bg-black/5" />
          <div className="h-24 rounded bg-black/5" />
          <div className="h-14 rounded bg-black/5" />
        </div>
      </div>
    </div>
  );
}
