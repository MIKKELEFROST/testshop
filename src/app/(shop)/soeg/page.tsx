import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment, Suspense } from "react";
import { ThemeTiles } from "@/components/home/tiles";
import { SearchBox } from "@/components/layout/search-box";
import { ProductListing } from "@/components/products/listing";
import { CardBand, ProductGridSkeleton } from "@/components/products/product-card";
import { Alert } from "@/components/ui/alert";
import { merchandising } from "@/config/merchandising";
import { storeConfig } from "@/config/store";
import { parsePage } from "@/lib/pagination";
import { matchingLinks, normalizeQuery, rankProducts, SEARCH_EXAMPLES, searchedOtherWords, searchProducts, type SuggestedLink } from "@/lib/search";
import { getSeasonalProducts } from "@/lib/woocommerce/collections";
import { getCategories, getSearchMatches, parseSort } from "@/lib/woocommerce/products";

// Result pages are not worth indexing.
export const metadata: Metadata = { title: "Søg", robots: { index: false } };

/** Categories and themes shown as chips with the results. */
const LINKS = 6;

export default function SearchPage(props: PageProps<"/soeg">) {
  return (
    <CardBand>
      <div className="container-shop pt-10">
        <h1 className="heading text-[34px] text-ink sm:text-5xl">Søg</h1>
      </div>
      <Suspense
        fallback={
          <div className="container-shop mt-8">
            <ProductGridSkeleton />
          </div>
        }
      >
        <SearchResults searchParams={props.searchParams} />
      </Suspense>
    </CardBand>
  );
}

async function SearchResults({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const q = normalizeQuery(Array.isArray(query.q) ? query.q[0] : query.q);
  const page = parsePage(query.side);
  const sort = parseSort(query.sorter);
  // Somewhere to go when there is nothing (yet): the front page's themes.
  const themes = <ThemeTiles title={merchandising.home.themes.title} collections={merchandising.home.themes.collections} />;

  if (!q) {
    return (
      <>
        <div className="container-shop">
          <SearchBox autoFocus className="mt-6 max-w-xl" />
          <p className="mt-6 text-muted">
            Skriv, hvad du leder efter – fx <Examples />.
          </p>
        </div>
        {themes}
      </>
    );
  }

  // The season's products first (like the category pages), then by WooCommerce's order. That is
  // two reads a search, so other words for a query that finds nothing are first tried with
  // the suggestions' one read (often cached already), and only the one that finds something
  // is read in full.
  const [found, categories] = await Promise.all([
    searchProducts(q, (search) => getSeasonalProducts({ search, page, sort }), { probe: getSearchMatches }),
    getCategories(),
  ]);
  const tree = categories.ok ? categories.data : [];
  if (!found.ok) {
    return (
      <div className="container-shop">
        <SearchBox key={q} defaultValue={q} className="mt-6 max-w-xl" />
        <div className="mt-8">
          <Alert tone="warning">{found.error}</Alert>
        </div>
      </div>
    );
  }

  const { list, searched, fallback } = found.data;
  const links = matchingLinks(q, tree, searched, LINKS);
  if (list.total === 0) {
    return (
      <>
        <div className="container-shop">
          <SearchBox key={q} defaultValue={q} className="mt-6 max-w-xl" />
          <p className="mt-8 text-[17px] text-ink" aria-live="polite">
            Ingen produkter matcher “{q}”.
          </p>
          {links.length > 0 && (
            <>
              <p className="mt-4 text-sm text-muted">Måske finder du det her:</p>
              <LinkChips links={links} className="mt-2" />
            </>
          )}
          <p className="mt-4 text-muted">
            Prøv et andet ord – fx <Examples /> – eller se{" "}
            <Link href="/produkter" className="font-semibold text-ink underline underline-offset-4">
              alle produkter
            </Link>
            .
          </p>
        </div>
        {themes}
      </>
    );
  }
  if (list.products.length === 0 && page > 1) notFound();

  // Within the page: names with the words first. Only for the recommended order; a chosen sorting is kept.
  const products = sort === "anbefalet" ? rankProducts(list.products, searched, tree) : list.products;
  return (
    <div className="container-shop">
      <SearchBox key={q} defaultValue={q} className="mt-6 max-w-xl" />
      <p className="mt-6 text-[15px] text-ink-soft">
        {searchedOtherWords(q, searched) ? (
          <>
            {fallback && <>Ingen produkter matcher “{q}”. </>}
            Viser resultater for <strong className="font-semibold text-ink">“{searched}”</strong>
          </>
        ) : (
          <>
            Resultater for <strong className="font-semibold text-ink">“{q}”</strong>
          </>
        )}
      </p>
      <LinkChips links={links} className="mt-4" />
      <ProductListing list={{ ...list, products }} sort={sort} path="/soeg" params={{ q }} />
    </div>
  );
}

/** The shop's example words, each a search: prinsesse, kat, pirat eller superhelt. */
function Examples() {
  const words = SEARCH_EXAMPLES[storeConfig.season];
  return words.map((word, i) => (
    <Fragment key={word}>
      {i > 0 && (i === words.length - 1 ? " eller " : ", ")}
      <Link href={`/soeg?q=${encodeURIComponent(word)}`} className="font-semibold text-ink underline underline-offset-4">
        {word}
      </Link>
    </Fragment>
  ));
}

/** Categories and themes that fit the search (see matchingLinks). */
function LinkChips({ links, className = "" }: { links: SuggestedLink[]; className?: string }) {
  if (links.length === 0) return null;
  return (
    <nav aria-label="Kategorier og temaer" className={className}>
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {links.map((link) => (
          <li key={link.href} className="shrink-0">
            <Link href={link.href} className="inline-flex h-9 items-center rounded-full border border-line-strong bg-surface px-4 text-sm whitespace-nowrap hover:border-ink">
              {link.label}
              <span className="ml-1.5 text-xs text-muted">{link.kind}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
