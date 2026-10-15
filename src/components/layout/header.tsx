import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/brand/logo";
import { UspBar, UspBarItems } from "@/components/marketing/usps";
import { merchandising, type NavLink } from "@/config/merchandising";
import { storeConfig } from "@/config/store";
import { resolveTexts, USP_BAR } from "@/config/usps";
import { subcategories } from "@/lib/woocommerce/category-tree";
import { getCategories } from "@/lib/woocommerce/products";
import { CartButton } from "./cart-button";
import { FavoritesLink } from "./favorites-link";
import { DesktopNav, MobileMenu, type MenuItem } from "./nav-menu";
import { SearchBox } from "./search-box";
import { SearchIcon } from "./search-icon";

/** Links after the menu items (right-aligned on large screens, at the bottom of the phone menu). */
const EXTRA_LINKS: NavLink[] = [
  { label: "Alle produkter", href: "/produkter" },
  { label: "Kundeservice", href: "/kontakt" },
];

/**
 * The bar of promises, then the sticky header: logo, search with suggestions, favourites and
 * cart, and the shop's own menu (src/config/merchandising.ts) with dropdowns. Its colours are
 * the brand's "chrome" (dark for Halloweenkostumer.dk).
 */
export function Header() {
  return (
    <>
      <div className="bg-bar text-on-bar">
        <Suspense fallback={<UspBarItems texts={resolveTexts(USP_BAR, null)} />}>
          <UspBar />
        </Suspense>
      </div>
      <header className="sticky top-0 z-40 bg-chrome text-chrome-ink shadow-[0_1px_0_var(--color-chrome-line),0_6px_16px_-12px_rgb(0_0_0/0.25)]">
        {storeConfig.season === "fastelavn" && <ConfettiStripe />}
        <div className="container-shop flex h-16 items-center gap-2 sm:gap-5 lg:h-[76px]">
          <Suspense fallback={<span className="-ml-2 size-11 lg:hidden" />}>
            <Menus kind="mobile" />
          </Suspense>
          <Link href="/" className="shrink-0" aria-label={`${storeConfig.name} – forside`}>
            <Logo />
          </Link>
          <SearchBox className="mx-auto hidden w-full max-w-xl md:block" />
          <div className="ml-auto flex items-center md:ml-0">
            <Link href="/soeg" className="inline-flex size-11 items-center justify-center rounded-full hover:bg-chrome-ink/10 md:hidden" aria-label="Søg">
              <SearchIcon className="size-6" />
            </Link>
            <FavoritesLink />
            <CartButton />
          </div>
        </div>
        <Suspense fallback={<div className="hidden h-12 border-t border-chrome-line lg:block" />}>
          <Menus kind="desktop" />
        </Suspense>
      </header>
    </>
  );
}

async function Menus({ kind }: { kind: "desktop" | "mobile" }) {
  const items = await menuItems();
  return kind === "desktop" ? <DesktopNav items={items} extra={EXTRA_LINKS} /> : <MobileMenu items={items} extra={EXTRA_LINKS} />;
}

/** The shop's menu with the subcategories filled in from WooCommerce (only those with products). */
async function menuItems(): Promise<MenuItem[]> {
  const categories = await getCategories();
  const tree = categories.ok ? categories.data : [];
  return merchandising.nav.map((item) => {
    if (item.groups) return { label: item.label, href: item.href, groups: item.groups };
    const parent = item.subcategoriesOf ? tree.find((c) => c.slug === item.subcategoriesOf) : undefined;
    const children = parent ? subcategories(tree, parent.id) : [];
    return {
      label: item.label,
      href: item.href,
      groups: children.length > 0 ? [{ title: parent!.name, links: children.map((c) => ({ label: c.name, href: `/kategori/${c.slug}` })) }] : [],
    };
  });
}

/** Fastelavn's mark: a thin stripe of confetti colours along the top of the header. */
function ConfettiStripe() {
  return (
    <div
      aria-hidden="true"
      className="h-1"
      style={{ background: "linear-gradient(90deg,#e8336f 0 20%,#ffd84d 20% 40%,#18b6a8 40% 60%,#2446c8 60% 80%,#ff8a3d 80% 100%)" }}
    />
  );
}
