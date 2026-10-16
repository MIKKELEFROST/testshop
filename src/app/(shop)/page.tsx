import { House, Ruler, Shirt, Sparkles, VenetianMask, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { Hero } from "@/components/home/hero";
import { AudienceTiles, ThemeTiles } from "@/components/home/tiles";
import { CardBand } from "@/components/products/product-card";
import { ProductRow, RelatedProductsSkeleton } from "@/components/products/related-products";
import { merchandising, type GuideIcon, type HomePage as HomeConfig } from "@/config/merchandising";
import { storeConfig } from "@/config/store";
import { JsonLd, shopData } from "@/lib/seo";
import { getCollectionProducts, getProductsBySlug } from "@/lib/woocommerce/collections";

/**
 * The shop's front page (src/config/merchandising.ts): hero with the countdown to its holiday,
 * who the costume is for, its themes, rows of products and a short guide.
 */
export default function HomePage() {
  const { home } = merchandising;
  return (
    <>
      <JsonLd data={shopData()} />
      <Suspense fallback={<HeroSkeleton />}>
        <HeroWithPhotos hero={home.hero} firstRow={home.rows[0]?.collection} />
      </Suspense>
      <Suspense fallback={<div className="container-shop mt-16 h-48 animate-pulse rounded-2xl bg-black/5" />}>
        <AudienceTiles title={home.audiences.title} tiles={home.audiences.tiles} />
      </Suspense>
      <Suspense fallback={<div className="container-shop mt-20 h-96 animate-pulse rounded-2xl bg-black/5" />}>
        <ThemeTiles title={home.themes.title} collections={home.themes.collections} />
      </Suspense>

      <CardBand className="mt-16 pt-12 sm:mt-20">
        <div className="container-shop space-y-14">
          <Suspense fallback={<RelatedProductsSkeleton />}>
            <HomeRows rows={home.rows} />
          </Suspense>
          <Guide guide={home.guide} />
        </div>
      </CardBand>
    </>
  );
}

async function HeroWithPhotos({ hero, firstRow }: { hero: HomeConfig["hero"]; firstRow?: string }) {
  let products = hero.products.length > 0 ? await getProductsBySlug(hero.products) : [];
  if (products.length === 0 && firstRow) {
    const result = await getCollectionProducts(firstRow, { perPage: 6 });
    products = result?.ok ? result.data.products : [];
  }
  return <Hero hero={hero} products={products} />;
}

/** The rows of products, each without the products already shown above it. */
async function HomeRows({ rows }: { rows: HomeConfig["rows"] }) {
  // Twice as many as shown: rows overlap, and an older plugin leaves hidden categories to be filtered out here.
  const results = await Promise.all(rows.map((row) => getCollectionProducts(row.collection, { perPage: 20 })));
  const shown = new Set<number>();
  return rows.map((row, i) => {
    const result = results[i];
    const products = (result?.ok ? result.data.products : []).filter((p) => !shown.has(p.id)).slice(0, 10);
    products.forEach((p) => shown.add(p.id));
    if (products.length === 0) return null;
    return <ProductRow key={row.collection} id={`raekke-${i}`} title={row.title} intro={row.intro} href={row.href} products={products} />;
  });
}

const GUIDE_ICONS: Record<GuideIcon, LucideIcon> = { ruler: Ruler, shirt: Shirt, sparkles: Sparkles, mask: VenetianMask, house: House };

function Guide({ guide }: { guide: HomeConfig["guide"] }) {
  const halloween = storeConfig.season === "halloween";
  return (
    <section aria-labelledby="guide" className={`rounded-[1.75rem] p-6 sm:p-10 ${halloween ? "bg-hero text-white" : "bg-tint"}`}>
      <div className="max-w-2xl">
        <h2 id="guide" className="heading text-[26px] sm:text-3xl">
          {guide.title}
        </h2>
        <p className={`mt-2 ${halloween ? "text-white/75" : "text-ink-soft"}`}>{guide.text}</p>
      </div>
      <ul className="mt-8 grid gap-6 sm:grid-cols-3">
        {guide.tips.map((tip) => {
          const Icon = GUIDE_ICONS[tip.icon];
          return (
            <li key={tip.title} className="flex gap-4">
              <span className={`flex size-11 shrink-0 items-center justify-center rounded-full ${halloween ? "bg-action text-on-action" : "bg-surface text-highlight shadow-sm"}`}>
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <div>
                <p className="font-bold">{tip.title}</p>
                <p className={`mt-1 text-[15px] leading-relaxed ${halloween ? "text-white/75" : "text-ink-soft"}`}>{tip.text}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <Link href={guide.link.href} className={`mt-8 inline-block font-bold underline underline-offset-4 ${halloween ? "text-action" : "text-accent"}`}>
        {guide.link.label} →
      </Link>
    </section>
  );
}

function HeroSkeleton() {
  return (
    <div className="container-shop pt-4 sm:pt-6">
      <div className="h-[460px] animate-pulse rounded-[1.75rem] bg-hero opacity-60" />
    </div>
  );
}
