import Link from "next/link";
import { Suspense } from "react";
import { storeConfig } from "@/config/store";
import { getCategories } from "@/lib/woocommerce/products";
import { CartButton } from "./cart-button";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur supports-[backdrop-filter]:bg-paper/75">
      <div className="bg-action py-2 text-center text-xs font-medium tracking-wide text-white">
        Sikker betaling · Levering i hele Danmark
      </div>
      <div className="container-shop flex h-16 items-center gap-6">
        <Link href="/" className="text-xl font-semibold tracking-tight" aria-label={`${storeConfig.name} – forside`}>
          {storeConfig.name}
        </Link>
        <nav aria-label="Hovedmenu" className="hidden flex-1 items-center gap-6 text-sm md:flex">
          <Link href="/produkter" className="text-ink-soft hover:text-ink">
            Alle produkter
          </Link>
          <Suspense fallback={null}>
            <CategoryLinks />
          </Suspense>
        </nav>
        <div className="ml-auto flex items-center gap-1 md:ml-0">
          <CartButton />
        </div>
      </div>
      <nav aria-label="Kategorier" className="container-shop -mt-1 flex gap-5 overflow-x-auto pb-3 text-sm md:hidden">
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
  return categories.data.slice(0, 6).map((category) => (
    <Link key={category.id} href={`/kategori/${category.slug}`} className="shrink-0 text-ink-soft hover:text-ink">
      {category.name}
    </Link>
  ));
}
