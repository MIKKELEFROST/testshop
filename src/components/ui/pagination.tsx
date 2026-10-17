import Link from "next/link";
import { pageItems } from "@/lib/pagination";

/** Previous / page numbers / next. `href(page)` builds each page's link. */
export function Pagination({ page, totalPages, href }: { page: number; totalPages: number; href: (page: number) => string }) {
  if (totalPages <= 1) return null;
  const base = "flex h-10 min-w-10 items-center justify-center rounded-[var(--radius-control)] px-3 text-sm";
  return (
    <nav aria-label="Sider" className="mt-12 flex flex-wrap items-center justify-center gap-1.5">
      {page > 1 ? (
        <Link href={href(page - 1)} rel="prev" className={`${base} border border-line-strong hover:border-ink`}>
          ← Forrige
        </Link>
      ) : (
        <span className={`${base} border border-line text-muted`} aria-hidden="true">
          ← Forrige
        </span>
      )}
      <ul className="flex flex-wrap items-center gap-1.5">
        {pageItems(page, totalPages).map((item, index) =>
          item === null ? (
            <li key={`gap-${index}`} className="px-1 text-muted" aria-hidden="true">
              …
            </li>
          ) : (
            <li key={item}>
              {item === page ? (
                <span aria-current="page" className={`${base} bg-ink font-medium text-white`}>
                  {item}
                </span>
              ) : (
                <Link href={href(item)} aria-label={`Side ${item}`} className={`${base} border border-line-strong hover:border-ink`}>
                  {item}
                </Link>
              )}
            </li>
          ),
        )}
      </ul>
      {page < totalPages ? (
        <Link href={href(page + 1)} rel="next" className={`${base} border border-line-strong hover:border-ink`}>
          Næste →
        </Link>
      ) : (
        <span className={`${base} border border-line text-muted`} aria-hidden="true">
          Næste →
        </span>
      )}
    </nav>
  );
}

/** "/produkter" + page 2 → "/produkter?side=2" (page 1 has no parameter). */
export function pageHref(path: string, page: number, params: Record<string, string> = {}): string {
  const query = new URLSearchParams(params);
  if (page > 1) query.set("side", String(page));
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}
