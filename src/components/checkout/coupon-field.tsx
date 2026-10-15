"use client";

import { useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import type { ClientQuote } from "@/lib/checkout/quote";
import { formatPrice } from "@/lib/money";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Coupon codes for the checkout. WooCommerce decides whether a code applies: a requested
 * code that is missing from the latest quote is shown as rejected, with WooCommerce's reason.
 * Lives inside the payment form, so Enter applies the code instead of submitting the payment.
 */
export function CouponField({
  quote,
  loading,
  requested,
  onChange,
}: {
  quote: ClientQuote | null;
  loading: boolean;
  requested: string[];
  onChange: (codes: string[]) => void;
}) {
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);

  const applied = quote?.coupons ?? [];
  const isApplied = (code: string) => applied.some((c) => same(c.code, code));
  const unresolved = requested.filter((code) => !isApplied(code));
  const checking = loading && unresolved.length > 0;
  const rejected = !loading && quote ? unresolved : [];
  const rejection = rejected[0]
    ? (quote?.couponErrors.find((e) => same(e.code, rejected[0]!))?.message ?? `Rabatkoden "${rejected[0]}" kan ikke bruges.`)
    : null;
  const error = inputError ?? rejection;

  function apply() {
    const code = input.trim();
    if (!code) {
      setInputError("Indtast en rabatkode.");
      return;
    }
    setInputError(null);
    setInput("");
    // A new code replaces earlier rejected ones.
    if (!requested.some((c) => same(c, code))) onChange([...requested.filter(isApplied), code]);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    apply();
  }

  return (
    <section aria-labelledby="rabatkode">
      <label id="rabatkode" htmlFor="couponCode" className="mb-1.5 block text-sm font-medium text-ink-soft">
        Rabatkode (valgfrit)
      </label>
      <div className="flex gap-3">
        <input
          id="couponCode"
          name="couponCode"
          value={input}
          maxLength={100}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          onChange={(e) => {
            setInput(e.target.value);
            setInputError(null);
            // Typing a new code clears the rejected one.
            if (rejected.length > 0) onChange(requested.filter(isApplied));
          }}
          onKeyDown={onKeyDown}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "couponCode-error" : undefined}
          className={`h-12 min-w-0 flex-1 rounded-[var(--radius-control)] border bg-surface px-3.5 text-[15px] text-ink outline-none transition-colors focus:border-ink focus:ring-1 focus:ring-ink ${
            error ? "border-danger" : "border-line-strong"
          }`}
        />
        <Button type="button" variant="secondary" className="h-12" onClick={apply} loading={checking}>
          Anvend
        </Button>
      </div>
      {error && (
        <p id="couponCode-error" role="alert" className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      )}
      {applied.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Anvendte rabatkoder">
          {applied.map((coupon) => (
            <li
              key={coupon.code}
              className="flex items-center gap-2 rounded-full border border-line-strong bg-accent-soft/60 py-1 pl-3 pr-1 text-sm"
            >
              <span className="font-medium uppercase tracking-wide">{coupon.code}</span>
              {Number(coupon.discount) > 0 && <span className="tabular-nums text-ink-soft">−{formatPrice(coupon.discount)}</span>}
              <button
                type="button"
                onClick={() => onChange(requested.filter((c) => !same(c, coupon.code)))}
                className="flex size-7 items-center justify-center rounded-full text-ink-soft hover:bg-black/5 hover:text-ink"
                aria-label={`Fjern rabatkoden ${coupon.code}`}
              >
                <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
