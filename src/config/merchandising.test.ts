import { describe, expect, it } from "vitest";
import { collectionHref, merchandisingByStore, shownInNav, themesOverview } from "./merchandising";
import { brands } from "./store";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe.each(Object.entries(merchandisingByStore))("merchandising for %s", (storeId, shop) => {
  const slugs = shop.collections.map((c) => c.slug);
  const navLinks = shop.nav.flatMap((item) => [item.href, ...(item.groups ?? []).flatMap((g) => g.links.map((l) => l.href))]);
  const links = [
    ...navLinks,
    ...shop.home.audiences.tiles.map((t) => t.href),
    ...shop.home.rows.map((r) => r.href),
    shop.home.hero.primary.href,
    shop.home.hero.secondary.href,
    ...shop.collections.map((c) => collectionHref(c)),
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

  it("names a product slug for every chosen tile photo", () => {
    for (const tile of shop.home.audiences.tiles) if (tile.product) expect(tile.product, tile.label).toMatch(SLUG);
    for (const collection of shop.collections) if (collection.tileProduct) expect(collection.tileProduct, collection.slug).toMatch(SLUG);
  });

  it("points a duplicate theme page at a category page", () => {
    for (const collection of shop.collections.filter((c) => c.canonical)) {
      expect(collection.canonical, collection.slug).toMatch(/^\/kategori\/[a-z0-9-]+$/);
      expect(collectionHref(collection)).toBe(collection.canonical);
    }
  });

  it("leads a front page row of such a theme to the same category page as its tile", () => {
    for (const row of shop.home.rows) {
      const collection = shop.collections.find((c) => c.slug === row.collection);
      if (collection?.canonical) expect(row.href, row.title).toBe(collection.canonical);
    }
  });

  it("has a menu item per page, and a link to every theme from the themes overview", () => {
    expect(new Set(shop.nav.map((item) => item.href)).size).toBe(shop.nav.length);
    expect(navLinks).toContain("/tema");
  });

  it("lists every theme page once on /tema, the front page's themes first", () => {
    const sections = themesOverview(shop);
    const listed = sections.flatMap((s) => s.collections.map((c) => c.slug));
    expect([...listed].sort()).toEqual([...slugs].sort());
    expect(sections[0]!.collections.slice(0, shop.home.themes.collections.length).map((c) => c.slug)).toEqual(shop.home.themes.collections);
    for (const section of sections) expect(section.title).toBeTruthy();
  });

  it("keeps hidden and nav-hidden categories out of the menu", () => {
    for (const slug of [...shop.hidden, ...shop.navHidden]) {
      expect(slug).toMatch(SLUG);
      expect(shownInNav(slug, shop), slug).toBe(false);
      expect(navLinks, slug).not.toContain(`/kategori/${slug}`);
      expect(shop.nav.map((item) => item.subcategoriesOf), slug).not.toContain(slug);
    }
    expect(shownInNav("pigekostumer", shop)).toBe(true);
  });
});

describe("the two shops' menus", () => {
  it("keep Halloween and Christmas out of Fastelavn's menu and Christmas out of Halloween's", () => {
    const fastelavn = merchandisingByStore["piece-dk"]!;
    const halloween = merchandisingByStore["halloween-kostumer-dk"]!;
    for (const slug of ["halloweenpynt", "figurer-og-animatronics", "slik-eller-ballade", "julepynt", "blod-og-effekter"]) {
      expect(shownInNav(slug, fastelavn), slug).toBe(false);
    }
    expect(shownInNav("julepynt", halloween)).toBe(false);
    for (const slug of ["halloweenpynt", "figurer-og-animatronics", "blod-og-effekter"]) expect(shownInNav(slug, halloween), slug).toBe(true);
  });
});
