"use client";

import { ExpressCheckoutElement, useElements, useStripe } from "@stripe/react-stripe-js";
import type {
  StripeExpressCheckoutElementConfirmEvent,
  StripeExpressCheckoutElementOptions,
  StripeExpressCheckoutElementShippingAddressChangeEvent,
  StripeExpressCheckoutElementShippingRateChangeEvent,
} from "@stripe/stripe-js";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { storeConfig } from "@/config/store";
import type { CartLine } from "@/lib/cart/cart";
import { expressCheckoutRequest, quoteAmount, walletPostcode, walletShippingRates } from "@/lib/checkout/express";
import type { ClientQuote } from "@/lib/checkout/quote";
import { checkoutRequestSchema } from "@/lib/validation/checkout";
import { TermsNotice } from "./legal-links";

type CheckoutResponse =
  | { type: "ready"; clientSecret: string; returnPath: string }
  | { type: "already_paid"; returnPath: string }
  | { type?: string; message?: string };

/**
 * "Hurtig betaling": Apple Pay and Google Pay buttons above the form. The wallet supplies
 * e-mail, address and shipping choice; prices, shipping and coupons are recalculated by
 * WooCommerce for the address the customer picks in the wallet sheet, and the order is
 * created through the same /api/checkout as the form.
 */
