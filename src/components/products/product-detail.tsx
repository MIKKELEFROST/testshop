"use client";

import { CircleCheck, Ruler, ShoppingBag } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useCart } from "@/components/cart/cart-provider";
import { Button } from "@/components/ui/button";
import { QuantityStepper } from "@/components/ui/quantity-stepper";
import { formatAmount, fromMinorUnits, toMinorUnits } from "@/lib/money";
import { discountPercent } from "@/lib/pricing";
import type { Product, ProductImage as ProductImageType, ProductVariation, StockStatus } from "@/types/commerce";
import { ProductGallery } from "./product-gallery";
import { ProductImage } from "./product-image";
import { stockLabel } from "./stock-badge";

/**
 * Gallery and purchase panel: price with savings, stock, size buttons (with body height when
 * the description gives it), add to cart, the shop's promises (`promises`) and the product
 * details (`details`). On phones a bar with the price and the button stays at the bottom once
 * the main button has scrolled out of view.
 */
export function ProductDetail({
  product,
  categoryName,
  heights = {},
  promises,
  details,
}: {
  product: Product;
  categoryName?: string;
  heights?: Record<string, string>;
  promises?: ReactNode;
  details?: ReactNode;
}) {
  const { add, lines } = useCart();
  const isVariable = product.type === "variable";
  const [selection, setSelection] = useState<Record<string, string>>(() => initialSelection(product));
  const [quantity, setQuantity] = useState(1);
  const [imageIndex, setImageIndex] = useState(0);
  const [showChooseHint, setShowChooseHint] = useState(false);
  const buyRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const buyPassed = usePassed(buyRef);

  const variation = useMemo(() => findVariation(product, selection), [product, selection]);
  const missing = product.attributes.find((a) => !selection[a.slug]);

  const price = isVariable ? (variation?.price ?? null) : product.price;
  const regularPrice = isVariable ? (variation?.regularPrice ?? null) : product.regularPrice;
  const onSale = isVariable ? (variation?.onSale ?? false) : product.onSale;
  const stockStatus: StockStatus = isVariable ? (variation?.stockStatus ?? product.stockStatus) : product.stockStatus;
  const stockQuantity = isVariable ? (variation?.stockQuantity ?? null) : product.stockQuantity;
  const purchasable = isVariable ? Boolean(variation?.purchasable) : product.purchasable;

  const inCart = lines.find((l) => l.productId === product.id && l.variationId === (variation?.id ?? 0))?.quantity ?? 0;
  const maxAddable = stockQuantity === null ? 99 - inCart : Math.max(0, Math.min(99, stockQuantity) - inCart);
  const soldOut = stockStatus === "outofstock" || stockQuantity === 0;
  const canAdd = purchasable && !soldOut && (!isVariable || Boolean(variation)) && maxAddable > 0 && price !== null;
  const percent = discountPercent(price, regularPrice, onSale) ?? (variation ? null : product.discountPercent);

  const images: ProductImageType[] = variation?.image
    ? [variation.image, ...product.images.filter((i) => i.src !== variation.image?.src)]
    : product.images;

  const variantLabel = isVariable ? product.attributes.map((a) => `${a.name}: ${selection[a.slug] ?? "–"}`).join(", ") : undefined;

  function handleAdd() {
    if (isVariable && missing) {
      // From the bar at the bottom (or a click on the main button): show where to choose.
      setShowChooseHint(true);
      optionsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      optionsRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
      return;
    }
    if (!canAdd) return;
    add({
      productId: product.id,
      variationId: variation?.id ?? 0,
      quantity: Math.min(quantity, maxAddable),
      name: product.name,
      slug: product.slug,
      variantLabel,
      image: images[0] ?? null,
      unitPrice: price,
      maxQuantity: stockQuantity,
    });
    setQuantity(1);
  }

  let buttonLabel = "Læg i kurv";
  if (isVariable && missing) buttonLabel = `Vælg ${missing.name.toLowerCase()}`;
  else if (isVariable && !variation) buttonLabel = "Ikke tilgængelig";
  else if (soldOut) buttonLabel = "Udsolgt";
  else if (maxAddable === 0) buttonLabel = "Alle på lager er i din kurv";
  const buttonEnabled = canAdd || Boolean(isVariable && missing);

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-14">
      <ProductGallery
        images={images}
        videos={product.videos}
        name={product.name}
        badge={percent !== null && !soldOut ? `-${percent}%` : null}
        index={imageIndex}
        onIndexChange={setImageIndex}
      />

      <div className="lg:sticky lg:top-36 lg:self-start">
        {categoryName && <p className="text-sm font-medium text-muted">{categoryName}</p>}
        <h1 className="mt-1 text-[26px] leading-tight font-extrabold tracking-tight text-balance text-ink sm:text-[32px]">{product.name}</h1>

        <div className="mt-4">
          <PriceBlock
            price={price ?? (isVariable ? (product.priceRange?.min ?? product.price) : null)}
            from={isVariable && !variation && Boolean(product.priceRange && product.priceRange.min !== product.priceRange.max)}
            regularPrice={onSale ? regularPrice : null}
          />
          <p className="mt-1 text-xs text-muted">Inkl. moms</p>
        </div>

        <StockLine status={stockStatus} quantity={stockQuantity} />

        {product.shortDescription.length > 0 && (
          <div className="mt-5 space-y-2 text-[15px] leading-relaxed text-ink-soft">
            {product.shortDescription.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        )}

        <div ref={optionsRef}>
          {product.attributes.map((attribute) => (
            <div key={attribute.slug} role="group" aria-labelledby={`valg-${attribute.slug}`} className="mt-7">
              <div className="flex items-baseline justify-between gap-4">
                <p id={`valg-${attribute.slug}`} className="text-[15px] font-bold text-ink">
                  {attribute.name}
                  {selection[attribute.slug] && <span className="font-normal text-ink-soft">: {selection[attribute.slug]}</span>}
                </p>
                {product.sizeChart && attribute === product.attributes[0] && (
                  <a
                    href={product.sizeChart}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-ink-soft underline underline-offset-4 hover:text-ink"
                  >
                    <Ruler className="size-4" aria-hidden="true" />
                    Størrelsesguide
                  </a>
                )}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {attribute.options.map((option) => {
                  const available = optionAvailable(product, selection, attribute.slug, option);
                  const selected = selection[attribute.slug] === option;
                  const height = heights[option];
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => {
                        setSelection((s) => ({ ...s, [attribute.slug]: option }));
                        setImageIndex(0);
                        setShowChooseHint(false);
                      }}
                      aria-pressed={selected}
                      className={`flex min-h-12 flex-col items-center justify-center rounded-[var(--radius-control)] border px-2 py-1.5 text-sm leading-tight font-semibold transition-colors ${
                        selected ? "border-ink bg-ink text-white" : "border-line-strong bg-surface text-ink hover:border-ink"
                      } ${available ? "" : "text-muted line-through decoration-1"}`}
                    >
                      {option}
                      {height && <span className={`text-xs font-normal ${selected ? "text-white/75" : "text-muted"}`}>{height}</span>}
                      {!available && <span className="sr-only"> (udsolgt)</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {showChooseHint && missing && (
          <p className="mt-3 text-sm font-semibold text-sale" role="alert">
            Vælg {missing.name.toLowerCase()} først.
          </p>
        )}

        <div ref={buyRef} className="mt-6 flex gap-3">
          <QuantityStepper value={quantity} max={Math.max(1, maxAddable)} onChange={setQuantity} disabled={!canAdd} />
          <Button size="lg" full onClick={handleAdd} disabled={!buttonEnabled} className="text-[17px] font-bold">
            {buttonEnabled && !missing && <ShoppingBag className="size-5" aria-hidden="true" />}
            {buttonLabel}
          </Button>
        </div>
        {inCart > 0 && <p className="mt-3 text-sm text-muted">Du har {inCart} i kurven.</p>}

        {promises && <div className="mt-7">{promises}</div>}
        {details && <div className="mt-2">{details}</div>}
      </div>

      <StickyBuyBar
        visible={buyPassed}
        image={images[0] ?? null}
        name={product.name}
        price={price ?? product.priceRange?.min ?? product.price}
        label={buttonLabel}
        enabled={buttonEnabled}
        onBuy={handleAdd}
      />
    </div>
  );
}

function PriceBlock({ price, from, regularPrice }: { price: string | null; from: boolean; regularPrice: string | null }) {
  if (!price) return <p className="text-lg text-muted">Pris ikke tilgængelig</p>;
  const before = regularPrice && toMinorUnits(regularPrice, 2) > toMinorUnits(price, 2) ? regularPrice : null;
  const saving = before ? fromMinorUnits(toMinorUnits(before, 2) - toMinorUnits(price, 2), 2) : null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <p className={`font-extrabold tracking-tight ${before ? "text-sale" : "text-price"}`}>
        {from && <span className="mr-1.5 text-lg font-bold">fra</span>}
        <span className="text-[34px] leading-none sm:text-[38px]">{formatAmount(price)}</span>
        <span className="ml-1 text-xl font-bold">kr.</span>
      </p>
      {before && (
        <p className="text-lg font-semibold text-muted line-through decoration-1">
          <span className="sr-only">Før </span>
          {formatAmount(before)} kr.
        </p>
      )}
      {saving && <p className="rounded-md bg-sale px-2 py-1 text-sm leading-none font-bold text-white">Spar {formatAmount(saving)} kr.</p>}
    </div>
  );
}

function StockLine({ status, quantity }: { status: StockStatus; quantity: number | null }) {
  const { text, tone } = stockLabel(status, quantity);
  return (
    <p className={`mt-4 flex items-center gap-2 text-[15px] font-bold ${tone === "ok" ? "text-success" : tone === "low" ? "text-warning" : "text-muted"}`}>
      {tone === "ok" ? (
        <CircleCheck className="size-5 fill-success text-white" strokeWidth={2.5} aria-hidden="true" />
      ) : (
        <span className={`ml-1 size-2.5 rounded-full ${tone === "low" ? "bg-warning" : "bg-danger"}`} aria-hidden="true" />
      )}
      {text}
    </p>
  );
}

/** Phones: price and button at the bottom once the main button is out of view. */
function StickyBuyBar({
  visible,
  image,
  name,
  price,
  label,
  enabled,
  onBuy,
}: {
  visible: boolean;
  image: ProductImageType | null;
  name: string;
  price: string | null;
  label: string;
  enabled: boolean;
  onBuy: () => void;
}) {
  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 py-3 shadow-[0_-4px_16px_rgb(0_0_0/0.06)] backdrop-blur transition-transform duration-200 lg:hidden ${
        visible ? "translate-y-0" : "pointer-events-none translate-y-full"
      }`}
      aria-hidden={!visible}
      inert={!visible}
    >
      <div className="flex items-center gap-3">
        <div className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-white ring-1 ring-line">
          <ProductImage image={image} name={name} sizes="48px" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{name}</p>
          {price && <p className="text-base leading-tight font-extrabold text-price">{formatAmount(price)} kr.</p>}
        </div>
        <Button onClick={onBuy} disabled={!enabled} className="h-12 shrink-0 px-5 font-bold">
          {label}
        </Button>
      </div>
    </div>
  );
}

/** Whether the element has scrolled up out of view (the customer has passed it). */
function usePassed(ref: React.RefObject<HTMLElement | null>): boolean {
  const [passed, setPassed] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setPassed(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return passed;
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
