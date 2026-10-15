import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ProductDetail } from "@/components/products/product-detail";
import { Alert } from "@/components/ui/alert";
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
    <div className="container-shop pt-6 sm:pt-10">
      <Suspense fallback={<ProductSkeleton />}>
        <ProductContent params={props.params} />
      </Suspense>
    </div>
  );
}

async function ProductContent({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [result, categories] = await Promise.all([getProductBySlug(slug), getCategories()]);
  if (!result.ok) return <Alert tone="warning">{result.error}</Alert>;
  const product = result.data;
  if (!product) notFound();

  // File the product under its most specific category, with that category's parents.
  const primary = categories.ok ? primaryCategory(categories.data, product.categories) : undefined;
  const path = primary && categories.ok ? categoryPath(categories.data, primary) : product.categories.slice(0, 1);

  return (
    <>
      <Breadcrumbs
        className="mb-6"
        items={[
          { name: "Alle produkter", href: "/produkter" },
          ...path.map((c) => ({ name: c.name, href: `/kategori/${c.slug}` })),
        ]}
      />

      <ProductDetail product={product} categoryName={path.at(-1)?.name} />

      {(product.description.length > 0 || product.safetyInfo) && (
        <section className="mt-16 max-w-3xl border-t border-line pt-10" aria-labelledby="beskrivelse">
          <h2 id="beskrivelse" className="text-xl font-semibold">
            Beskrivelse
          </h2>
          <div className="mt-4 space-y-4 leading-relaxed text-ink-soft">
            {product.description.map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
            {product.safetyInfo && (
              <p>
                <a href={product.safetyInfo} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-ink">
                  Sikkerhedsinformation og advarsler (åbner producentens mærkat)
                </a>
              </p>
            )}
          </div>
        </section>
      )}
    </>
  );
}

function ProductSkeleton() {
  return (
    <div className="grid animate-pulse gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-14" aria-hidden="true">
      <div className="aspect-[4/5] rounded-[var(--radius-card)] bg-black/5" />
      <div className="space-y-4">
        <div className="h-4 w-24 rounded bg-black/5" />
        <div className="h-10 w-3/4 rounded bg-black/5" />
        <div className="h-7 w-32 rounded bg-black/5" />
        <div className="h-24 rounded bg-black/5" />
        <div className="h-14 rounded bg-black/5" />
      </div>
    </div>
  );
}
