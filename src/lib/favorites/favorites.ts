/** The customer's favourites: product IDs, newest first, kept in their own browser. */

export const MAX_FAVORITES = 100;

export function parseFavorites(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const ids = value.filter((id): id is number => Number.isInteger(id) && id > 0);
    return [...new Set(ids)].slice(0, MAX_FAVORITES);
  } catch {
    return [];
  }
}

/** Adds the product first, or removes it when it is already a favourite. */
export function toggleFavorite(ids: number[], id: number): number[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [id, ...ids].slice(0, MAX_FAVORITES);
}
