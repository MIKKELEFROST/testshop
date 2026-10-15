import Link from "next/link";
import { Suspense } from "react";
import { storeConfig } from "@/config/store";
import { topLevelCategories } from "@/lib/woocommerce/category-tree";
import { getCategories } from "@/lib/woocommerce/products";
import { CartButton } from "./cart-button";
import { SearchForm, SearchIcon } from "./search-form";

/** Shown in the menu; the rest are reached from "Alle produkter" and the category pages. */
const MENU_CATEGORIES = 8;

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur supports-[backdrop-filter]:bg-paper/75">
      <div className="bg-action py-2 text-center text-xs font-medium tracking-wide text-white">
        Sikker betaling · Levering i hele Danmark
      </div>
      <div className="container-shop flex h-16 items-center gap-4 sm:gap-6">
        <Link href="/" className="shrink-0 text-xl font-semibold tracking-tight" aria-label={`${storeConfig.name} – forside`}>
          {storeConfig.name}
        </Link>
        <SearchForm className="mx-auto hidden w-full max-w-md md:block" />
        <div className="ml-auto flex items-center gap-1 md:ml-0">
          <Link href="/soeg" className="inline-flex size-11 items-center justify-center rounded-full hover:bg-black/5 md:hidden" aria-label="Søg">
            <SearchIcon className="size-6" />
          </Link>
          <CartButton />
        </div>
      </div>
      <nav aria-label="Kategorier" className="container-shop -mt-1 flex gap-5 overflow-x-auto pb-3 text-sm whitespace-nowrap md:gap-7">
        <Link href="/produkter" className="shrink-0 text-ink-soft hover:text-ink">
          Alle produkter
        </Link>
        <Suspense fallback={null}>
          <CategoryLinks />
        </Suspense>
      </nav>
    </header>
  );
}

async function CategoryLinks() {
  const categories = await getCategories();
  if (!categories.ok) return null;
  return topLevelCategories(categories.data)
    .slice(0, MENU_CATEGORIES)
    .map((category) => (
      <Link key={category.id} href={`/kategori/${category.slug}`} className="shrink-0 text-ink-soft hover:text-ink">
        {category.name}
      </Link>
    ));
}
