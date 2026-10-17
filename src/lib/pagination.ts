/** Page numbers for product listings (`?side=2`). */

export const MAX_PAGE = 1000;

/** `?side=` value → page number (1 for anything that isn't a sensible page). */
export function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d{1,4}$/.test(raw)) return 1;
  return Math.min(Math.max(Number(raw), 1), MAX_PAGE);
}

/**
 * Which page links to show: always the first and last page and the pages around the
 * current one, with null for a gap ("…"). E.g. page 6 of 40 → 1 … 5 6 7 … 40.
 */
export function pageItems(page: number, totalPages: number, around = 1): (number | null)[] {
  const pages = new Set([1, totalPages]);
  for (let p = page - around; p <= page + around; p++) {
    if (p >= 1 && p <= totalPages) pages.add(p);
  }
  const sorted = [...pages].filter((p) => p >= 1).sort((a, b) => a - b);
  const items: (number | null)[] = [];
  for (const p of sorted) {
    const previous = items.at(-1);
    if (typeof previous === "number" && p - previous === 2) items.push(p - 1);
    else if (typeof previous === "number" && p - previous > 2) items.push(null);
    items.push(p);
  }
  return items;
}
