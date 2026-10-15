"use client";

import { useCallback, useEffect, useState } from "react";
import type { CartLine } from "@/lib/cart/cart";
import type { ClientQuote } from "@/lib/checkout/quote";
import { isTemporaryQuoteFailure, quoteRetryDelay, type QuoteFailure } from "@/lib/checkout/quote-retry";

export type QuoteAddress = { country?: string; postcode?: string; city?: string; address1?: string };

type Result = { payload: string; attempt: number; quote: ClientQuote | null; error: string | null; failure: QuoteFailure | null };

/** Which attempt for which request is wanted; `manual` when the customer pressed "Prøv igen". */
type Attempt = { payload: string; attempt: number; manual: boolean };

/**
 * Fetches an authoritative quote (WooCommerce prices, stock, tax, shipping) for the cart.
 * Debounced; stale responses are discarded. While a new quote loads, the previous one
 * stays visible (dimmed by the UI) and payment is disabled.
 *
 * When WooCommerce is busy or the connection drops, the error is shown and the quote is asked
 * for again a couple of times in the background (see quote-retry.ts); `retry` asks right away.
 */
export function useQuote(
  lines: CartLine[],
  address: QuoteAddress,
  shippingRateId: string | null,
  enabled = true,
  /** Coupon codes, and the e-mail some coupons are restricted to. */
  coupons: { codes: string[]; email?: string } = { codes: [] },
) {
  const payload = JSON.stringify({
    items: lines.map((l) => ({ productId: l.productId, variationId: l.variationId, quantity: l.quantity })),
    address,
    shippingRateId,
    ...(coupons.codes.length > 0 ? { coupons: coupons.codes, email: coupons.email } : {}),
  });
  const active = enabled && lines.length > 0;

  const [wanted, setWanted] = useState<Attempt>({ payload, attempt: 0, manual: false });
  // A changed cart, address or coupon starts again at the first attempt.
  const current = wanted.payload === payload ? wanted : { payload, attempt: 0, manual: false };
  const attempt = current.attempt;

  const [result, setResult] = useState<Result | null>(null);
  const [override, setOverride] = useState<{ payload: string; quote: ClientQuote } | null>(null);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let retryTimer: number | undefined;

    const fail = (failure: QuoteFailure, error: string) => {
      setResult({ payload, attempt, quote: null, error, failure });
      const delay = quoteRetryDelay(failure, attempt);
      if (delay !== null) retryTimer = window.setTimeout(() => setWanted({ payload, attempt: attempt + 1, manual: false }), delay);
    };

    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/checkout/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          signal: controller.signal,
        });
        const data = await response.json().catch(() => null);
        // A newer request (another cart, address or attempt) has taken over.
        if (controller.signal.aborted) return;
        setOverride(null);
        if (response.ok) {
          setResult({ payload, attempt, quote: data as ClientQuote, error: null, failure: null });
        } else {
          fail({ status: response.status, code: typeof data?.code === "string" ? data.code : null }, data?.message ?? "Priserne kunne ikke beregnes.");
        }
      } catch {
        if (controller.signal.aborted) return;
        fail({ status: 0, code: "network" }, "Ingen forbindelse. Prøv igen.");
      }
    }, 350);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
      window.clearTimeout(retryTimer);
    };
  }, [payload, active, attempt]);

  const setQuote = useCallback((quote: ClientQuote) => setOverride({ payload, quote }), [payload]);
  const retry = useCallback(() => setWanted({ payload, attempt: attempt + 1, manual: true }), [payload, attempt]);

  const own = result?.payload === payload ? result : null;
  // Automatic retries run in the background, with the error still shown; "Prøv igen" shows progress.
  const loading = active && (!own || (current.manual && own.attempt !== attempt));
  const failure = active && own && !loading ? own.failure : null;

  return {
    quote: override?.payload === payload ? override.quote : (result?.quote ?? null),
    loading,
    error: active && own && !loading ? own.error : null,
    /** The error is an outage (WooCommerce busy or down, no connection), not a problem with the cart. */
    temporary: failure !== null && isTemporaryQuoteFailure(failure),
    /** Use a quote returned by /api/checkout (e.g. after a price change). */
    setQuote,
    /** Ask WooCommerce again now ("Prøv igen"). */
    retry,
  };
}
