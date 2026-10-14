"use client";

import Link from "next/link";
import { useCart } from "@/components/cart/cart-provider";
import { useQuote } from "@/components/checkout/use-quote";
import { ProductImage } from "@/components/products/product-image";
import { QuantityStepper } from "@/components/products/product-detail";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { storeConfig } from "@/config/store";
import { formatPrice, multiplyAmount } from "@/lib/money";

export function CartView() {
  const { lines, hydrated, setQuantity, remove } = useCart();
  const { quote, loading, error } = useQuote(lines, { country: storeConfig.defaultCountry }, null, hydrated);

  if (!hydrated) {
    return <div className="mt-8 h-40 animate-pulse rounded-[var(--radius-card)] bg-black/5" aria-hidden="true" />;
  }

  if (lines.length === 0) {
    return (
      <div className="mt-10 rounded-[var(--radius-card)] border border-line bg-surface px-6 py-16 text-center">
        <p className="text-lg font-medium">Din kurv er tom</p>
        <p className="mt-2 text-muted">Find noget, du kan lide, og læg det i kurven.</p>
        <div className="mt-6">
          <ButtonLink href="/produkter">Se alle produkter</ButtonLink>
        </div>
      </div>
    );
  }

  const blocking = quote?.errors ?? [];
  const canCheckout = Boolean(quote) && blocking.length === 0 && !loading && !error;

  return (
    <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_380px]">
      <ul className="divide-y divide-line border-y border-line">
        {lines.map((line) => {
          const quoted = quote?.items.find((i) => i.productId === line.productId && i.variationId === line.variationId);
          const lineError = blocking.find((e) => e.productId === line.productId && e.variationId === line.variationId);
          const unitPrice = quoted?.unitPrice ?? line.unitPrice;
          const priceChanged = quoted && line.unitPrice && quoted.unitPrice !== line.unitPrice;

          return (
            <li key={line.key} className="flex gap-4 py-5">
              <Link
                href={`/produkter/${line.slug}`}
                className="relative aspect-[4/5] w-24 shrink-0 overflow-hidden rounded-xl bg-[#efe9e1] sm:w-28"
              >
                <ProductImage image={line.image ?? null} name={line.name} sizes="112px" />
              </Link>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex justify-between gap-4">
                  <div className="min-w-0">
                    <Link href={`/produkter/${line.slug}`} className="font-medium hover:underline">
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
                  <button onClick={() => remove(line.key)} className="text-sm text-muted underline underline-offset-4 hover:text-ink">
                    Fjern
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <aside className="h-fit rounded-[var(--radius-card)] border border-line bg-surface p-6 lg:sticky lg:top-28" aria-labelledby="kurv-oversigt">
        <h2 id="kurv-oversigt" className="text-lg font-semibold">
          Oversigt
        </h2>
        <dl className="mt-4 space-y-3 text-[15px]">
          <div className="flex justify-between">
            <dt className="text-ink-soft">Foreløbig total</dt>
            <dd className="font-medium tabular-nums">
              {loading && !quote ? <Spinner /> : quote ? formatPrice(quote.totals.subtotal) : "–"}
            </dd>
          </div>
          <div className="flex justify-between text-sm text-muted">
            <dt>Fragt</dt>
            <dd>Beregnes ved kassen</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-muted">
          {quote?.taxDisplay === "excl" ? "Priser er ekskl. moms." : "Alle priser er inkl. moms."} Priser og lager kontrolleres igen ved betaling.
        </p>

        {error && (
          <div className="mt-4">
            <Alert tone="error">{error}</Alert>
          </div>
        )}

        <div className="mt-6">
          {canCheckout ? (
            <ButtonLink href="/checkout" size="lg" full>
              Gå til kassen
            </ButtonLink>
          ) : (
            <button className="h-14 w-full cursor-not-allowed rounded-[var(--radius-control)] bg-ink/40 font-medium text-white" disabled>
              {loading ? "Opdaterer…" : "Gå til kassen"}
            </button>
          )}
        </div>
        <Link href="/produkter" className="mt-4 block text-center text-sm text-muted underline underline-offset-4 hover:text-ink">
          Fortsæt med at handle
        </Link>
      </aside>
    </div>
  );
}
