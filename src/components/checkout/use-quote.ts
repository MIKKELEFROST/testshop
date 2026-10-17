"use client";

import { useCallback, useEffect, useState } from "react";
import type { CartLine } from "@/lib/cart/cart";
import type { ClientQuote } from "@/lib/checkout/quote";
import { isTemporaryQuoteFailure, quoteRetryDelay, retryAfterMs, type QuoteFailure } from "@/lib/checkout/quote-retry";

export type QuoteAddress = { country?: string; postcode?: string; city?: string; address1?: string };

type Result = { payload: string; attempt: number; quote: ClientQuote | null; error: string | null; failure: QuoteFailure | null };

/** Which attempt for which request is wanted; `manual` when the customer pressed "Prøv igen". */
export type Attempt = { payload: string; attempt: number; manual: boolean };

/**
 * Fetches an authoritative quote (WooCommerce prices, stock, tax, shipping) for the cart.
 * Debounced; stale responses are discarded. While a new quote loads, the previous one
 * stays visible (dimmed by the UI) and payment is disabled.
 *
 * When WooCommerce is too busy or the connection drops, the error is shown and the quote is
 * asked for once more in the background (see quote-retry.ts); `retry` asks right away.
 */
export function useQuote(
  lines: CartLine[],
  address: QuoteAddress,
  shippingRateId: string | null,
  enabled = true,
  /** Coupon codes, and the e-mail some coupons are restricted to. */
  coupons: { codes: string[]; email?: string } = { codes: [] },
) {
  const payload = quotePayload(lines, address, shippingRateId, coupons);
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
          rememberQuote(payload, data as ClientQuote);
          setResult({ payload, attempt, quote: data as ClientQuote, error: null, failure: null });
        } else {
          fail(
            { status: response.status, code: typeof data?.code === "string" ? data.code : null, retryAfterMs: retryAfterMs(response.headers.get("Retry-After")) },
            data?.message ?? "Priserne kunne ikke beregnes.",
          );
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

  const { loading, retrying, shown } = quoteProgress(active, current, result?.payload === payload ? result : null);

  return {
    quote: override?.payload === payload ? override.quote : (result?.quote ?? null),
    loading,
    /** Also kept while "Prøv igen" runs, so its button stays where the customer pressed it. */
    error: shown?.error ?? null,
    /** "Prøv igen" was pressed and its answer is not here yet. */
    retrying,
    /** The error is an outage (WooCommerce busy or down, no connection), not a problem with the cart. */
    temporary: shown?.failure ? isTemporaryQuoteFailure(shown.failure) : false,
    /** Use a quote returned by /api/checkout (e.g. after a price change). */
    setQuote,
    /** Ask WooCommerce again now ("Prøv igen"). */
    retry,
  };
}

/** The body of a /api/checkout/quote request: the same cart, address and coupons give the same text. */
export function quotePayload(
  lines: Pick<CartLine, "productId" | "variationId" | "quantity">[],
  address: QuoteAddress,
  shippingRateId: string | null,
  coupons: { codes: string[]; email?: string } = { codes: [] },
): string {
  return JSON.stringify({
    items: lines.map((l) => ({ productId: l.productId, variationId: l.variationId, quantity: l.quantity })),
    address,
    shippingRateId,
    ...(coupons.codes.length > 0 ? { coupons: coupons.codes, email: coupons.email } : {}),
  });
}

/**
 * Quotes this tab received in the last 2 minutes, by request body. The checkout's wallet
 * buttons open with the cart's quote for ESTIMATE_ADDRESS from here (the cart and the drawer
 * ask for it) instead of asking WooCommerce again; the wallet sheet is priced anew as soon as
 * the customer's address is known, and the server checks the total before payment.
 */
const recentQuotes = new Map<string, { quote: ClientQuote; at: number }>();
const RECENT_QUOTE_MS = 2 * 60_000;

export function rememberQuote(payload: string, quote: ClientQuote, now = Date.now()) {
  recentQuotes.delete(payload);
  recentQuotes.set(payload, { quote, at: now });
  // A few are plenty (the cart's, the checkout's, the wallet's); the oldest go first.
  for (const key of recentQuotes.keys()) {
    if (recentQuotes.size <= 8) break;
    recentQuotes.delete(key);
  }
}

export function recentQuote(payload: string, now = Date.now()): ClientQuote | null {
  const entry = recentQuotes.get(payload);
  return entry && now - entry.at < RECENT_QUOTE_MS ? entry.quote : null;
}

/**
 * Whether the quote for the current request is loading, and which answer to show (`own`: the
 * last answer for this cart and address). Automatic retries run in the background with the
 * error still shown; "Prøv igen" shows progress (`retrying`), but keeps the error and its
 * button, so keyboard and screen reader focus is not lost.
 */
export function quoteProgress(
  active: boolean,
  current: Attempt,
  own: Pick<Result, "attempt" | "error" | "failure"> | null,
): { loading: boolean; retrying: boolean; shown: Pick<Result, "error" | "failure"> | null } {
  const loading = active && (!own || (current.manual && own.attempt !== current.attempt));
  const retrying = loading && own !== null && own.error !== null;
  return { loading, retrying, shown: active && own && (!loading || retrying) ? own : null };
}
