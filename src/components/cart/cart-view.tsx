"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useCart } from "@/components/cart/cart-provider";
import { QuoteError } from "@/components/checkout/quote-error";
import { useQuote } from "@/components/checkout/use-quote";
import { DispatchCountdown } from "@/components/marketing/dispatch-countdown";
import { ProductImage } from "@/components/products/product-image";
import { QuantityStepper } from "@/components/ui/quantity-stepper";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { savedSubtotal, type CartLine } from "@/lib/cart/cart";
import { cartShippingLabel, ESTIMATE_ADDRESS, type ClientQuote } from "@/lib/checkout/quote";
import { formatPrice, fromMinorUnits, multiplyAmount, toMinorUnits } from "@/lib/money";

/** The /kurv page. Its parts are shared with the cart drawer. */
export function CartView() {
  const { lines, hydrated } = useCart();
  const { quote, loading, error, temporary, retry, canCheckout } = useCartQuote(hydrated);

  if (!hydrated) {
    return <div className="mt-8 h-40 animate-pulse rounded-[var(--radius-card)] bg-black/5" aria-hidden="true" />;
  }

  if (lines.length === 0) {
    return <EmptyCart className="mt-10 rounded-[var(--radius-card)] border border-line bg-surface px-6 py-16 text-center" />;
  }

  return (
    <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_380px]">
      <ul className="divide-y divide-line border-y border-line">
        {lines.map((line) => (
          <CartLineItem key={line.key} line={line} quote={quote} />
        ))}
      </ul>

      <aside className="h-fit rounded-[var(--radius-card)] border border-line bg-surface p-6 lg:sticky lg:top-28" aria-labelledby="kurv-oversigt">
        <h2 id="kurv-oversigt" className="text-lg font-semibold">
          Oversigt
        </h2>
        <CartTotals quote={quote} loading={loading} className="mt-4" />

        {error && (
          <div className="mt-4">
            <CartQuoteError error={error} temporary={temporary} onRetry={retry} />
          </div>
        )}

        <DispatchCountdown className="mt-6 text-sm" />
        <div className="mt-3">
          <CheckoutButton canCheckout={canCheckout} loading={loading}>
            Gå til kassen
          </CheckoutButton>
        </div>
        <Link href="/produkter" className="mt-4 block text-center text-sm text-muted underline underline-offset-4 hover:text-ink">
          Fortsæt med at handle
        </Link>
      </aside>
    </div>
  );
}

/**
 * WooCommerce's prices, stock and totals for the cart. Only fetched while `enabled`.
 * When WooCommerce cannot be reached right now, the customer can still go to the checkout:
 * it asks again there, and the server checks prices and stock before payment.
 */
export function useCartQuote(enabled: boolean) {
  const { lines } = useCart();
  // Priced for a sample address, so WooCommerce returns the shipping rates ("Fragt: fra 39 kr.").
  const { quote, loading, error, temporary, retry } = useQuote(lines, ESTIMATE_ADDRESS, null, enabled);
  const canCheckout = !loading && (quote !== null ? quote.errors.length === 0 && !error : temporary);
  return { quote, loading, error, temporary, retry, canCheckout };
}

/** The cart's quote error with "Prøv igen". */
export function CartQuoteError({ error, temporary, onRetry }: { error: string; temporary: boolean; onRetry: () => void }) {
  return (
    <QuoteError error={error} onRetry={onRetry}>
      {temporary ? "Du kan stadig gå til kassen, hvor priserne beregnes igen." : null}
    </QuoteError>
  );
}

export function EmptyCart({ className, onNavigate }: { className: string; onNavigate?: () => void }) {
  return (
    <div className={className}>
      <p className="text-lg font-medium">Din kurv er tom</p>
      <p className="mt-2 text-muted">Find noget, du kan lide, og læg det i kurven.</p>
      <div className="mt-6">
        <ButtonLink href="/produkter" onNavigate={onNavigate}>
          Se alle produkter
        </ButtonLink>
      </div>
    </div>
  );
}

/**
 * One cart line. Price and stock problems come from the WooCommerce quote; the price saved
 * in the cart is only shown until the quote arrives. `compact` is the drawer's layout.
 */
