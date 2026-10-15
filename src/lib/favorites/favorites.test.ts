import { describe, expect, it } from "vitest";
import { MAX_FAVORITES, parseFavorites, toggleFavorite } from "./favorites";

describe("favourites", () => {
  it("reads only valid product IDs, once each", () => {
    expect(parseFavorites("[3, 1, 3, -2, 1.5, \"7\", 9]")).toEqual([3, 1, 9]);
    expect(parseFavorites("not json")).toEqual([]);
    expect(parseFavorites("{\"a\":1}")).toEqual([]);
    expect(parseFavorites(null)).toEqual([]);
  });

  it("adds a product first and removes it again", () => {
    expect(toggleFavorite([1, 2], 3)).toEqual([3, 1, 2]);
    expect(toggleFavorite([3, 1, 2], 1)).toEqual([3, 2]);
  });

  it("keeps at most MAX_FAVORITES", () => {
    const full = Array.from({ length: MAX_FAVORITES }, (_, i) => i + 1);
    const next = toggleFavorite(full, 999);
    expect(next).toHaveLength(MAX_FAVORITES);
    expect(next[0]).toBe(999);
  });
});
