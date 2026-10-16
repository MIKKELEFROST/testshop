import Link from "next/link";
import { getRelatedProducts } from "@/lib/woocommerce/products";
import type { Product, ProductSummary } from "@/types/commerce";
import { ProductCard } from "./product-card";

/** "Relevant tilbehør" and, below it, "Lignende produkter". Rows without products are left out. */
export async function RelatedProducts({ product }: { product: Product }) {
  const { accessories, similar } = await getRelatedProducts({
    id: product.id,
    name: product.name,
    tags: product.tags,
    audience: product.audience,
    categories: product.categories,
  });
  if (accessories.length === 0 && similar.length === 0) return null;
  return (
    <div className="space-y-14">
      {accessories.length > 0 && (
        <ProductRow id="tilbehoer" title="Relevant tilbehør" intro="Gør udklædningen komplet" products={accessories} />
      )}
      {similar.length > 0 && <ProductRow id="lignende" title="Lignende produkter" products={similar} />}
    </div>
  );
}

/** A row of cards: scrolls sideways on phones, a grid on larger screens; "Se alle" links to `href`. */
export function ProductRow({ id, title, intro, href, products }: { id: string; title: string; intro?: string; href?: string; products: ProductSummary[] }) {
  return (
    <section aria-labelledby={id}>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 id={id} className="heading text-[26px] text-ink sm:text-3xl">
            {title}
          </h2>
          {intro && <p className="mt-1 text-muted">{intro}</p>}
        </div>
        {href && (
          <Link href={href} className="shrink-0 text-sm font-bold text-accent underline underline-offset-4">
            Se alle
          </Link>
        )}
      </div>
      <ul className="-mx-4 mt-5 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible sm:px-0 lg:grid-cols-4 xl:grid-cols-5">
        {products.map((product) => (
          <li key={product.id} className="w-[46%] shrink-0 snap-start sm:w-auto">
            <ProductCard product={product} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RelatedProductsSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="h-7 w-56 animate-pulse rounded bg-black/5" />
      <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="aspect-[3/4] animate-pulse rounded-lg bg-surface" />
        ))}
      </div>
    </div>
  );
}