export function ExpressCheckout({ lines, quote }: { lines: CartLine[]; quote: ClientQuote }) {
  const router = useRouter();
  const stripe = useStripe();
  const elements = useElements();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The quote currently shown in the wallet sheet (the form's quote until the customer picks an address).
  const sheetQuote = useRef(quote);
  const sheetAddress = useRef<{ country?: string; postcode?: string; city?: string }>({});
  const inFlight = useRef(false);

  const options = useMemo<StripeExpressCheckoutElementOptions>(
    () => ({
      emailRequired: true,
      phoneNumberRequired: false,
      billingAddressRequired: true,
      shippingAddressRequired: quote.needsShipping,
      allowedShippingCountries: storeConfig.countries.map((c) => c.code),
      business: { name: storeConfig.name },
      buttonType: { applePay: "buy", googlePay: "buy" },
      buttonTheme: { applePay: "black", googlePay: "black" },
      buttonHeight: 48,
      layout: { maxColumns: 2, maxRows: 1, overflow: "auto" },
      // "always" also offers Apple Pay in Chrome on a Mac (paid with the iPhone) and shows the
      // buttons before a card is set up in the wallet.
      paymentMethods: { applePay: "always", googlePay: "always", link: "never", paypal: "never", amazonPay: "never", klarna: "never" },
      paymentMethodOrder: ["apple_pay", "google_pay"],
    }),
    [quote.needsShipping],
  );

  async function requestQuote(shippingRateId: string | null): Promise<ClientQuote> {
    const response = await fetch("/api/checkout/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: lines.map((l) => ({ productId: l.productId, variationId: l.variationId, quantity: l.quantity })),
        address: sheetAddress.current,
        shippingRateId,
        coupons: quote.coupons.map((c) => c.code),
      }),
    });
    if (!response.ok) throw new Error("quote failed");
    return (await response.json()) as ClientQuote;
  }

  async function onShippingAddressChange(event: StripeExpressCheckoutElementShippingAddressChangeEvent) {
    // Browsers only reveal country, postcode and city until the payment is approved.
    sheetAddress.current = {
      country: event.address.country,
      postcode: walletPostcode(event.address.postal_code) || undefined,
      city: event.address.city || undefined,
    };
    try {
      const next = await requestQuote(sheetQuote.current.shippingRateId);
      if (next.errors.length > 0 || (next.needsShipping && next.shippingRates.length === 0)) {
        event.reject();
        return;
      }
      sheetQuote.current = next;
      elements?.update({ amount: quoteAmount(next) });
      event.resolve({ shippingRates: walletShippingRates(next) });
    } catch {
      event.reject();
    }
  }

  async function onShippingRateChange(event: StripeExpressCheckoutElementShippingRateChangeEvent) {
    try {
      const next = await requestQuote(event.shippingRate.id);
      sheetQuote.current = next;
      elements?.update({ amount: quoteAmount(next) });
      event.resolve();
    } catch {
      event.reject();
    }
  }

  async function onConfirm(event: StripeExpressCheckoutElementConfirmEvent) {
    const fail = (message: string, reason: "fail" | "invalid_shipping_address" = "fail") => {
      event.paymentFailed({ reason, message });
      setError(message);
    };
    if (!stripe || !elements || inFlight.current) {
      event.paymentFailed({ reason: "fail" });
      return;
    }
    inFlight.current = true;
    setError(null);
    let navigating = false;

    try {
      const { error: submitError } = await elements.submit();
      if (submitError) return fail(submitError.message ?? "Betalingen kunne ikke startes.");

      const parsed = checkoutRequestSchema.safeParse(
        expressCheckoutRequest({
          lines,
          quote: sheetQuote.current,
          billingDetails: event.billingDetails ?? {},
          shippingAddress: event.shippingAddress,
          shippingRateId: event.shippingRate?.id,
        }),
      );
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const field = issue?.path.join(".") ?? "";
        return fail(
          `${issue?.message ?? "Adressen er ufuldstændig."} Ret adressen i ${event.expressPaymentType === "apple_pay" ? "Apple Pay" : "Google Pay"}, eller udfyld formularen nedenfor.`,
          field.startsWith("shipping") || field.startsWith("billing") ? "invalid_shipping_address" : "fail",
        );
      }

      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const data = (await response.json().catch(() => null)) as CheckoutResponse | null;

      if (data?.type === "already_paid" && "returnPath" in data) {
        navigating = true;
        router.push(data.returnPath);
        return;
      }
      if (data?.type !== "ready" || !("clientSecret" in data)) {
        return fail(
          data && "message" in data && data.message
            ? `${data.message} Prøv igen.`
            : "Betalingen kunne ikke startes. Prøv igen, eller udfyld formularen nedenfor.",
        );
      }

      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        clientSecret: data.clientSecret,
        confirmParams: { return_url: new URL(data.returnPath, window.location.origin).toString() },
        redirect: "if_required",
      });
      if (error) {
        setError(error.message ?? "Betalingen blev afvist.");
        return;
      }
      if (paymentIntent && ["succeeded", "processing", "requires_capture"].includes(paymentIntent.status)) {
        navigating = true;
        router.push(`${data.returnPath}&payment_intent=${encodeURIComponent(paymentIntent.id)}`);
        return;
      }
      setError("Betalingen blev ikke gennemført. Prøv igen.");
    } catch {
      fail("Ingen forbindelse. Kontrollér din internetforbindelse, og prøv igen.");
    } finally {
      if (!navigating) {
        inFlight.current = false;
        // Back to the form's total (the sheet may have priced another address or shipping rate).
        elements.update({ amount: quoteAmount(quote) });
      }
    }
  }

  if (available === false) return null;

  return (
    <section aria-labelledby="hurtig-betaling">
      <h2 id="hurtig-betaling" className="text-center text-sm text-muted">
        Hurtig betaling
      </h2>
      <div className="mt-3 min-h-12">
        <ExpressCheckoutElement
          options={options}
          onReady={({ availablePaymentMethods }) => setAvailable(Boolean(availablePaymentMethods))}
          onClick={(event) => {
            // Must answer within a second: use the quote already on screen.
            setError(null);
            sheetQuote.current = quote;
            sheetAddress.current = {};
            if (!quote.needsShipping) return event.resolve({});
            const shippingRates = walletShippingRates(quote);
            if (shippingRates.length === 0) {
              setError("Vi kan ikke beregne fragt lige nu. Udfyld formularen nedenfor.");
              return event.reject();
            }
            event.resolve({ shippingRates });
          }}
          onShippingAddressChange={onShippingAddressChange}
          onShippingRateChange={onShippingRateChange}
          onCancel={() => elements?.update({ amount: quoteAmount(quote) })}
          onConfirm={onConfirm}
        />
      </div>
      {error && (
        <div className="mt-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      {/* A wallet payment binds the customer without the form's pay button, so the terms are linked here too. */}
      <p className="mt-3 text-center text-xs leading-relaxed text-muted">
        <TermsNotice action="betale med Apple Pay eller Google Pay" />
      </p>
      <div className="mt-6 flex items-center gap-3 text-xs uppercase tracking-wider text-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        eller
        <span className="h-px flex-1 bg-line" />
      </div>
    </section>
  );
}
