import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { NotFoundContent } from "@/components/layout/not-found-content";
import { CardBand, ProductGridSkeleton } from "@/components/products/product-card";
import { CatalogRetry } from "@/components/ui/catalog-retry";
import { pageHref } from "@/components/ui/pagination";
import { ProductListing } from "@/components/products/listing";
import { ADULT_CATEGORY_SLUGS } from "@/config/catalog";
import { merchandising, shownInNav } from "@/config/merchandising";
import { storeConfig } from "@/config/store";
import { categoryHomeStore, storeUrl } from "@/lib/home-store";
import { activeFilterCount, parseFilters } from "@/lib/listing-filters";
import { categoryDescription, pageDescription } from "@/lib/meta-description";
import { parsePage } from "@/lib/pagination";
import { breadcrumbData, JsonLd, openGraphFor } from "@/lib/seo";
import { categoryPath, subcategories } from "@/lib/woocommerce/category-tree";
import { getSeasonalProducts } from "@/lib/woocommerce/collections";
import { filteredListing, getFilterOptions, resolveFilters } from "@/lib/woocommerce/filters";
import { getCategories, parseSort, type ProductFilters, type SortKey } from "@/lib/woocommerce/products";
import type { ProductCategory } from "@/types/commerce";

export async function generateMetadata(props: PageProps<"/kategori/[slug]">): Promise<Metadata> {
  const [{ slug }, query] = await Promise.all([props.params, props.searchParams]);
  const chosen = parseFilters(query);
  const [categories, filters] = await Promise.all([getCategories(), resolveFilters(chosen)]);
  // Without WooCommerce, a plain title, kept out of search results (see the product page).
  if (!categories.ok) return { title: "Kategori", robots: { index: false, follow: true } };
  // An unknown category or a page past the last one. Search engines get the metadata before
  // the page (next.config.ts htmlLimitedBots), so they get a real 404.
  const category = categories.data.find((c) => c.slug === slug);
  if (!category) notFound();
  const page = parsePage(query.side);
  const products = await filteredListing(filters, (filtered) => categoryProducts(category, page, parseSort(query.sorter), filtered));
  if (products.ok && products.data.products.length === 0 && page > 1) notFound();
  // Each page of the listing is its own page (without the sorting). A category this shop
  // hides, whose home is another shop, points there (e.g. Halloween in the Fastelavn shop).
  const canonical = `${storeUrl(categoryHomeStore(category, categories.data))}${pageHref(`/kategori/${category.slug}`, page)}`;
  return {
    title: page > 1 ? `${category.name} – side ${page}` : category.name,
    description: pageDescription(merchandising.categoryIntros[category.slug] || category.description || categoryDescription(category, storeConfig.name), page),
    alternates: { canonical },
    openGraph: openGraphFor(canonical),
    // A filtered view (any filter in the address, applied or not) is not a page of its own for
    // search engines (its links are followed), and a page whose products couldn't be read is
    // not one to show in search results.
    robots: activeFilterCount(chosen) > 0 || !products.ok ? { index: false, follow: true } : undefined,
  };
}

/** A page of the category's products, the season's first (see getSeasonalProducts). */
function categoryProducts(category: ProductCategory, page: number, sort: SortKey, filters: ProductFilters) {
  return getSeasonalProducts({ categoryIds: [category.id], page, sort, ...filters });
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
  const [categories, filters] = await Promise.all([getCategories(), resolveFilters(parseFilters(query))]);
  if (!categories.ok) return <CatalogRetry loading="Vi henter varerne …" message={categories.error} />;

  // generateMetadata has called notFound() for these already (see there): a second notFound()
  // here added a second "noindex" to the page.
  const category = categories.data.find((c) => c.slug === slug);
  if (!category) return <NotFoundContent />;

  const [products, options] = await Promise.all([
    filteredListing(filters, (filtered) => categoryProducts(category, page, sort, filtered)),
    getFilterOptions({ categoryIds: [category.id] }, filters.selection),
  ]);
  if (products.ok && products.data.products.length === 0 && page > 1) return <NotFoundContent />;

  const path = categoryPath(categories.data, category);
  const parent = path.length > 1 ? path[path.length - 2] : undefined;
  // Chips without the categories the shop keeps out of its menu (e.g. Halloweenpynt for Fastelavn), except this one.
  const children = subcategories(categories.data, category.id).filter((c) => shownInNav(c.slug));
  const siblings = parent ? subcategories(categories.data, parent.id).filter((c) => c.id === category.id || shownInNav(c.slug)) : [];
  const intro = merchandising.categoryIntros[category.slug] ?? category.description;
  const crumbs = [{ name: "Forside", href: "/" }, ...path.slice(0, -1).map((c) => ({ name: c.name, href: `/kategori/${c.slug}` }))];

  return (
    <>
      {/* The page itself is the last crumb, without an address: search engines take its canonical one (maybe the other shop's). */}
      <JsonLd data={breadcrumbData([...crumbs, { name: category.name }])} />
      <Breadcrumbs items={[...crumbs, { name: category.name }]} />
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
            categories={siblings}
            current={category.id}
            all={{ name: `Alle i ${parent.name.toLowerCase()}`, href: `/kategori/${parent.slug}` }}
          />
        )
      )}

      {products.ok ? (
        <ProductListing list={products.data} sort={sort} path={`/kategori/${category.slug}`} filters={{ options, selection: filters.selection }} />
      ) : (
        <div className="mt-8">
          <CatalogRetry loading="Vi henter varerne …" message={products.error} />
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
  // 44 px tall on phones, a finger's size.
  const chip = "inline-flex h-11 items-center rounded-full border px-4 text-sm whitespace-nowrap transition-colors sm:h-9";
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
