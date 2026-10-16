"use client";

import type { ReactNode } from "react";
import { ProductImage } from "@/components/products/product-image";
import { Spinner } from "@/components/ui/spinner";
import type { CartLine } from "@/lib/cart/cart";
import type { ClientQuote } from "@/lib/checkout/quote";
import { formatPrice } from "@/lib/money";

/** Order summary built only from the WooCommerce quote (never from client-side prices). */
export function OrderSummary({
  lines,
  quote,
  loading,
  addressComplete,
  coupon,
}: {
  lines: CartLine[];
  quote: ClientQuote | null;
  loading: boolean;
  addressComplete: boolean;
  /** Coupon field, shown between the items and the totals. */
  coupon?: ReactNode;
}) {
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  const shipping =
    !addressComplete || !quote?.shippingRateId
      ? "Angiv leveringsadresse"
      : Number(quote.totals.shipping) === 0
        ? "Gratis"
        : formatPrice(quote.totals.shipping);

  return (
    <div aria-busy={loading || undefined}>
      <ul className="space-y-4">
        {lines.map((line) => {
          const quoted = quote?.items.find((i) => i.productId === line.productId && i.variationId === line.variationId);
          return (
            <li key={line.key} className="flex items-center gap-4">
              <div className="relative shrink-0">
                <div className="relative size-16 overflow-hidden rounded-xl border border-line bg-surface">
                  <ProductImage image={line.image ?? null} name={line.name} sizes="64px" decorative />
                </div>
                <span className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-white">
                  {line.quantity}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{line.name}</p>
                {line.variantLabel && <p className="truncate text-xs text-muted">{line.variantLabel}</p>}
              </div>
              <p className="shrink-0 text-sm tabular-nums">
                {quoted ? formatPrice(quoted.lineTotal) : <span className="text-muted">–</span>}
              </p>
            </li>
          );
        })}
      </ul>

      {coupon && <div className="mt-6">{coupon}</div>}

      <dl className="mt-6 space-y-2.5 text-sm">
        <Row
          label={`Subtotal · ${itemCount} ${itemCount === 1 ? "vare" : "varer"}`}
          value={quote ? formatPrice(quote.totals.subtotal) : null}
          loading={loading}
        />
        {quote && Number(quote.totals.discount) > 0 && (
          <Row
            label={quote.coupons.length > 0 ? `Rabat (${quote.coupons.map((c) => c.code.toUpperCase()).join(", ")})` : "Rabat"}
            value={`−${formatPrice(quote.totals.discount)}`}
            loading={loading}
          />
        )}
        {quote?.needsShipping !== false && <Row label="Levering" value={shipping} muted={!addressComplete} loading={loading} />}
        <div className="flex items-baseline justify-between gap-4 pt-3">
          <dt className="text-lg font-semibold">I alt</dt>
          <dd className="flex items-baseline gap-2">
            {quote && <span className="text-xs text-muted">{quote.currency}</span>}
            <span className={`text-xl font-semibold tabular-nums ${loading && quote ? "opacity-50" : ""}`}>
              {loading && !quote ? <Spinner /> : quote ? formatPrice(quote.totals.total) : "–"}
            </span>
          </dd>
        </div>
        {quote && (
          <p className="text-xs text-muted">Inklusiv {formatPrice(quote.totals.tax)} i moms</p>
        )}
      </dl>
    </div>
  );
}

function Row({ label, value, muted, loading }: { label: string; value: string | null; muted?: boolean; loading?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-soft">{label}</dt>
      <dd className={`text-right tabular-nums ${muted ? "text-muted" : ""} ${loading ? "opacity-50" : ""}`}>{value ?? "–"}</dd>
    </div>
  );
}
