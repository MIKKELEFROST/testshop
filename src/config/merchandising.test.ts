import { describe, expect, it } from "vitest";
import { merchandisingByStore } from "./merchandising";
import { brands } from "./store";

describe.each(Object.entries(merchandisingByStore))("merchandising for %s", (storeId, shop) => {
  const slugs = shop.collections.map((c) => c.slug);
  const links = [
    ...shop.nav.flatMap((item) => [item.href, ...(item.groups ?? []).flatMap((g) => g.links.map((l) => l.href))]),
    ...shop.home.audiences.tiles.map((t) => t.href),
    ...shop.home.rows.map((r) => r.href),
    shop.home.hero.primary.href,
    shop.home.hero.secondary.href,
  ];

  it("belongs to a known brand", () => {
    expect(brands[storeId]).toBeDefined();
  });

  it("has unique theme pages, each narrowed by categories or themes", () => {
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const collection of shop.collections) {
      expect(collection.categories?.length || collection.themes?.length, collection.slug).toBeTruthy();
      if (collection.alsoIn) expect(collection.alsoInFallbackThemes?.length || collection.themes?.length, collection.slug).toBeTruthy();
    }
  });

  it("only links to theme pages that exist", () => {
    for (const href of links.filter((h) => h.startsWith("/tema/"))) {
      expect(slugs, href).toContain(href.slice("/tema/".length));
    }
    for (const slug of [...shop.home.themes.collections, ...shop.home.rows.map((r) => r.collection)]) {
      expect(slugs, slug).toContain(slug);
    }
  });

  it("links only to the shop's own kinds of pages", () => {
    for (const href of links) expect(href, href).toMatch(/^\/(tema|kategori)\/[a-z0-9-]+$|^\/[a-z0-9-]*$/);
  });
});
