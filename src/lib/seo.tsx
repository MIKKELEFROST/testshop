import { company } from "@/config/company";
import { storeConfig } from "@/config/store";

/** Structured data (schema.org JSON-LD) and absolute URLs for search engines. */

/**
 * NEXT_PUBLIC_SITE_URL as set (e.g. a preview's address), but in production never a
 * *.vercel.app address: the shops have their own domains (storeConfig.siteUrl), and with
 * NEXT_PUBLIC_SITE_URL left at the project's vercel.app address the canonical addresses,
 * sitemap and robots.txt sent search engines there (Fastelavnskostumer.dk, 17-10-2026).
 */
export function configuredSiteUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  const url = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!url) return undefined;
  return env.VERCEL_ENV === "production" && isVercelAppUrl(url) ? storeConfig.siteUrl : url;
}

function isVercelAppUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

/** This shop's address: NEXT_PUBLIC_SITE_URL (see configuredSiteUrl), else the brand's own domain. */
export const SITE_URL = (configuredSiteUrl() || storeConfig.siteUrl).replace(/\/+$/, "");

/**
 * A page's Open Graph data: its address (og:url, the same as its canonical) and the share
 * image, the product's photo or else the shop's (app/opengraph-image.tsx), with og:type,
 * og:site_name and og:locale. A page's `openGraph` replaces the whole object, file-based image
 * included, so the shop's image is named here again.
 */
export function openGraphFor(url: string | undefined, images?: { url: string; alt: string }[]) {
  return {
    type: "website" as const,
    siteName: storeConfig.name,
    locale: "da_DK",
    url,
    images: images ?? [{ url: "/opengraph-image", width: 1200, height: 630, alt: storeConfig.name, type: "image/png" }],
  };
}

/** company.address "Street 1, 2650 Town" as a schema.org PostalAddress. */
function postalAddress(address: string) {
  const match = /^(.+),\s*(\d{4})\s+(.+)$/.exec(address.trim());
  return match
    ? { "@type": "PostalAddress", streetAddress: match[1], postalCode: match[2], addressLocality: match[3], addressCountry: "DK" }
    : { "@type": "PostalAddress", streetAddress: address, addressCountry: "DK" };
}

export function absoluteUrl(path: string): string {
  return path.startsWith("http") ? path : `${SITE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** A JSON-LD script. "<" is escaped so text can never close the script element. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

export function breadcrumbData(items: { name: string; href?: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      ...(item.href ? { item: absoluteUrl(item.href) } : {}),
    })),
  };
}

/** The shop (organisation) and its search, for the front page. */
export function shopData() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "OnlineStore",
        "@id": `${SITE_URL}/#shop`,
        name: storeConfig.name,
        url: SITE_URL,
        logo: absoluteUrl("/email-logo.png"),
        description: storeConfig.description,
        email: storeConfig.supportEmail,
        // The company behind the shop (src/config/company.ts), for search engines' merchant details.
        legalName: company.name,
        address: postalAddress(company.address),
        telephone: `+45 ${company.phone}`,
        vatID: `DK${company.cvr}`,
        areaServed: "DK",
        currenciesAccepted: storeConfig.currency,
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        name: storeConfig.name,
        url: SITE_URL,
        inLanguage: "da-DK",
        publisher: { "@id": `${SITE_URL}/#shop` },
        potentialAction: {
          "@type": "SearchAction",
          target: { "@type": "EntryPoint", urlTemplate: `${SITE_URL}/soeg?q={search_term_string}` },
          "query-input": "required name=search_term_string",
        },
      },
    ],
  };
}

/** "[text](href)" -> "text", for structured data that must be plain text. */
export function plainText(text: string): string {
  return text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1");
}
