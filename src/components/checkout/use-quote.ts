"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CartLine } from "@/lib/cart/cart";
import type { ClientQuote } from "@/lib/checkout/quote";

export type QuoteAddress = { country?: string; postcode?: string; city?: string; address1?: string };

type Result = { payload: string; quote: ClientQuote | null; error: string | null };

/**
 * Fetches an authoritative quote (WooCommerce prices, stock, tax, shipping) for the cart.
 * Debounced; stale responses are discarded. While a new quote loads, the previous one
 * stays visible (dimmed by the UI) and payment is disabled.
 */
export function useQuote(lines: CartLine[], address: QuoteAddress, shippingRateId: string | null, enabled = true) {
  const payload = JSON.stringify({
    items: lines.map((l) => ({ productId: l.productId, variationId: l.variationId, quantity: l.quantity })),
    address,
    shippingRateId,
  });
  const active = enabled && lines.length > 0;

  const [result, setResult] = useState<Result | null>(null);
  const [override, setOverride] = useState<{ payload: string; quote: ClientQuote } | null>(null);
  const latest = useRef(payload);

  useEffect(() => {
    latest.current = payload;
    if (!active) return;
    const controller = new AbortController();

    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/checkout/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          signal: controller.signal,
        });
        const data = await response.json().catch(() => null);
        if (latest.current !== payload) return;
        setOverride(null);
        setResult(
          response.ok
            ? { payload, quote: data as ClientQuote, error: null }
            : { payload, quote: null, error: data?.message ?? "Priserne kunne ikke beregnes." },
        );
      } catch {
        if (controller.signal.aborted || latest.current !== payload) return;
        setResult({ payload, quote: null, error: "Ingen forbindelse. Prøv igen." });
      }
    }, 350);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [payload, active]);

  const setQuote = useCallback((quote: ClientQuote) => setOverride({ payload, quote }), [payload]);

  return {
    quote: override?.payload === payload ? override.quote : (result?.quote ?? null),
    loading: active && result?.payload !== payload,
    error: active && result?.payload === payload ? result.error : null,
    /** Use a quote returned by /api/checkout (e.g. after a price change). */
    setQuote,
  };
}
