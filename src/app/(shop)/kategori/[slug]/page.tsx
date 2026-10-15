import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { CardBand, ProductGridSkeleton } from "@/components/products/product-card";
import { Alert } from "@/components/ui/alert";
import { ProductListing } from "@/components/products/listing";
import { ADULT_CATEGORY_SLUGS } from "@/config/catalog";
import { merchandising } from "@/config/merchandising";
import { parsePage } from "@/lib/pagination";
import { categoryPath, subcategories } from "@/lib/woocommerce/category-tree";
import { getSeasonalProducts } from "@/lib/woocommerce/collections";
import { getCategories, parseSort } from "@/lib/woocommerce/products";
import type { ProductCategory } from "@/types/commerce";

export async function generateMetadata(props: PageProps<"/kategori/[slug]">) {
  const { slug } = await props.params;
  const categories = await getCategories();
  const category = categories.ok ? categories.data.find((c) => c.slug === slug) : undefined;
  if (!category) return { title: "Kategori" };
  return {
    title: category.name,
    description: merchandising.categoryIntros[category.slug] ?? (category.description || undefined),
    alternates: { canonical: `/kategori/${category.slug}` },
  };
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
  const sort = parseSort(query.sorter);
  const categories = await getCategories();
  if (!categories.ok) return <Alert tone="warning">{categories.error}</Alert>;

  const category = categories.data.find((c) => c.slug === slug);
  if (!category) notFound();

  const products = await getSeasonalProducts({ categoryIds: [category.id], page, sort });
  if (products.ok && products.data.products.length === 0 && page > 1) notFound();

  const path = categoryPath(categories.data, category);
  const parent = path.length > 1 ? path[path.length - 2] : undefined;
  const children = subcategories(categories.data, category.id);
  const intro = merchandising.categoryIntros[category.slug] ?? category.description;

  return (
    <>
      <Breadcrumbs
        items={[
          { name: "Forside", href: "/" },
          ...path.slice(0, -1).map((c) => ({ name: c.name, href: `/kategori/${c.slug}` })),
          { name: category.name },
        ]}
      />
      <h1 className="heading mt-2 text-[34px] text-ink sm:text-5xl">{category.name}</h1>
      {intro && <p className="mt-3 max-w-2xl text-[17px] leading-relaxed text-ink-soft">{intro}</p>}
      {ADULT_CATEGORY_SLUGS.includes(category.slug) && (
        <p className="mt-4 inline-flex items-center gap-2 rounded-lg bg-ink px-3 py-2 text-sm font-semibold text-white">
          <span className="rounded bg-white px-1.5 text-xs font-extrabold text-ink">18+</span>
          Kun for voksne. Ved at handle her bekræfter du, at du er fyldt 18 år.
        </p>
      )}

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

      {products.ok ? (
        <ProductListing list={products.data} sort={sort} path={`/kategori/${category.slug}`} />
      ) : (
        <div className="mt-8">
          <Alert tone="warning">{products.error}</Alert>
        </div>
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
