"use client";

import { useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import type { ClientQuote } from "@/lib/checkout/quote";
import { formatPrice } from "@/lib/money";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Coupon codes for the checkout. WooCommerce decides whether a code applies: a requested
 * code that is missing from the latest quote is shown as rejected, with WooCommerce's reason.
 * Lives inside the payment form, so Enter applies the code instead of submitting the payment.
 * `id` keeps the input unique when the field appears in two places (summary and mobile form).
 */
export function CouponField({
  id,
  quote,
  loading,
  requested,
  onChange,
}: {
  id: string;
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
  const error = inputError ?? rejection ?? undefined;

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
    <div>
      <div className="flex items-start gap-3">
        <Field
          id={id}
          name={id}
          label="Rabatkode"
          className="min-w-0 flex-1"
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
          error={error}
        />
        <Button
          type="button"
          variant="secondary"
          className="h-[52px] shrink-0"
          onClick={apply}
          loading={checking}
          disabled={!checking && input.trim() === ""}
        >
          Brug
        </Button>
      </div>
      <p className="sr-only" aria-live="polite">
        {rejection ?? ""}
      </p>
      {applied.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Anvendte rabatkoder">
          {applied.map((coupon) => (
            <li
              key={coupon.code}
              className="flex items-center gap-2 rounded-full border border-line-strong bg-accent-soft/60 py-1 pl-3 pr-1 text-sm"
            >
              <svg viewBox="0 0 16 16" className="size-3.5 text-accent" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M2 2.5h5.2l6.3 6.3-4.7 4.7L2.5 7.2V2.5Z" strokeLinejoin="round" />
                <circle cx="5" cy="5.5" r="1" fill="currentColor" stroke="none" />
              </svg>
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
    </div>
  );
}
