import { getRelatedProducts } from "@/lib/woocommerce/products";
import type { Product, ProductSummary } from "@/types/commerce";
import { ProductCard } from "./product-card";

/** "Relevant tilbehør" and, below it, "Lignende produkter". Rows without products are left out. */
export async function RelatedProducts({ product }: { product: Product }) {
  const { accessories, similar } = await getRelatedProducts({
    id: product.id,
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

/** A row of cards: scrolls sideways on phones, a grid of four on larger screens. */
function ProductRow({ id, title, intro, products }: { id: string; title: string; intro?: string; products: ProductSummary[] }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="text-2xl font-extrabold tracking-tight text-ink">
        {title}
      </h2>
      {intro && <p className="mt-1 text-muted">{intro}</p>}
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
