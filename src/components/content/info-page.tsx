import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { company } from "@/config/company";
import { storeConfig } from "@/config/store";
import { formatThreshold } from "@/config/usps";
import { INFO_PAGES, OM_OS, type InfoBlock, type InfoPage } from "@/content/info-pages";
import { fillTokens, parseText, safeHref } from "@/lib/info-text";
import { JsonLd, plainText } from "@/lib/seo";
import { getFreeShippingFrom } from "@/lib/woocommerce/shipping";

/** The information and legal pages, with the company's and the shop's details filled in. */

export function findInfoPage(slug: string): InfoPage | undefined {
  if (slug === "om-os") return OM_OS[storeConfig.id] ?? Object.values(OM_OS)[0];
  return INFO_PAGES.find((p) => p.slug === slug);
}

async function tokenValues(): Promise<Record<string, string>> {
  const freeFrom = await getFreeShippingFrom();
  return {
    firma: company.name,
    cvr: company.cvr,
    adresse: company.address,
    telefon: company.phone,
    email: storeConfig.supportEmail,
    åbningstider: company.openingHours,
    returadresse: company.returnAddress,
    returfragt: company.returnShipping,
    uafhentede_pakker: company.unclaimedParcels,
    prismatch_dage: company.priceMatchDays,
    svartid: company.answerTime,
    shop: storeConfig.name,
    fri_fragt: freeFrom ? formatThreshold(freeFrom) : "et vist beløb",
  };
}

export async function infoMetadata(slug: string): Promise<Metadata> {
  const page = findInfoPage(slug);
  if (!page) return {};
  const values = await tokenValues();
  return { title: fillTokens(page.title, values), description: fillTokens(page.description, values), alternates: { canonical: `/${slug}` } };
}

export async function InfoPageView({ slug }: { slug: string }) {
  const page = findInfoPage(slug)!;
  const values = await tokenValues();
  const fill = (text: string) => fillTokens(text, values);
  return (
    <div className="container-shop pt-8 pb-8 sm:pt-10">
      {slug === "faq" && <JsonLd data={faqData(page, fill)} />}
      <Breadcrumbs items={[{ name: "Forside", href: "/" }, { name: fill(page.title) }]} />
      {/* grid-cols-1 and min-w-0: a wide table scrolls in its own box instead of widening the page on phones. */}
      <div className="mt-2 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-16">
        <article className="min-w-0 max-w-3xl">
          <h1 className="heading text-[34px] text-ink sm:text-5xl">{fill(page.title)}</h1>
          <p className="mt-4 text-lg leading-relaxed text-ink-soft">
            <RichText text={fill(page.intro)} />
          </p>
          {page.sections.map((section) => (
            <section key={section.heading} className="mt-10">
              <h2 className="text-xl font-extrabold tracking-tight text-ink sm:text-2xl">{fill(section.heading)}</h2>
              <div className="mt-3 space-y-4 text-[16px] leading-relaxed text-ink-soft">
                {section.blocks.map((block, i) => (
                  <Block key={i} block={block} fill={fill} />
                ))}
              </div>
            </section>
          ))}
        </article>
        <aside className="lg:pt-20">
          <nav aria-label="Kundeservice" className="rounded-2xl bg-surface p-5 ring-1 ring-line lg:sticky lg:top-40">
            <p className="text-xs font-bold tracking-[0.12em] text-muted uppercase">Kundeservice</p>
            <ul className="mt-3 space-y-1">
              {INFO_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={link.href === `/${slug}` ? "page" : undefined}
                    className="-mx-2 block rounded-md px-2 py-1.5 text-[15px] text-ink-soft hover:bg-tint hover:text-ink aria-[current=page]:bg-tint aria-[current=page]:font-bold aria-[current=page]:text-ink"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-5 border-t border-line pt-4 text-sm text-muted">
              Skriv til os på{" "}
              <a href={`mailto:${storeConfig.supportEmail}`} className="font-semibold break-all text-accent underline underline-offset-2">
                {storeConfig.supportEmail}
              </a>
            </p>
          </nav>
        </aside>
      </div>
    </div>
  );
}

/** The pages in the order the footer and the side menu list them. */
export const INFO_LINKS = [
  { label: "Kontakt", href: "/kontakt" },
  { label: "Ofte stillede spørgsmål", href: "/faq" },
  { label: "Fragt og levering", href: "/fragt-og-levering" },
  { label: "Returret og fortrydelse", href: "/fortrydelsesret" },
  { label: "Størrelsesguide", href: "/stoerrelsesguide" },
  { label: "100% prismatch", href: "/prismatch" },
  { label: "Handelsbetingelser", href: "/handelsbetingelser" },
  { label: "Privatlivspolitik", href: "/privatlivspolitik" },
  { label: "Cookiepolitik", href: "/cookiepolitik" },
  { label: "Om os", href: "/om-os" },
];

function Block({ block, fill }: { block: InfoBlock; fill: (text: string) => string }) {
  switch (block.type) {
    case "p":
      return (
        <p>
          <RichText text={fill(block.text)} />
        </p>
      );
    case "list":
    case "steps": {
      const List = block.type === "steps" ? "ol" : "ul";
      return (
        <List className={`space-y-1.5 pl-5 ${block.type === "steps" ? "list-decimal" : "list-disc"} marker:text-muted`}>
          {block.items.map((item, i) => (
            <li key={i} className="pl-1">
              <RichText text={fill(item)} />
            </li>
          ))}
        </List>
      );
    }
    case "table":
      return (
        <div className="overflow-x-auto rounded-xl ring-1 ring-line">
          <table className="w-full min-w-[480px] border-collapse bg-surface text-left text-[15px]">
            <thead className="bg-tint text-ink">
              <tr>
                {block.head.map((cell, i) => (
                  <th key={i} scope="col" className="px-4 py-2.5 font-bold">
                    {fill(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-t border-line">
                  {row.map((cell, c) => (
                    <td key={c} className="px-4 py-2.5 align-top">
                      <RichText text={fill(cell)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

function RichText({ text }: { text: string }) {
  return parseText(text).map((part, i) => {
    if (part.kind === "text") return part.text;
    if (part.kind === "placeholder") {
      // Still to be filled in by the owner (src/config/company.ts): impossible to miss.
      return (
        <mark key={i} className="rounded bg-yellow-200 px-1 text-ink">
          {part.text}
        </mark>
      );
    }
    const href = safeHref(part.href);
    if (!href) return part.text;
    return href.startsWith("/") ? (
      <Link key={i} href={href} className="font-semibold text-accent underline underline-offset-2">
        {part.text}
      </Link>
    ) : (
      <a key={i} href={href} className="font-semibold text-accent underline underline-offset-2" {...(href.startsWith("https:") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
        {part.text}
      </a>
    );
  });
}

/** schema.org FAQPage: each section is a question, its paragraphs and lists the answer. */
function faqData(page: InfoPage, fill: (text: string) => string) {
  const answer = (blocks: InfoBlock[]) =>
    blocks
      .flatMap((b) => (b.type === "p" ? [b.text] : b.type === "table" ? b.rows.map((r) => r.join(" ")) : b.items))
      .map((t) => plainText(fill(t)))
      .join(" ");
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: page.sections.map((s) => ({ "@type": "Question", name: fill(s.heading), acceptedAnswer: { "@type": "Answer", text: answer(s.blocks) } })),
  };
}
