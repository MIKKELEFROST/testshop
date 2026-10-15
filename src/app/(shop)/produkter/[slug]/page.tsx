import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ProductUsps } from "@/components/marketing/usps";
import { CardBand } from "@/components/products/product-card";
import { ProductDetail } from "@/components/products/product-detail";
import { ProductInfo } from "@/components/products/product-info";
import { RelatedProducts, RelatedProductsSkeleton } from "@/components/products/related-products";
import { Alert } from "@/components/ui/alert";
import { storeConfig } from "@/config/store";
import { splitProductText } from "@/lib/product-text";
import { absoluteUrl, breadcrumbData, JsonLd } from "@/lib/seo";
import { categoryPath, primaryCategory } from "@/lib/woocommerce/category-tree";
import { getCategories, getProductBySlug } from "@/lib/woocommerce/products";
import type { Product } from "@/types/commerce";

export async function generateMetadata(props: PageProps<"/produkter/[slug]">) {
  const { slug } = await props.params;
  const product = await getProductBySlug(slug);
  if (!product.ok || !product.data) return { title: "Produkt" };
  const image = product.data.images[0];
  return {
    title: product.data.name,
    description: product.data.shortDescription.join(" ").slice(0, 160) || undefined,
    alternates: { canonical: `/produkter/${product.data.slug}` },
    openGraph: image ? { images: [{ url: image.src, alt: product.data.name }] } : undefined,
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
  const crumbs = [{ name: "Forside", href: "/" }, ...path.map((c) => ({ name: c.name, href: `/kategori/${c.slug}` }))];

  return (
    <>
      <div className="container-shop pt-5 pb-16 sm:pt-8">
        <JsonLd data={productData(product)} />
        <JsonLd data={breadcrumbData([...crumbs, { name: product.name, href: `/produkter/${product.slug}` }])} />
        <Breadcrumbs className="mb-5" items={crumbs} />
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

/** schema.org Product with its price(s) and stock, for search results. */
function productData(product: Product) {
  const url = absoluteUrl(`/produkter/${product.slug}`);
  const availability = (status: string, quantity: number | null) =>
    status === "outofstock" || quantity === 0
      ? "https://schema.org/OutOfStock"
      : status === "onbackorder"
        ? "https://schema.org/BackOrder"
        : "https://schema.org/InStock";
  const prices = product.variations.map((v) => v.price).filter((p): p is string => p !== null);
  const offers =
    product.type === "variable" && prices.length > 0
      ? {
          "@type": "AggregateOffer",
          priceCurrency: storeConfig.currency,
          lowPrice: Math.min(...prices.map(Number)).toFixed(2),
          highPrice: Math.max(...prices.map(Number)).toFixed(2),
          offerCount: prices.length,
          availability: product.variations.some((v) => availability(v.stockStatus, v.stockQuantity).endsWith("InStock"))
            ? "https://schema.org/InStock"
            : "https://schema.org/OutOfStock",
          url,
        }
      : product.price
        ? { "@type": "Offer", priceCurrency: storeConfig.currency, price: Number(product.price).toFixed(2), availability: availability(product.stockStatus, product.stockQuantity), url, itemCondition: "https://schema.org/NewCondition" }
        : undefined;
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    url,
    sku: product.sku || undefined,
    image: product.images.slice(0, 8).map((i) => i.src),
    description: [...product.shortDescription, ...product.description].join(" ").slice(0, 5000) || undefined,
    brand: { "@type": "Brand", name: "Guirca" },
    category: product.categories[0]?.name,
    ...(offers ? { offers: { ...offers, seller: { "@type": "Organization", name: storeConfig.name } } } : {}),
  };
}
