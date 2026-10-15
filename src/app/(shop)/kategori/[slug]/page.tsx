import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { productCount } from "@/lib/format";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { CardBand, ProductGrid, ProductGridSkeleton } from "@/components/products/product-card";
import { Alert } from "@/components/ui/alert";
import { pageHref, Pagination } from "@/components/ui/pagination";
import { parsePage } from "@/lib/pagination";
import { categoryPath, subcategories } from "@/lib/woocommerce/category-tree";
import { getCategories, getProducts } from "@/lib/woocommerce/products";
import type { ProductCategory } from "@/types/commerce";

export async function generateMetadata(props: PageProps<"/kategori/[slug]">) {
  const { slug } = await props.params;
  const categories = await getCategories();
  const category = categories.ok ? categories.data.find((c) => c.slug === slug) : undefined;
  return { title: category?.name ?? "Kategori", description: category?.description || undefined };
}

export default function CategoryPage(props: PageProps<"/kategori/[slug]">) {
  return (
    <CardBand>
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
          <CategoryContent params={props.params} searchParams={props.searchParams} />
        </Suspense>
      </div>
    </CardBand>
  );
}

async function CategoryContent({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const page = parsePage(query.side);
  const categories = await getCategories();
  if (!categories.ok) return <Alert tone="warning">{categories.error}</Alert>;

  const category = categories.data.find((c) => c.slug === slug);
  if (!category) notFound();

  const products = await getProducts({ categoryId: category.id, page });
  if (products.ok && products.data.products.length === 0 && page > 1) notFound();

  const path = categoryPath(categories.data, category);
  const parent = path.length > 1 ? path[path.length - 2] : undefined;
  const children = subcategories(categories.data, category.id);

  return (
    <>
      <Breadcrumbs
        items={[
          { name: "Alle produkter", href: "/produkter" },
          ...path.slice(0, -1).map((c) => ({ name: c.name, href: `/kategori/${c.slug}` })),
          { name: category.name },
        ]}
      />
      <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{category.name}</h1>
      <p className="mt-2 text-sm text-muted">{productCount(category.count)}</p>
      {category.description && <p className="mt-3 max-w-2xl text-muted">{category.description}</p>}

      {children.length > 0 ? (
        <CategoryChips categories={children} />
      ) : (
        parent && (
          <CategoryChips
            categories={subcategories(categories.data, parent.id)}
            current={category.id}
            all={{ name: `Alle i ${parent.name.toLowerCase()}`, href: `/kategori/${parent.slug}` }}
          />
        )
      )}

      <div className="mt-8">
        {products.ok ? <ProductGrid products={products.data.products} /> : <Alert tone="warning">{products.error}</Alert>}
      </div>
      {products.ok && (
        <Pagination page={page} totalPages={products.data.totalPages} href={(p) => pageHref(`/kategori/${category.slug}`, p)} />
      )}
    </>
  );
}

function CategoryChips({
  categories,
  current,
  all,
}: {
  categories: ProductCategory[];
  current?: number;
  all?: { name: string; href: string };
}) {
  const chip = "inline-flex h-9 items-center rounded-full border px-4 text-sm whitespace-nowrap transition-colors";
  return (
    <nav aria-label="Underkategorier" className="mt-6">
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {all && (
          <li className="shrink-0">
            <Link href={all.href} className={`${chip} border-line-strong bg-surface hover:border-ink`}>
              {all.name}
            </Link>
          </li>
        )}
        {categories.map((c) => (
          <li key={c.id} className="shrink-0">
            <Link
              href={`/kategori/${c.slug}`}
              aria-current={c.id === current ? "page" : undefined}
              className={`${chip} ${c.id === current ? "border-ink bg-ink text-white" : "border-line-strong bg-surface hover:border-ink"}`}
            >
              {c.name}
              <span className={`ml-1.5 text-xs ${c.id === current ? "text-white/70" : "text-muted"}`}>{c.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