export function CartLineItem({
  line,
  quote,
  compact = false,
  onNavigate,
}: {
  line: CartLine;
  quote: ClientQuote | null;
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const { setQuantity, remove } = useCart();
  const quoted = quote?.items.find((i) => i.productId === line.productId && i.variationId === line.variationId);
  const lineError = quote?.errors.find((e) => e.productId === line.productId && e.variationId === line.variationId);
  const unitPrice = quoted?.unitPrice ?? line.unitPrice;
  const priceChanged = quoted && line.unitPrice && quoted.unitPrice !== line.unitPrice;

  return (
    <li className={`flex gap-4 ${compact ? "py-4" : "py-5"}`}>
      <Link
        href={`/produkter/${line.slug}`}
        onNavigate={onNavigate}
        tabIndex={-1}
        aria-hidden="true"
        className={`relative aspect-[4/5] shrink-0 overflow-hidden rounded-xl bg-tint ${compact ? "w-20" : "w-24 sm:w-28"}`}
      >
        <ProductImage image={line.image ?? null} name={line.name} sizes={compact ? "80px" : "112px"} decorative />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex justify-between gap-4">
          <div className="min-w-0">
            <Link href={`/produkter/${line.slug}`} onNavigate={onNavigate} className="font-medium hover:underline">
              {line.name}
            </Link>
            {line.variantLabel && <p className="text-sm text-muted">{line.variantLabel}</p>}
            {unitPrice && <p className="mt-1 text-sm text-ink-soft">{formatPrice(unitPrice)} pr. stk.</p>}
            {priceChanged && <p className="text-xs text-warning">Prisen er opdateret</p>}
          </div>
          <p className="shrink-0 font-medium tabular-nums">
            {quoted ? formatPrice(quoted.lineTotal) : unitPrice ? formatPrice(multiplyAmount(unitPrice, line.quantity)) : ""}
          </p>
        </div>

        {lineError && (
          <div className="mt-3">
            <Alert tone="error">
              {lineError.code === "insufficient_stock" && lineError.available ? (
                <>
                  Der er kun {lineError.available} på lager.{" "}
                  <button className="font-medium underline" onClick={() => setQuantity(line.key, lineError.available ?? 1)}>
                    Ret antal til {lineError.available}
                  </button>
                </>
              ) : lineError.code === "out_of_stock" ? (
                "Varen er desværre udsolgt. Fjern den for at fortsætte."
              ) : (
                lineError.message
              )}
            </Alert>
          </div>
        )}

        <div className="mt-auto flex items-center justify-between pt-4">
          <div className="origin-left scale-90">
            <QuantityStepper
              value={line.quantity}
              max={line.maxQuantity ?? 99}
              onChange={(q) => setQuantity(line.key, q)}
              label={`Antal af ${line.name}`}
            />
          </div>
          <button
            type="button"
            onClick={() => remove(line.key)}
            aria-label={`Fjern ${line.name}${line.variantLabel ? `, ${line.variantLabel}` : ""}`}
            className="-mr-2 inline-flex min-h-11 items-center px-2 text-sm text-muted underline underline-offset-4 hover:text-ink"
          >
            Fjern
          </button>
        </div>
      </div>
    </li>
  );
}

/** Subtotal from the quote, and what shipping costs at least (the customer picks the method in the checkout). */
export function CartTotals({ quote, loading, className = "" }: { quote: ClientQuote | null; loading: boolean; className?: string }) {
  const { lines } = useCart();
  // Without a quote (WooCommerce not reachable), the prices saved in the cart give an idea.
  const estimate = quote ? null : savedSubtotal(lines);
  const shipping = cartShippingLabel(quote);
  return (
    <div className={className}>
      {quote && <FreeShippingProgress quote={quote} />}
      <dl className="space-y-3 text-[15px]">
        <div className="flex justify-between">
          <dt className="text-ink-soft">Foreløbig total</dt>
          <dd className="font-medium tabular-nums">
            {loading && !quote ? <Spinner /> : quote ? formatPrice(quote.totals.subtotal) : estimate ? `ca. ${formatPrice(estimate)}` : "–"}
          </dd>
        </div>
        {shipping && (
          <div className="flex justify-between text-sm text-muted">
            <dt>Fragt</dt>
            <dd className={loading ? "opacity-50" : ""}>{shipping}</dd>
          </div>
        )}
      </dl>
      <p className="mt-4 text-xs text-muted">
        {quote?.taxDisplay === "excl" ? "Priser er ekskl. moms." : "Alle priser er inkl. moms."} Priser og lager kontrolleres igen ved betaling.
      </p>
    </div>
  );
}

/** How far the goods (after discounts) are from free shipping, with a bar. */
export function FreeShippingProgress({ quote }: { quote: ClientQuote }) {
  const threshold = quote.freeShippingFrom;
  if (!threshold || !quote.needsShipping || quote.items.length === 0) return null;
  const goods = toMinorUnits(quote.totals.subtotal, 2) - toMinorUnits(quote.totals.discount, 2);
  const target = toMinorUnits(threshold, 2);
  const missing = target - goods;
  const percent = target > 0 ? Math.max(0, Math.min(100, Math.round((goods / target) * 100))) : 100;
  return (
    <div className="mb-4 rounded-[var(--radius-control)] bg-accent-soft/70 px-4 py-3">
      <p className="text-sm font-semibold text-ink" aria-live="polite">
        {missing > 0
          ? `Køb for ${formatPrice(fromMinorUnits(missing, 2))} mere, så får du fri fragt til pakkeshop.`
          : "Du har fri fragt til pakkeshop."}
      </p>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-white"
        role="progressbar"
        aria-label="Fri fragt"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className="h-full rounded-full bg-success transition-[width] duration-500" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/** Disabled until WooCommerce has confirmed every line (price, stock) without blocking errors. */
export function CheckoutButton({
  canCheckout,
  loading,
  onNavigate,
  children,
}: {
  canCheckout: boolean;
  loading: boolean;
  onNavigate?: () => void;
  children: ReactNode;
}) {
  return canCheckout ? (
    <ButtonLink href="/checkout" size="lg" full onNavigate={onNavigate}>
      {children}
    </ButtonLink>
  ) : (
    <button className="h-14 w-full cursor-not-allowed rounded-[var(--radius-control)] bg-ink/40 font-medium text-white" disabled>
      {loading ? "Opdaterer…" : children}
    </button>
  );
}
