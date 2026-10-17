import type { Metadata } from "next";
import { Suspense } from "react";
import { ThemeTiles } from "@/components/home/tiles";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { CardBand } from "@/components/products/product-card";
import { merchandising, themesOverview } from "@/config/merchandising";
import { openGraphFor } from "@/lib/seo";

/** All the shop's theme pages as photo tiles (src/config/merchandising.ts): the themes, then the rest. */

export const metadata: Metadata = {
  title: "Temaer",
  description: merchandising.themesPage.intro,
  alternates: { canonical: "/tema" },
  openGraph: openGraphFor("/tema"),
};

export default function ThemesPage() {
  return (
    <CardBand>
      <div className="container-shop pt-8 sm:pt-10">
        <Breadcrumbs items={[{ name: "Forside", href: "/" }, { name: "Temaer" }]} />
        <h1 className="heading mt-2 text-[34px] text-ink sm:text-5xl">Temaer</h1>
        <p className="mt-3 max-w-2xl text-[17px] leading-relaxed text-ink-soft">{merchandising.themesPage.intro}</p>
      </div>
      {themesOverview().map((section, i) => (
        <Suspense key={section.title} fallback={<div className="container-shop mt-10 h-96 animate-pulse rounded-2xl bg-black/5" />}>
          <ThemeTiles id={`temaer-${i}`} title={section.title} collections={section.collections.map((c) => c.slug)} className="mt-10 sm:mt-14" />
        </Suspense>
      ))}
    </CardBand>
  );
}
