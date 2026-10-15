import Link from "next/link";
import { Suspense } from "react";
import { ProductGrid, ProductGridSkeleton } from "@/components/products/product-card";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { isDark, storeConfig } from "@/config/store";
import { productCount } from "@/lib/format";
import { topLevelCategories } from "@/lib/woocommerce/category-tree";
import { getCategories, getProducts } from "@/lib/woocommerce/products";

export default function HomePage() {
  const dark = isDark(storeConfig.theme.hero);
  return (
    <>
      <section className="container-shop pt-6 sm:pt-10">
        <div
          className={`relative overflow-hidden rounded-[1.5rem] bg-hero px-6 py-16 sm:px-12 sm:py-24 lg:py-28 ${dark ? "text-white" : ""}`}
        >
          <div
            className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-hero-blob opacity-70 blur-2xl"
            aria-hidden="true"
          />
          <div
            className={`pointer-events-none absolute -bottom-32 right-24 size-80 rounded-full bg-accent-soft blur-2xl ${dark ? "opacity-20" : "opacity-80"}`}
            aria-hidden="true"
          />
          <div className="relative max-w-xl">
            <p className={`text-sm font-medium uppercase tracking-[0.16em] ${dark ? "text-white/75" : "text-ink-soft"}`}>
              {storeConfig.heroEyebrow}
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
              {storeConfig.tagline}
            </h1>
            <p className={`mt-5 max-w-md text-lg leading-relaxed ${dark ? "text-white/80" : "text-ink-soft"}`}>
              {storeConfig.description}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/produkter" size="lg" className={dark ? "bg-white! text-ink! hover:bg-white/90!" : ""}>
                Se alle produkter
              </ButtonLink>
              <ButtonLink
                href="#udvalgte"
                size="lg"
                variant="secondary"
                className={dark ? "border-white/40! bg-transparent! text-white! hover:border-white!" : ""}
              >
                Udvalgte varer
              </ButtonLink>
            </div>
          </div>
        </div>
      </section>

      <section className="container-shop mt-16" aria-labelledby="kategorier">
        <h2 id="kategorier" className="text-2xl font-semibold tracking-tight">
          Kategorier
        </h2>
        <Suspense fallback={<div className="mt-6 h-28 animate-pulse rounded-[var(--radius-card)] bg-black/5" />}>
          <CategoryTiles />
        </Suspense>
      </section>

      <section id="udvalgte" className="container-shop mt-16 scroll-mt-28" aria-labelledby="udvalgte-titel">
        <div className="mb-6 flex items-end justify-between gap-4">
          <h2 id="udvalgte-titel" className="text-2xl font-semibold tracking-tight">
            Udvalgte varer
          </h2>
          <Link href="/produkter" className="text-sm font-medium underline underline-offset-4">
            Se alle
          </Link>
        </div>
        <Suspense fallback={<ProductGridSkeleton />}>
          <FeaturedProducts />
        </Suspense>
      </section>

      <section className="container-shop mt-20">
        <ul className="grid gap-6 rounded-[var(--radius-card)] border border-line bg-surface p-6 sm:grid-cols-3 sm:p-8">
          {[
            ["Sikker betaling", "Kortoplysninger håndteres af Stripe og rammer aldrig vores servere."],
            ["Levering i Danmark", "Fragtprisen beregnes ud fra din adresse ved kassen."],
            ["Personlig service", "Skriv til os, hvis du har spørgsmål til en vare eller ordre."],
          ].map(([title, text]) => (
            <li key={title}>
              <p className="font-medium">{title}</p>
              <p className="mt-1 text-sm text-muted">{text}</p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

async function FeaturedProducts() {
  const products = await getProducts({ perPage: 8 });
  if (!products.ok) return <Alert tone="warning">{products.error}</Alert>;
  return <ProductGrid products={products.data.products} />;
}

async function CategoryTiles() {
  const categories = await getCategories();
  if (!categories.ok || categories.data.length === 0) return null;
  return (
    <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {topLevelCategories(categories.data).map((category) => (
        <li key={category.id}>
          <Link
            href={`/kategori/${category.slug}`}
            className="group flex h-28 flex-col justify-between rounded-[var(--radius-card)] border border-line bg-surface p-5 transition-colors hover:border-ink"
          >
            <span className="text-lg font-medium">{category.name}</span>
            <span className="text-sm text-muted group-hover:text-ink">{productCount(category.count)} →</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
