import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INFO_LINKS } from "@/components/content/info-page";
import { INFO_PAGES, OM_OS, type InfoPage } from "./info-pages";

// Pages that exist under app/(shop) (each information page is its own folder).
const routes = new Set(readdirSync(new URL("../app/(shop)", import.meta.url), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => `/${d.name}`));
const TOKENS = new Set(["firma", "cvr", "adresse", "telefon", "email", "åbningstider", "shop", "fri_fragt", "returadresse", "returfragt", "uafhentede_pakker", "prismatch_dage", "svartid"]);

function texts(page: InfoPage): string[] {
  return [
    page.title,
    page.description,
    page.intro,
    ...page.sections.flatMap((s) => [
      s.heading,
      ...s.blocks.flatMap((b) => (b.type === "p" ? [b.text] : b.type === "table" ? [...b.head, ...b.rows.flat()] : b.items)),
    ]),
  ];
}

const pages = [...INFO_PAGES, ...Object.values(OM_OS)];

function page(slug: string): InfoPage {
  return INFO_PAGES.find((p) => p.slug === slug)!;
}

function section(slug: string, heading: string): string[] {
  const found = page(slug).sections.find((s) => s.heading === heading);
  expect(found, `${slug}: ${heading}`).toBeDefined();
  return texts({ ...page(slug), title: "", description: "", intro: "", sections: [found!] }).filter(Boolean);
}

describe("information pages", () => {
  it("has a page for every link in the footer and side menu, and a route for every page", () => {
    for (const link of INFO_LINKS) {
      expect(routes, link.href).toContain(link.href);
      expect(pages.map((p) => `/${p.slug}`), link.href).toContain(link.href);
    }
  });

  it.each(pages.map((p) => [p.slug, p] as const))("%s uses only known tokens and links to existing pages", (_, page) => {
    for (const text of texts(page)) {
      for (const [, token] of text.matchAll(/\{([^}]+)\}/g)) expect(TOKENS, `${token} in "${text}"`).toContain(token);
      for (const [, , href] of text.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) {
        if (href!.startsWith("/")) expect(routes, href).toContain(href!.split(/[?#]/)[0]);
        else expect(href, href).toMatch(/^(https:|mailto:)/);
      }
      // Owner decisions are tokens (src/config/company.ts), never brackets in the text.
      expect(text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, ""), text).not.toMatch(/\[[^\]]*\]/);
    }
  });

  it("has short descriptions for search results", () => {
    for (const page of pages) expect(page.description.length, page.slug).toBeLessThanOrEqual(160);
  });

  it("has an Om os page for each shop", () => {
    expect(Object.keys(OM_OS).sort()).toEqual(["halloween-kostumer-dk", "piece-dk"]);
  });

  // Forbrugeraftaleloven § 18, stk. 2, nr. 5: only sealed hygiene goods whose seal is broken after delivery.
  it("limits the hygiene exception to sealed goods", () => {
    const exception = section("fortrydelsesret", "Undtagelser: hygiejnevarer");
    expect(exception.join(" ")).toContain("hvis forseglingen er brudt efter levering");
    expect(exception.join(" ")).toContain("Det står på produktsiden");
    expect(exception.join(" ")).not.toContain("emballagen er brudt");
    expect(exception.filter((t) => /^Masker/.test(t))).toEqual([]);
  });
});
