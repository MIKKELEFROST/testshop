import { storeConfig } from "@/config/store";

/** Structured data (schema.org JSON-LD) and absolute URLs for search engines. */

/** This shop's address: NEXT_PUBLIC_SITE_URL (e.g. a preview's), else the brand's own domain. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || storeConfig.siteUrl).replace(/\/+$/, "");

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
