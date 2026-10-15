import { CircleCheck, Film } from "lucide-react";
import Link from "next/link";
import { FavoriteButton } from "@/components/favorites/favorite-button";
import { formatAmount } from "@/lib/money";
import type { ProductSummary } from "@/types/commerce";
import { ProductImage } from "./product-image";
import { stockLabel } from "./stock-badge";

/**
 * Product card: white card with the photo shown whole, discount, video and 18+ marks, a heart
 * for the favourites, the name, the number of sizes, a large price and the stock status, all
 * centred. The whole card is a link (the name's link covers it); the heart sits above it.
 */
export function ProductCard({ product, priority = false }: { product: ProductSummary; priority?: boolean }) {
  const stock = stockLabel(product.stockStatus, product.stockQuantity);
  const soldOut = stock.tone === "out";
  return (
    <div className="group relative flex h-full flex-col rounded-lg bg-surface p-3 pb-4 shadow-[0_1px_2px_rgb(0_0_0/0.05)] ring-1 ring-black/[0.04] transition-shadow hover:shadow-[0_8px_24px_rgb(0_0_0/0.09)] sm:p-4 sm:pb-5">
      <div className="relative aspect-square overflow-hidden">
        <ProductImage
          image={product.image}
          name={product.name}
          priority={priority}
          sizes="(min-width: 1280px) 18vw, (min-width: 1024px) 22vw, (min-width: 640px) 30vw, 46vw"
          className="transition-transform duration-500 group-hover:scale-[1.04]"
        />
        {!soldOut && (product.discountPercent !== null || product.onSale) && (
          <span className="absolute top-0 left-0 rounded-md bg-sale px-2 py-1 text-sm leading-none font-extrabold text-white">
            {product.discountPercent !== null ? `-${product.discountPercent}%` : "Tilbud"}
          </span>
        )}
        {product.hasVideo && (
          <span className="absolute bottom-0 left-0 rounded-md bg-white/85 p-0.5 text-video">
            <Film className="size-6 sm:size-7" strokeWidth={1.8} aria-hidden="true" />
            <span className="sr-only">Med video</span>
          </span>
        )}
        {product.adult && <AdultMark className="absolute right-0 bottom-0" />}
      </div>

      <div className="mt-3 flex flex-1 flex-col items-center text-center">
        <h3 className="line-clamp-2 text-[15px] leading-snug font-bold text-ink-soft group-hover:text-ink sm:text-base">
          <Link href={`/produkter/${product.slug}`} className="after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-accent">
            {product.name}
          </Link>
        </h3>
        {product.variantSummary && <p className="mt-1 text-[13px] text-muted sm:text-sm">{product.variantSummary}</p>}
        <div className="mt-auto pt-2">
          <CardPrice product={product} />
        </div>
        <p
          className={`mt-1 flex items-center gap-1.5 text-[13px] font-bold sm:text-sm ${
            stock.tone === "ok" ? "text-success" : stock.tone === "low" ? "text-warning" : "text-muted"
          }`}
        >
          {stock.tone === "ok" && <CircleCheck className="size-4 fill-success text-white" strokeWidth={2.5} aria-hidden="true" />}
          {stock.text}
        </p>
      </div>

      <div className="absolute top-2 right-2 z-10 sm:top-3 sm:right-3">
        <FavoriteButton productId={product.id} name={product.name} />
      </div>
    </div>
  );
}

/** "18+" on products for adults only. */
export function AdultMark({ className = "" }: { className?: string }) {
  return (
    <span className={`rounded-md bg-ink px-1.5 py-1 text-xs leading-none font-extrabold text-white ${className}`} title="Kun for voksne over 18 år">
      18+
      <span className="sr-only"> – kun for voksne</span>
    </span>
  );
}

/** "199 kr." large in the price colour; on sale the old price struck through and the new one red. */
function CardPrice({ product }: { product: ProductSummary }) {
  const range = product.priceRange && product.priceRange.min !== product.priceRange.max ? product.priceRange : null;
  const price = range ? range.min : (product.price ?? product.priceRange?.min ?? null);
  if (!price) return <p className="text-sm text-muted">Pris ikke tilgængelig</p>;

  const sale = !range && product.onSale && product.regularPrice && product.regularPrice !== price ? product.regularPrice : null;
  return (
    <p className="flex items-baseline justify-center gap-2">
      {sale && (
        <span className="text-sm font-semibold text-muted line-through decoration-1">
          <span className="sr-only">Før </span>
          {formatAmount(sale)} kr.
        </span>
      )}
      <span className={`font-extrabold tracking-tight ${sale ? "text-sale" : "text-price"}`}>
        {range && <span className="mr-1 text-[15px] font-bold">fra</span>}
        <span className="text-[26px] leading-none sm:text-[28px]">{formatAmount(price)}</span>
        <span className="ml-1 text-[19px] font-bold">kr.</span>
      </span>
    </p>
  );
}

export function ProductGrid({ products }: { products: ProductSummary[] }) {
  if (products.length === 0) {
    return <p className="py-12 text-center text-muted">Der er ingen produkter her endnu.</p>;
  }
  return (
    <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
      {products.map((product, index) => (
        <li key={product.id}>
          <ProductCard product={product} priority={index < 4} />
        </li>
      ))}
    </ul>
  );
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="animate-pulse rounded-lg bg-surface p-3 sm:p-4">
          <div className="aspect-square rounded-lg bg-black/5" />
          <div className="mx-auto mt-3 h-4 w-3/4 rounded bg-black/5" />
          <div className="mx-auto mt-2 h-3 w-1/3 rounded bg-black/5" />
          <div className="mx-auto mt-3 h-7 w-1/2 rounded bg-black/5" />
        </li>
      ))}
    </ul>
  );
}

/**
 * Full-width light band behind product cards, from the page's top down to the selling points
 * above the footer (its negative margin removes the strip's top margin).
 */
export function CardBand({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`-mb-20 bg-canvas pb-20 ${className}`}>{children}</div>;
}
