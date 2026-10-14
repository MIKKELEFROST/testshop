"use client";

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
}: {
  lines: CartLine[];
  quote: ClientQuote | null;
  loading: boolean;
  addressComplete: boolean;
}) {
  return (
    <div aria-busy={loading || undefined}>
      <ul className="space-y-4">
        {lines.map((line) => {
          const quoted = quote?.items.find((i) => i.productId === line.productId && i.variationId === line.variationId);
          return (
            <li key={line.key} className="flex items-center gap-4">
              <div className="relative">
                <div className="relative size-16 overflow-hidden rounded-xl border border-line bg-[#efe9e1]">
                  <ProductImage image={line.image ?? null} name={line.name} sizes="64px" />
                </div>
                <span className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full bg-ink-soft text-[11px] font-semibold text-white">
                  {line.quantity}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{line.name}</p>
                {line.variantLabel && <p className="truncate text-xs text-muted">{line.variantLabel}</p>}
              </div>
              <p className="text-sm tabular-nums">{quoted ? formatPrice(quoted.lineTotal) : <span className="text-muted">–</span>}</p>
            </li>
          );
        })}
      </ul>

      <dl className="mt-6 space-y-2.5 border-t border-line pt-5 text-sm">
        <Row label="Subtotal" value={quote ? formatPrice(quote.totals.subtotal) : null} loading={loading} />
        {quote && Number(quote.totals.discount) > 0 && <Row label="Rabat" value={`−${formatPrice(quote.totals.discount)}`} />}
        {quote?.needsShipping !== false && (
          <Row
            label="Fragt"
            value={
              !addressComplete || !quote?.shippingRateId
                ? "Beregnes ud fra adresse"
                : Number(quote.totals.shipping) === 0
                  ? "Gratis"
                  : formatPrice(quote.totals.shipping)
            }
            muted={!addressComplete}
            loading={loading}
          />
        )}
        <div className="flex items-baseline justify-between border-t border-line pt-4">
          <dt className="text-base font-semibold">Total</dt>
          <dd className="text-xl font-semibold tabular-nums">
            {loading && !quote ? <Spinner /> : quote ? formatPrice(quote.totals.total) : "–"}
          </dd>
        </div>
        {quote && (
          <p className="text-right text-xs text-muted">
            {quote.taxDisplay === "incl" ? "Heraf moms" : "Moms"} {formatPrice(quote.totals.tax)}
          </p>
        )}
      </dl>
    </div>
  );
}

function Row({ label, value, muted, loading }: { label: string; value: string | null; muted?: boolean; loading?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-soft">{label}</dt>
      <dd className={`tabular-nums ${muted ? "text-muted" : ""} ${loading ? "opacity-50" : ""}`}>{value ?? "–"}</dd>
    </div>
  );
}
