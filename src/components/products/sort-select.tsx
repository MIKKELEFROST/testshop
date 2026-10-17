"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { SortKey } from "@/lib/woocommerce/products";

/** "Sortér efter": changes the listing's `sorter` parameter (and goes back to page 1). */
export function SortSelect({ value, options }: { value: SortKey; options: { key: SortKey; label: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      <span className="whitespace-nowrap">Sortér efter</span>
      <select
        value={value}
        onChange={(event) => {
          const next = new URLSearchParams(params.toString());
          next.delete("side");
          if (event.target.value === options[0]?.key) next.delete("sorter");
          else next.set("sorter", event.target.value);
          const search = next.toString();
          router.push(search ? `${pathname}?${search}` : pathname, { scroll: false });
        }}
        // The site's own focus ring (:focus-visible); 44 px tall on phones, a finger's size.
        className="h-11 rounded-[var(--radius-control)] border border-field bg-surface pr-8 pl-3 text-base font-semibold text-ink focus:border-ink sm:h-10 sm:text-sm"
      >
        {options.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
