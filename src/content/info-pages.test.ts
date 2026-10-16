import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INFO_LINKS } from "@/components/content/info-page";
import { fillTokens, shownPage } from "@/lib/info-text";
import { INFO_PAGES, OM_OS, SEASON_WORDS, type InfoPage } from "./info-pages";

// Pages that exist under app/(shop) (each information page is its own folder).
const routes = new Set(readdirSync(new URL("../app/(shop)", import.meta.url), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => `/${d.name}`));
const TOKENS = new Set(["firma", "cvr", "adresse", "telefon", "email", "åbningstider", "shop", "fri_fragt", "returadresse", "returfragt", "uafhentede_pakker", "prismatch_dage", "svartid", "højtid", "åben_ild"]);

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

  it("leaves the shop's season to tokens in the shared pages", () => {
    for (const p of INFO_PAGES) for (const text of texts(p)) expect(text, `${p.slug}: ${text}`).not.toMatch(/halloween|fastelavn|græskar/i);
    expect(Object.keys(SEASON_WORDS.fastelavn)).toEqual(Object.keys(SEASON_WORDS.halloween));
    expect(Object.values(SEASON_WORDS.fastelavn).join(" ")).not.toMatch(/halloween|græskar/i);
    expect(Object.values(SEASON_WORDS.halloween).join(" ")).not.toMatch(/fastelavn/i);
  });

  it("promises free shipping to a parcel shop only, and writes the amount without a double period", () => {
    for (const p of pages) {
      for (const text of texts(p)) {
        if (text.includes("{fri_fragt}")) expect(text, text).toMatch(/pakkeshop/i);
        expect(fillTokens(text, { fri_fragt: "599 kr." }), text).not.toContain("..");
        expect(text, text).not.toMatch(/\b1 dags\b/);
      }
    }
  });

  it("states the delivery time like the selling points: same-day dispatch, normally the next weekday, no date", () => {
    const terms = section("handelsbetingelser", "Levering").join(" ");
    expect(terms).toContain("før kl. 19, sender vi din ordre samme dag");
    expect(terms).toContain("normalt pakken hverdagen efter");
    expect(terms).toContain("Vi kan ikke love en bestemt leveringsdato");
    expect(terms).toContain("senest 30 dage");
    const shipping = section("fragt-og-levering", "Lynhurtig 1-dags levering – bestil før kl. 19").join(" ");
    expect(shipping).toContain("normalt hverdagen efter");
    expect(shipping).toContain("Vi kan ikke love en bestemt leveringsdato");
  });

  // Forbrugeraftaleloven § 18, stk. 2, nr. 5: only sealed hygiene goods whose seal is broken after delivery.
  it("limits the hygiene exception to sealed goods", () => {
    const exception = section("fortrydelsesret", "Undtagelser: hygiejnevarer");
    expect(exception.join(" ")).toContain("hvis forseglingen er brudt efter levering");
    expect(exception.join(" ")).toContain("Det står på produktsiden");
    expect(exception.join(" ")).not.toContain("emballagen er brudt");
    expect(exception.filter((t) => /^Masker/.test(t))).toEqual([]);
  });

  it("lists the checkout form kept in sessionStorage in the cookie policy", () => {
    expect(section("cookiepolitik", "Det gemmes i din browser").some((t) => t.includes("sessionStorage"))).toBe(true);
  });

  it("mentions 18+ only as a rule for the products marked so, as they can all be drafts", () => {
    for (const p of pages) {
      for (const text of texts(p).filter((t) => t?.includes("18+"))) expect(text, p.slug).toMatch(/^(Varer|Hvad betyder 18\+)/);
    }
  });

  it("tells what Trustpilot's TrustBoxes do only when the shop shows them", () => {
    const shown = (slug: string, trustbox: boolean) => texts(shownPage(page(slug), trustbox)).join(" ");
    for (const slug of ["cookiepolitik", "privatlivspolitik"]) {
      expect(shown(slug, false), slug).not.toContain("Trustpilot");
      expect(shown(slug, true), slug).toContain("IP-adresse");
      expect(shown(slug, true), slug).toContain("https://legal.trustpilot.com/for-reviewers/end-user-privacy-terms");
    }
    const cookies = shown("cookiepolitik", true);
    expect(cookies).toContain("Vores bedømmelse fra Trustpilot");
    expect(cookies).toContain("TrustBoxene sætter ingen cookies og gemmer intet i din browser");
    // With TrustBoxes the page no longer says that nothing needs consent.
    expect(cookies).not.toContain("Derfor skal vi ikke bede om dit samtykke");
    expect(shown("cookiepolitik", false)).toContain("Derfor skal vi ikke bede om dit samtykke");
    // Every page mentions Trustpilot only in TrustBox-only text.
    for (const p of pages) expect(texts(shownPage(p, false)).join(" "), p.slug).not.toContain("Trustpilot");
  });
});
