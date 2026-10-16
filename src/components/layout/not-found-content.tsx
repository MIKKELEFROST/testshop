import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { collectionHref, findCollection, merchandising, type NavLink } from "@/config/merchandising";
import { SearchBox } from "./search-box";

/**
 * The 404 message, shared by the shop's not-found page and the app-wide one. Often a product
 * that is sold out for good, reached through an old link: so the search and the shop's
 * front page entries (who the costume is for, its themes) instead of a dead end.
 */
export function NotFoundContent() {
  const { audiences, themes } = merchandising.home;
  const themeLinks = themes.collections.flatMap((slug) => {
    const collection = findCollection(slug);
    return collection ? [{ label: collection.title, href: collectionHref(collection) }] : [];
  });
  return (
    <div className="container-shop py-16 text-center sm:py-24">
      <p className="text-sm font-medium text-muted">404</p>
      <h1 className="heading mt-2 text-[34px] text-ink sm:text-5xl">Siden blev ikke fundet</h1>
      <p className="mx-auto mt-3 max-w-xl text-ink-soft">Produktet eller siden findes ikke længere. Søg efter det, du leder efter, eller find det herunder.</p>
      <SearchBox className="mx-auto mt-8 max-w-xl text-left" />
      <LinkChips title={audiences.title} links={audiences.tiles} />
      <LinkChips title={themes.title} links={themeLinks} />
      <div className="mt-10">
        <ButtonLink href="/produkter">Se alle produkter</ButtonLink>
      </div>
    </div>
  );
}

function LinkChips({ title, links }: { title: string; links: NavLink[] }) {
  if (links.length === 0) return null;
  return (
    <nav aria-label={title} className="mt-10">
      <h2 className="font-bold text-ink">{title}</h2>
      <ul className="mt-3 flex flex-wrap justify-center gap-2">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="inline-flex h-9 items-center rounded-full border border-line-strong bg-surface px-4 text-sm whitespace-nowrap hover:border-ink">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
