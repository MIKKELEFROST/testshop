import Link from "next/link";

/** "Alle produkter / Kostumer / Pigekostumer"; the last item is the current page unless it has a link. */
export function Breadcrumbs({ items, className = "" }: { items: { name: string; href?: string }[]; className?: string }) {
  return (
    <nav aria-label="Brødkrummer" className={`text-sm text-muted ${className}`}>
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {items.map((item, index) => (
          <li key={`${item.name}-${index}`} className="flex items-center gap-x-1.5">
            {index > 0 && <span aria-hidden="true">/</span>}
            {item.href ? (
              // 44 px tall to tap on phones, without making the row taller.
              <Link href={item.href} className="-my-3 inline-block py-3 hover:text-ink sm:my-0 sm:py-0">
                {item.name}
              </Link>
            ) : (
              <span className="text-ink" aria-current="page">
                {item.name}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
