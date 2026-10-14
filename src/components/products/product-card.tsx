import Link from "next/link";
import type { ProductSummary } from "@/types/commerce";
import { Price } from "./price";
import { ProductImage } from "./product-image";

export function ProductCard({ product, priority = false }: { product: ProductSummary; priority?: boolean }) {
  const soldOut = product.stockStatus === "outofstock";
  return (
    <Link href={`/produkter/${product.slug}`} className="group block">
      <div className="relative aspect-[4/5] overflow-hidden rounded-[var(--radius-card)] bg-[#efe9e1]">
        <ProductImage
          image={product.image}
          name={product.name}
          priority={priority}
          sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
          className="transition-transform duration-500 group-hover:scale-[1.03]"
        />
        <div className="absolute left-3 top-3 flex gap-1.5">
          {product.onSale && !soldOut && (
            <span className="rounded-full bg-sale px-2.5 py-1 text-xs font-medium text-white">Tilbud</span>
          )}
          {soldOut && <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-medium text-ink">Udsolgt</span>}
        </div>
      </div>
      <div className="mt-3 space-y-1">
        <h3 className="text-[15px] leading-snug text-ink group-hover:underline group-hover:underline-offset-4">{product.name}</h3>
        <Price price={product.price} regularPrice={product.regularPrice} onSale={product.onSale} range={product.priceRange} />
      </div>
    </Link>
  );
}

export function ProductGrid({ products }: { products: ProductSummary[] }) {
  if (products.length === 0) {
    return <p className="py-12 text-center text-muted">Der er ingen produkter her endnu.</p>;
  }
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-6">
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
    <ul className="grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-6" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="animate-pulse">
          <div className="aspect-[4/5] rounded-[var(--radius-card)] bg-black/5" />
          <div className="mt-3 h-4 w-3/4 rounded bg-black/5" />
          <div className="mt-2 h-4 w-1/3 rounded bg-black/5" />
        </li>
      ))}
    </ul>
  );
}
