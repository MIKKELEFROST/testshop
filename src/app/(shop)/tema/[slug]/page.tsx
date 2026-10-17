import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ProductListing } from "@/components/products/listing";
import { CardBand, ProductGridSkeleton } from "@/components/products/product-card";
import { CatalogRetry } from "@/components/ui/catalog-retry";
import { pageHref } from "@/components/ui/pagination";
import { findCollection, merchandising } from "@/config/merchandising";
import { activeFilterCount, parseFilters } from "@/lib/listing-filters";
import { pageDescription } from "@/lib/meta-description";
import { parsePage } from "@/lib/pagination";
import { breadcrumbData, JsonLd, openGraphFor } from "@/lib/seo";
import { getCollectionProducts, getCollectionScope } from "@/lib/woocommerce/collections";
import { filteredListing, getFilterOptions, resolveFilters } from "@/lib/woocommerce/filters";
import { parseSort } from "@/lib/woocommerce/products";

/** A theme page (src/config/merchandising.ts): e.g. "Prinsesser og prinser" or "Halloweenkostumer til damer". */

export function generateStaticParams() {
  return merchandising.collections.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata(props: PageProps<"/tema/[slug]">): Promise<Metadata> {
  const [{ slug }, query] = await Promise.all([props.params, props.searchParams]);
  const collection = findCollection(slug);
  if (!collection) notFound();
  // As on category pages, search engines get the metadata first: a 404 for an unknown theme
  // or a page past the last one.
  const page = parsePage(query.side);
  const chosen = parseFilters(query);
  const filters = await resolveFilters(chosen);
  const result = await filteredListing(filters, (filtered) => getCollectionProducts(slug, { page, sort: parseSort(query.sorter), ...filtered }));
  if (result === null) notFound();
  if (result.ok && result.data.products.length === 0 && page > 1) notFound();
  const canonical = collection.canonical ?? pageHref(`/tema/${collection.slug}`, page);
  return {
    title: page > 1 ? `${collection.title} – side ${page}` : collection.title,
    description: pageDescription(collection.intro, page),
    alternates: { canonical },
    openGraph: openGraphFor(canonical),
    // A filtered view (any filter in the address, applied or not) is not a page of its own for
    // search engines (its links are followed), and a page whose products couldn't be read is
    // not one to show in search results.
    robots: activeFilterCount(chosen) > 0 || !result.ok ? { index: false, follow: true } : undefined,
  };
}

export default function ThemePage(props: PageProps<"/tema/[slug]">) {
  return (
    <CardBand>
      <div className="container-shop pt-8 sm:pt-10">
        <Suspense
          fallback={
            <>
              <div className="h-10 w-64 animate-pulse rounded bg-black/5" />
              <div className="mt-10">
                <ProductGridSkeleton />
              </div>
            </>
          }
        >
          <ThemeContent params={props.params} searchParams={props.searchParams} />
        </Suspense>
      </div>
    </CardBand>
  );
}

async function ThemeContent({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const collection = findCollection(slug);
  if (!collection) notFound();
  const page = parsePage(query.side);
  const sort = parseSort(query.sorter);
  const filters = await resolveFilters(parseFilters(query));
  const [result, options] = await Promise.all([
    filteredListing(filters, (filtered) => getCollectionProducts(slug, { page, sort, ...filtered })),
    getCollectionScope(slug).then((scope) => getFilterOptions(scope, filters.selection)),
  ]);
  if (result === null) notFound();
  if (result.ok && result.data.products.length === 0 && page > 1) notFound();

  // Other themes to explore: the front page's, then the rest.
  const others = [...new Set([...merchandising.home.themes.collections, ...merchandising.collections.map((c) => c.slug)])]
    .filter((s) => s !== slug)
    .map((s) => findCollection(s)!)
    .filter((c) => c.themes?.length)
    .slice(0, 10);

  return (
    <>
      <JsonLd
        data={breadcrumbData([
          { name: "Forside", href: "/" },
          { name: "Temaer", href: "/tema" },
          { name: collection.title, href: `/tema/${collection.slug}` },
        ])}
      />
      <Breadcrumbs items={[{ name: "Forside", href: "/" }, { name: "Temaer", href: "/tema" }, { name: collection.title }]} />
      <h1 className="heading mt-2 text-[34px] text-ink sm:text-5xl">{collection.title}</h1>
      <p className="mt-3 max-w-2xl text-[17px] leading-relaxed text-ink-soft">{collection.intro}</p>
      {others.length > 0 && (
        <nav aria-label="Andre temaer" className="mt-6">
          <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            {others.map((c) => (
              <li key={c.slug} className="shrink-0">
                <Link href={`/tema/${c.slug}`} className="inline-flex h-9 items-center rounded-full border border-line-strong bg-surface px-4 text-sm whitespace-nowrap hover:border-ink">
                  {c.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {result.ok ? (
        <ProductListing list={result.data} sort={sort} path={`/tema/${slug}`} filters={{ options, selection: filters.selection }} />
      ) : (
        <div className="mt-8">
          <CatalogRetry loading="Vi henter varerne …" message={result.error} />
        </div>
      )}
    </>
  );
}
