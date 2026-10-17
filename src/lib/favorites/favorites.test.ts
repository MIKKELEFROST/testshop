import { describe, expect, it } from "vitest";
import { MAX_FAVORITES, favoritesRequest, parseFavorites, toggleFavorite } from "./favorites";

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

  it("asks for products again only when a favourite is not in the last answer", () => {
    const answered = new Set([3, 1, 2]);
    expect(favoritesRequest([3, 1, 2], new Set(), "")).toBe("3,1,2");
    // Removing one keeps the last answer: no reload.
    expect(favoritesRequest([3, 2], answered, "3,1,2")).toBe("3,1,2");
    expect(favoritesRequest([], answered, "3,1,2")).toBe("3,1,2");
    // A new one (e.g. from another tab) needs a request.
    expect(favoritesRequest([4, 3, 2], answered, "3,1,2")).toBe("4,3,2");
  });
});
