"use client";

import { useMemo, useState } from "react";
import { useCart } from "@/components/cart/cart-provider";
import { Button } from "@/components/ui/button";
import type { Product, ProductImage as ProductImageType, ProductVariation } from "@/types/commerce";
import { Price } from "./price";
import { ProductImage } from "./product-image";
import { StockBadge } from "./stock-badge";

/** Gallery + purchase panel (variant selection, quantity, add to cart). */
export function ProductDetail({ product, categoryName }: { product: Product; categoryName?: string }) {
  const { add, lines } = useCart();
  const isVariable = product.type === "variable";
  const [selection, setSelection] = useState<Record<string, string>>(() => initialSelection(product));
  const [quantity, setQuantity] = useState(1);
  const [imageIndex, setImageIndex] = useState(0);

  const variation = useMemo(() => findVariation(product, selection), [product, selection]);
  const selectionComplete = product.attributes.every((a) => selection[a.slug]);

  const price = isVariable ? variation?.price ?? null : product.price;
  const regularPrice = isVariable ? variation?.regularPrice ?? null : product.regularPrice;
  const onSale = isVariable ? variation?.onSale ?? false : product.onSale;
  const stockStatus = isVariable ? variation?.stockStatus ?? "outofstock" : product.stockStatus;
  const stockQuantity = isVariable ? variation?.stockQuantity ?? null : product.stockQuantity;
  const purchasable = isVariable ? Boolean(variation?.purchasable) : product.purchasable;

  const inCart = lines.find((l) => l.productId === product.id && l.variationId === (variation?.id ?? 0))?.quantity ?? 0;
  const maxAddable = stockQuantity === null ? 99 - inCart : Math.max(0, Math.min(99, stockQuantity) - inCart);
  const soldOut = stockStatus === "outofstock" || stockQuantity === 0;
  const canAdd = purchasable && !soldOut && (!isVariable || Boolean(variation)) && maxAddable > 0 && price !== null;

  const images: ProductImageType[] = variation?.image
    ? [variation.image, ...product.images.filter((i) => i.src !== variation.image?.src)]
    : product.images;
  const activeImage = images[Math.min(imageIndex, Math.max(images.length - 1, 0))] ?? null;

  const variantLabel = isVariable
    ? product.attributes.map((a) => `${a.name}: ${selection[a.slug] ?? "–"}`).join(", ")
    : undefined;

  function handleAdd() {
    if (!canAdd) return;
    add({
      productId: product.id,
      variationId: variation?.id ?? 0,
      quantity: Math.min(quantity, maxAddable),
      name: product.name,
      slug: product.slug,
      variantLabel,
      image: activeImage,
      unitPrice: price,
      maxQuantity: stockQuantity,
    });
    setQuantity(1);
  }

  let buttonLabel = "Læg i kurv";
  if (isVariable && !selectionComplete) buttonLabel = `Vælg ${product.attributes.find((a) => !selection[a.slug])?.name.toLowerCase() ?? "variant"}`;
  else if (isVariable && !variation) buttonLabel = "Ikke tilgængelig";
  else if (soldOut) buttonLabel = "Udsolgt";
  else if (maxAddable === 0) buttonLabel = "Alle på lager er i din kurv";

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-14">
      <div>
        <div className="relative aspect-[4/5] overflow-hidden rounded-[var(--radius-card)] bg-tint">
          <ProductImage image={activeImage} name={product.name} priority sizes="(min-width: 1024px) 55vw, 100vw" />
        </div>
        {images.length > 1 && (
          <ul className="mt-3 grid grid-cols-5 gap-2">
            {images.map((image, index) => (
              <li key={image.src}>
                <button
                  type="button"
                  onClick={() => setImageIndex(index)}
                  aria-label={`Vis billede ${index + 1}`}
                  aria-current={index === imageIndex}
                  className={`relative block aspect-square w-full overflow-hidden rounded-lg border-2 ${
                    index === imageIndex ? "border-ink" : "border-transparent"
                  }`}
                >
                  <ProductImage image={image} name={product.name} sizes="20vw" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="lg:sticky lg:top-28 lg:self-start">
        {(categoryName ?? product.categories[0]?.name) && <p className="text-sm text-muted">{categoryName ?? product.categories[0]?.name}</p>}
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{product.name}</h1>
        <div className="mt-4">
          {isVariable && !variation ? (
            <Price price={product.price} range={product.priceRange} size="lg" />
          ) : (
            <Price price={price} regularPrice={regularPrice} onSale={onSale} size="lg" />
          )}
          <p className="mt-1 text-xs text-muted">Inkl. moms. Fragt beregnes ved kassen.</p>
        </div>

        {product.shortDescription.length > 0 && (
          <div className="mt-6 space-y-2 text-[15px] leading-relaxed text-ink-soft">
            {product.shortDescription.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        )}

        {product.attributes.map((attribute) => (
          <fieldset key={attribute.slug} className="mt-7">
            <legend className="text-sm font-medium">
              {attribute.name}
              {selection[attribute.slug] && <span className="font-normal text-muted">: {selection[attribute.slug]}</span>}
            </legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {attribute.options.map((option) => {
                const available = optionAvailable(product, selection, attribute.slug, option);
                const selected = selection[attribute.slug] === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      setSelection((s) => ({ ...s, [attribute.slug]: option }));
                      setImageIndex(0);
                    }}
                    aria-pressed={selected}
                    className={`h-11 min-w-12 rounded-[var(--radius-control)] border px-4 text-sm transition-colors ${
                      selected ? "border-ink bg-ink text-white" : "border-line-strong bg-surface hover:border-ink"
                    } ${available ? "" : "text-muted line-through decoration-1"}`}
                  >
                    {option}
                    {!available && <span className="sr-only"> (udsolgt)</span>}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}

        {product.sizeChart && (
          <a
            href={product.sizeChart}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block text-sm underline underline-offset-4 hover:text-ink"
          >
            Se størrelsesguide
          </a>
        )}

        <div className="mt-7">
          {(!isVariable || variation) && <StockBadge status={stockStatus} quantity={stockQuantity} />}
        </div>

        <div className="mt-5 flex gap-3">
          <QuantityStepper value={quantity} max={Math.max(1, maxAddable)} onChange={setQuantity} disabled={!canAdd} />
          <Button size="lg" full onClick={handleAdd} disabled={!canAdd}>
            {buttonLabel}
          </Button>
        </div>
        {inCart > 0 && <p className="mt-3 text-sm text-muted">Du har {inCart} i kurven.</p>}

        {product.sku && <p className="mt-8 text-xs text-muted">Varenr. {variation?.sku || product.sku}</p>}
      </div>
    </div>
  );
}

export function QuantityStepper({
  value,
  max,
  onChange,
  disabled,
  label = "Antal",
}: {
  value: number;
  max: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div className="flex h-14 shrink-0 items-center rounded-[var(--radius-control)] border border-line-strong bg-surface" role="group" aria-label={label}>
      <button
        type="button"
        className="flex h-full w-11 items-center justify-center text-lg disabled:opacity-30"
        onClick={() => onChange(Math.max(1, value - 1))}
        disabled={disabled || value <= 1}
        aria-label="Færre"
      >
        −
      </button>
      <span className="w-8 text-center text-[15px] tabular-nums" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className="flex h-full w-11 items-center justify-center text-lg disabled:opacity-30"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={disabled || value >= max}
        aria-label="Flere"
      >
        +
      </button>
    </div>
  );
}

function initialSelection(product: Product): Record<string, string> {
  // Preselect attributes that only have one option.
  return Object.fromEntries(product.attributes.filter((a) => a.options.length === 1).map((a) => [a.slug, a.options[0]!]));
}

function findVariation(product: Product, selection: Record<string, string>): ProductVariation | undefined {
  if (product.type !== "variable") return undefined;
  return product.variations.find((v) => product.attributes.every((a) => v.attributes[a.slug] === selection[a.slug]));
}

function optionAvailable(product: Product, selection: Record<string, string>, slug: string, option: string): boolean {
  if (product.type !== "variable") return true;
  return product.variations.some(
    (v) =>
      v.attributes[slug] === option &&
      v.purchasable &&
      v.stockStatus !== "outofstock" &&
      v.stockQuantity !== 0 &&
      product.attributes.every((a) => a.slug === slug || !selection[a.slug] || v.attributes[a.slug] === selection[a.slug]),
  );
}
