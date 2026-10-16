import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ProductUsps } from "@/components/marketing/usps";
import { CardBand } from "@/components/products/product-card";
import { ProductDetail } from "@/components/products/product-detail";
import { ProductInfo } from "@/components/products/product-info";
import { RelatedProducts, RelatedProductsSkeleton } from "@/components/products/related-products";
import { Alert } from "@/components/ui/alert";
import { company, isPlaceholder } from "@/config/company";
import { storeConfig } from "@/config/store";
import { homeSeasonFor, homeStoreFor, storeName, storeUrl } from "@/lib/home-store";
import { productDescription } from "@/lib/meta-description";
import { splitProductText } from "@/lib/product-text";
import { breadcrumbData, JsonLd } from "@/lib/seo";
import { categoryPath, primaryCategory } from "@/lib/woocommerce/category-tree";
import { getCategories, getProductBySlug } from "@/lib/woocommerce/products";
import type { Product, ProductCategory } from "@/types/commerce";

export async function generateMetadata(props: PageProps<"/produkter/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const [result, categories] = await Promise.all([getProductBySlug(slug), getCategories()]);
  // WooCommerce can't be read: a plain title. Throwing here (a 5xx for search engines) would be
  // better, but after a failed cached read Next.js 16.4 then never finishes the crawler's response.
  if (!result.ok) return { title: "Produkt" };
  const product = result.data;
  // A product this shop doesn't sell. Search engines get the metadata before the page
  // (next.config.ts htmlLimitedBots), so they get a real 404; visitors get the page streamed.
  if (!product) notFound();
  const tree = categories.ok ? categories.data : [];
  const image = product.images[0];
  return {
    title: product.name,
    description: productDescription(product, { shop: storeConfig.name, season: homeSeasonFor(product.categories, tree) }),
    alternates: { canonical: productUrl(product, tree) },
    openGraph: image ? { images: [{ url: image.src, alt: product.name }] } : undefined,
  };
}

/** The product page's canonical address: on its home shop (lib/home-store.ts), so the shops' copies don't compete. */
function productUrl(product: Product, tree: ProductCategory[]): string {
  return `${storeUrl(homeStoreFor(product.categories, tree))}/produkter/${product.slug}`;
}

/** The shop that sells the product on its canonical page (its home shop), for the structured data. */
function productSeller(product: Product, tree: ProductCategory[]) {
  const home = homeStoreFor(product.categories, tree);
  return { "@type": "Organization", name: storeName(home), url: storeUrl(home) };
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
  const tree = categories.ok ? categories.data : [];
  const crumbs = [{ name: "Forside", href: "/" }, ...path.map((c) => ({ name: c.name, href: `/kategori/${c.slug}` }))];

  return (
    <>
      <div className="container-shop pt-5 pb-16 sm:pt-8">
        <JsonLd data={productData(product, productUrl(product, tree), productSeller(product, tree))} />
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

/**
 * schema.org Product with its price(s), stock and barcode, for search results; `url` is its
 * canonical address and `seller` the shop there.
 */
function productData(product: Product, url: string, seller: Record<string, string>) {
  const availability = (status: string, quantity: number | null) =>
    status === "outofstock" || quantity === 0
      ? "https://schema.org/OutOfStock"
      : status === "onbackorder"
        ? "https://schema.org/BackOrder"
        : "https://schema.org/InStock";
  const offer = (price: string, stock: string) => ({
    "@type": "Offer",
    priceCurrency: storeConfig.currency,
    price: Number(price).toFixed(2),
    availability: stock,
    url,
    itemCondition: "https://schema.org/NewCondition",
  });
  const prices = product.variations.map((v) => v.price).filter((p): p is string => p !== null).map(Number);
  const anyInStock = product.variations.some((v) => availability(v.stockStatus, v.stockQuantity).endsWith("InStock"));
  const variableStock = anyInStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock";
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const offers =
    product.type === "variable" && prices.length > 0
      ? // Every size at the same price is one offer; different prices are a range.
        low === high
        ? offer(String(low), variableStock)
        : {
            "@type": "AggregateOffer",
            priceCurrency: storeConfig.currency,
            lowPrice: low.toFixed(2),
            highPrice: high.toFixed(2),
            offerCount: prices.length,
            availability: variableStock,
            url,
          }
      : product.price
        ? offer(product.price, availability(product.stockStatus, product.stockQuantity))
        : undefined;
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    url,
    sku: product.sku || undefined,
    ...gtinData(product.gtin),
    image: product.images.slice(0, 8).map((i) => i.src),
    description: [...product.shortDescription, ...product.description].join(" ").slice(0, 5000) || undefined,
    brand: { "@type": "Brand", name: "Guirca" },
    category: product.categories[0]?.name,
    ...(offers ? { offers: { ...offers, seller, ...returnPolicyData() } } : {}),
  };
}

/** The barcode as schema.org names it by length (an EAN is a GTIN-13). */
function gtinData(gtin: string): Record<string, string> {
  if (!gtin) return {};
  return { [gtin.length === 13 ? "gtin13" : gtin.length === 8 ? "gtin8" : gtin.length === 12 ? "gtin12" : "gtin14"]: gtin };
}

/**
 * The 30 days' right of return (src/config/usps.ts), once the owner has decided who pays the
 * return shipping (src/config/company.ts); until then none, rather than a guess.
 */
function returnPolicyData() {
  if (isPlaceholder(company.returnShipping)) return {};
  return {
    hasMerchantReturnPolicy: {
      "@type": "MerchantReturnPolicy",
      applicableCountry: storeConfig.defaultCountry,
      returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
      merchantReturnDays: 30,
      returnMethod: "https://schema.org/ReturnByMail",
    },
  };
}
