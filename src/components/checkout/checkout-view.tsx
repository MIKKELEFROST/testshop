"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import type { StripeElementsOptions } from "@stripe/stripe-js";
import Link from "next/link";
import type { ZodType } from "zod";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useCart } from "@/components/cart/cart-provider";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Field, SelectField } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { storeConfig } from "@/config/store";
import type { ClientQuote } from "@/lib/checkout/quote";
import { formatPrice, stripeCurrencyExponent, toMinorUnits } from "@/lib/money";
import { getStripeClient } from "@/lib/stripe/client";
import { addressSchema, checkoutRequestSchema, contactSchema, fieldErrors, postcodeSchema } from "@/lib/validation/checkout";
import { OrderSummary } from "./order-summary";
import { useQuote } from "./use-quote";

type Address = {
  firstName: string;
  lastName: string;
  company: string;
  address1: string;
  address2: string;
  postcode: string;
  city: string;
  country: string;
};

const emptyAddress: Address = {
  firstName: "",
  lastName: "",
  company: "",
  address1: "",
  address2: "",
  postcode: "",
  city: "",
  country: storeConfig.defaultCountry,
};

const appearance: StripeElementsOptions["appearance"] = {
  theme: "stripe",
  variables: {
    colorPrimary: "#1d1b19",
    colorText: "#1d1b19",
    colorDanger: "#b42318",
    colorBackground: "#ffffff",
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif",
    borderRadius: "12px",
    spacingUnit: "4px",
  },
  rules: {
    ".Input": { borderColor: "#d4cdc4", boxShadow: "none", padding: "13px 14px" },
    ".Input:focus": { borderColor: "#1d1b19", boxShadow: "0 0 0 1px #1d1b19" },
  },
};

export function CheckoutView() {
  const stripePromise = useMemo(() => getStripeClient(), []);
  const [stripeFailed, setStripeFailed] = useState(false);
  useEffect(() => {
    void stripePromise?.then((stripe) => {
      if (!stripe) setStripeFailed(true);
    });
  }, [stripePromise]);
  const [options] = useState<StripeElementsOptions>(() => ({
    mode: "payment",
    // Placeholder until the first WooCommerce quote arrives; updated via elements.update().
    amount: 100,
    currency: storeConfig.currency.toLowerCase(),
    appearance,
    locale: "da",
  }));

  if (!stripePromise) {
    return (
      <div className="mt-8">
        <Alert tone="error" title="Betaling er ikke konfigureret">
          NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY mangler. Se README for opsætning.
        </Alert>
      </div>
    );
  }

  return (
    <Elements stripe={stripePromise} options={options}>
      <CheckoutForm stripeFailed={stripeFailed} />
    </Elements>
  );
}

function CheckoutForm({ stripeFailed }: { stripeFailed: boolean }) {
  const router = useRouter();
  const stripe = useStripe();
  const elements = useElements();
  const { lines, hydrated } = useCart();

  const [contact, setContact] = useState({ email: "", phone: "" });
  const [shipping, setShipping] = useState<Address>(emptyAddress);
  const [billingSame, setBillingSame] = useState(true);
  const [billing, setBilling] = useState<Address>(emptyAddress);
  const [note, setNote] = useState("");
  const [shippingRateId, setShippingRateId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [paymentReady, setPaymentReady] = useState(false);
  const inFlight = useRef(false);

  const postcodeValid = postcodeSchema.safeParse(shipping.postcode).success;
  const { quote, loading: quoteLoading, error: quoteError, setQuote } = useQuote(
    lines,
    {
      country: shipping.country,
      postcode: postcodeValid ? shipping.postcode : undefined,
      city: postcodeValid ? shipping.city || undefined : undefined,
      address1: postcodeValid ? shipping.address1 || undefined : undefined,
    },
    shippingRateId,
    hydrated,
  );

  // Follow WooCommerce's choice when the selected rate is not (or no longer) available.
  const quotedRateId = quote?.shippingRateId ?? null;
  const selectedRateId = quote && quote.shippingRates.some((r) => r.id === shippingRateId) ? shippingRateId : quotedRateId;

  const amountMinor = quote ? toMinorUnits(quote.totals.total, stripeCurrencyExponent(quote.currency)) : null;
  useEffect(() => {
    if (elements && amountMinor && amountMinor > 0) elements.update({ amount: amountMinor });
  }, [elements, amountMinor]);

  if (!hydrated) return <div className="mt-8 h-96 animate-pulse rounded-[var(--radius-card)] bg-black/5" aria-hidden="true" />;

  if (lines.length === 0) {
    return (
      <div className="mt-10 rounded-[var(--radius-card)] border border-line bg-surface px-6 py-16 text-center">
        <p className="text-lg font-medium">Din kurv er tom</p>
        <div className="mt-6">
          <ButtonLink href="/produkter">Se alle produkter</ButtonLink>
        </div>
      </div>
    );
  }

  const quoteErrors = quote?.errors ?? [];
  const needsAddressForShipping = quote?.needsShipping && quote.shippingRates.length === 0;
  const payDisabled =
    submitting || !stripe || !elements || !paymentReady || !quote || quoteLoading || quoteErrors.length > 0 || Boolean(needsAddressForShipping && postcodeValid);

  function validateField(scope: "contact" | "shipping" | "billing", field: string, value: string) {
    const shape: Record<string, ZodType> = scope === "contact" ? contactSchema.shape : addressSchema.shape;
    const schema = shape[field];
    if (!schema) return;
    const result = schema.safeParse(value);
    setErrors((current) => {
      const next = { ...current };
      const key = `${scope}.${field}`;
      if (result.success) delete next[key];
      else next[key] = result.error.issues[0]?.message ?? "Ugyldig værdi.";
      return next;
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return; // Double-click protection (the server is idempotent too).
    setFormError(null);
    setNotice(null);

    const payload = {
      items: lines.map((l) => ({ productId: l.productId, variationId: l.variationId, quantity: l.quantity })),
      contact,
      shipping,
      billingSameAsShipping: billingSame,
      billing: billingSame ? undefined : billing,
      shippingRateId: quote?.needsShipping ? selectedRateId : null,
      expectedTotal: quote?.totals.total ?? "",
      customerNote: note,
    };

    const parsed = checkoutRequestSchema.safeParse(payload);
    if (!parsed.success) {
      const fields = fieldErrors(parsed.error);
      setErrors(fields);
      focusFirstError(fields);
      return;
    }
    if (!stripe || !elements || !quote) return;

    inFlight.current = true;
    setSubmitting(true);
    let navigating = false;

    try {
      const { error: submitError } = await elements.submit();
      if (submitError) {
        setFormError(submitError.message ?? "Kontrollér betalingsoplysningerne.");
        return;
      }

      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const data = (await response.json().catch(() => null)) as CheckoutResponse | null;

      if (!data) {
        setFormError("Der opstod en fejl. Prøv igen.");
        return;
      }

      if (data.type === "ready") {
        const billingAddress = billingSame ? shipping : billing;
        const { error, paymentIntent } = await stripe.confirmPayment({
          elements,
          clientSecret: data.clientSecret,
          confirmParams: {
            return_url: new URL(data.returnPath, window.location.origin).toString(),
            payment_method_data: {
              billing_details: {
                name: `${billingAddress.firstName} ${billingAddress.lastName}`.trim(),
                email: contact.email,
                phone: contact.phone || undefined,
                address: {
                  line1: billingAddress.address1,
                  line2: billingAddress.address2 || "",
                  postal_code: billingAddress.postcode,
                  city: billingAddress.city,
                  country: billingAddress.country,
                  state: "",
                },
              },
            },
          },
          redirect: "if_required",
        });

        if (error) {
          setFormError(
            error.type === "card_error" || error.type === "validation_error"
              ? (error.message ?? "Betalingen blev afvist.")
              : "Betalingen kunne ikke gennemføres. Prøv igen eller vælg en anden betalingsmetode.",
          );
          return;
        }

        if (paymentIntent && ["succeeded", "processing", "requires_capture"].includes(paymentIntent.status)) {
          navigating = true;
          router.push(`${data.returnPath}&payment_intent=${encodeURIComponent(paymentIntent.id)}`);
          return;
        }
        setFormError("Betalingen blev ikke gennemført. Prøv igen.");
        return;
      }

      if (data.type === "already_paid") {
        navigating = true;
        router.push(data.returnPath);
        return;
      }

      if (data.type === "total_changed") {
        if (data.quote) setQuote(data.quote);
        setNotice("Prisen er ændret, siden du åbnede kassen. Kontrollér den nye total, og tryk på Betal igen.");
        return;
      }

      if ((data.type === "cart_invalid" || data.type === "out_of_stock") && data.quote) setQuote(data.quote);
      if (data.fields) setErrors(data.fields);
      setFormError(data.message ?? "Betalingen kunne ikke startes.");
    } catch {
      setFormError("Ingen forbindelse. Kontrollér din internetforbindelse, og prøv igen.");
    } finally {
      if (!navigating) {
        inFlight.current = false;
        setSubmitting(false);
      }
    }
  }

  const addressFields = (scope: "shipping" | "billing", value: Address, set: (a: Address) => void) => (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field
        label="Fornavn"
        name={`${scope}.firstName`}
        autoComplete={`${scope} given-name`}
        value={value.firstName}
        onChange={(e) => set({ ...value, firstName: e.target.value })}
        onBlur={(e) => validateField(scope, "firstName", e.target.value)}
        error={errors[`${scope}.firstName`]}
        required
      />
      <Field
        label="Efternavn"
        name={`${scope}.lastName`}
        autoComplete={`${scope} family-name`}
        value={value.lastName}
        onChange={(e) => set({ ...value, lastName: e.target.value })}
        onBlur={(e) => validateField(scope, "lastName", e.target.value)}
        error={errors[`${scope}.lastName`]}
        required
      />
      <Field
        className="sm:col-span-2"
        label="Adresse"
        name={`${scope}.address1`}
        autoComplete={`${scope} address-line1`}
        value={value.address1}
        onChange={(e) => set({ ...value, address1: e.target.value })}
        onBlur={(e) => validateField(scope, "address1", e.target.value)}
        error={errors[`${scope}.address1`]}
        required
      />
      <Field
        className="sm:col-span-2"
        label="Etage, lejlighed m.m. (valgfrit)"
        name={`${scope}.address2`}
        autoComplete={`${scope} address-line2`}
        value={value.address2}
        onChange={(e) => set({ ...value, address2: e.target.value })}
      />
      <Field
        label="Postnummer"
        name={`${scope}.postcode`}
        autoComplete={`${scope} postal-code`}
        inputMode="numeric"
        maxLength={4}
        value={value.postcode}
        onChange={(e) => set({ ...value, postcode: e.target.value.replace(/\D/g, "") })}
        onBlur={(e) => validateField(scope, "postcode", e.target.value)}
        error={errors[`${scope}.postcode`]}
        required
      />
      <Field
        label="By"
        name={`${scope}.city`}
        autoComplete={`${scope} address-level2`}
        value={value.city}
        onChange={(e) => set({ ...value, city: e.target.value })}
        onBlur={(e) => validateField(scope, "city", e.target.value)}
        error={errors[`${scope}.city`]}
        required
      />
      <SelectField
        className="sm:col-span-2"
        label="Land"
        name={`${scope}.country`}
        autoComplete={`${scope} country`}
        value={value.country}
        onChange={(e) => set({ ...value, country: e.target.value })}
        error={errors[`${scope}.country`]}
      >
        {storeConfig.countries.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </SelectField>
    </div>
  );

  const summary = (
    <OrderSummary lines={lines} quote={quote} loading={quoteLoading} addressComplete={postcodeValid} />
  );

  return (
    <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-14">
      <details className="group rounded-[var(--radius-card)] border border-line bg-surface lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between p-4 text-sm font-medium">
          <span className="underline underline-offset-4 group-open:hidden">Vis ordreoversigt</span>
          <span className="hidden underline underline-offset-4 group-open:inline">Skjul ordreoversigt</span>
          <span className="text-base tabular-nums">{quote ? formatPrice(quote.totals.total) : ""}</span>
        </summary>
        <div className="border-t border-line p-4">{summary}</div>
      </details>

      <form onSubmit={handleSubmit} noValidate className="space-y-10">
        <section aria-labelledby="kontakt">
          <h2 id="kontakt" className="text-lg font-semibold">
            Kontakt
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field
              className="sm:col-span-2"
              label="E-mail"
              name="contact.email"
              type="email"
              autoComplete="email"
              value={contact.email}
              onChange={(e) => setContact({ ...contact, email: e.target.value })}
              onBlur={(e) => validateField("contact", "email", e.target.value)}
              error={errors["contact.email"]}
              hint="Vi sender ordrebekræftelsen hertil."
              required
            />
            <Field
              className="sm:col-span-2"
              label="Telefon (valgfrit)"
              name="contact.phone"
              type="tel"
              autoComplete="tel"
              value={contact.phone}
              onChange={(e) => setContact({ ...contact, phone: e.target.value })}
              onBlur={(e) => validateField("contact", "phone", e.target.value)}
              error={errors["contact.phone"]}
              hint="Bruges kun til fragtfirmaets levering."
            />
          </div>
        </section>

        <section aria-labelledby="levering">
          <h2 id="levering" className="text-lg font-semibold">
            Levering
          </h2>
          <div className="mt-4">{addressFields("shipping", shipping, setShipping)}</div>
        </section>

        {quote?.needsShipping !== false && (
          <section aria-labelledby="fragt">
            <h2 id="fragt" className="text-lg font-semibold">
              Fragtmetode
            </h2>
            <div className="mt-4">
              {!postcodeValid ? (
                <p className="rounded-[var(--radius-control)] border border-dashed border-line-strong px-4 py-5 text-sm text-muted">
                  Indtast din adresse for at se fragtmuligheder.
                </p>
              ) : !quote && quoteLoading ? (
                <div className="flex items-center gap-2 px-1 py-5 text-sm text-muted">
                  <Spinner /> Henter fragtmuligheder…
                </div>
              ) : quote && quote.shippingRates.length === 0 ? (
                <Alert tone="warning">Vi kan desværre ikke levere til den adresse.</Alert>
              ) : (
                <fieldset className="overflow-hidden rounded-[var(--radius-control)] border border-line-strong bg-surface">
                  <legend className="sr-only">Vælg fragtmetode</legend>
                  {quote?.shippingRates.map((rate) => (
                    <label
                      key={rate.id}
                      className={`flex cursor-pointer items-center gap-3 border-b border-line px-4 py-4 last:border-b-0 ${
                        selectedRateId === rate.id ? "bg-accent-soft/60" : ""
                      }`}
                    >
                      <input
                        type="radio"
                        name="shippingRate"
                        value={rate.id}
                        checked={selectedRateId === rate.id}
                        onChange={() => setShippingRateId(rate.id)}
                        className="size-4 accent-ink"
                      />
                      <span className="flex-1 text-[15px]">{rate.label}</span>
                      <span className="text-[15px] font-medium tabular-nums">
                        {Number(rate.price) === 0 ? "Gratis" : formatPrice(rate.price)}
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
            </div>
          </section>
        )}

        <section aria-labelledby="betaling">
          <h2 id="betaling" className="text-lg font-semibold">
            Betaling
          </h2>
          <p className="mt-1 text-sm text-muted">Alle transaktioner er krypterede og håndteres af Stripe.</p>
          <div className="mt-4 rounded-[var(--radius-control)] border border-line-strong bg-surface p-4">
            {stripeFailed ? (
              <Alert tone="error" title="Betalingsformularen kunne ikke indlæses">
                Kontrollér din internetforbindelse, slå eventuelle annonceblokkere fra, og genindlæs siden.
              </Alert>
            ) : !paymentReady && (
              <div className="flex items-center gap-2 py-6 text-sm text-muted">
                <Spinner /> Indlæser betalingsmetoder…
              </div>
            )}
            <PaymentElement
              onReady={() => setPaymentReady(true)}
              onLoadError={() => setFormError("Betalingsformularen kunne ikke indlæses. Genindlæs siden.")}
              options={{
                layout: { type: "accordion", defaultCollapsed: false, radios: "if_multiple", spacedAccordionItems: false },
                fields: { billingDetails: { email: "never", address: "never" } },
                business: { name: storeConfig.name },
              }}
            />
          </div>

          <label className="mt-5 flex items-center gap-3 text-[15px]">
            <input
              type="checkbox"
              checked={billingSame}
              onChange={(e) => setBillingSame(e.target.checked)}
              className="size-4 accent-ink"
            />
            Faktureringsadressen er den samme som leveringsadressen
          </label>
          {!billingSame && <div className="mt-5">{addressFields("billing", billing, setBilling)}</div>}
        </section>

        <section aria-labelledby="note">
          <label id="note" htmlFor="customerNote" className="mb-1.5 block text-sm font-medium text-ink-soft">
            Bemærkning til ordren (valgfrit)
          </label>
          <textarea
            id="customerNote"
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3.5 py-3 text-[15px] outline-none focus:border-ink focus:ring-1 focus:ring-ink"
          />
        </section>

        <div className="space-y-4">
          {notice && <Alert tone="warning">{notice}</Alert>}
          {formError && <Alert tone="error">{formError}</Alert>}
          {quoteError && <Alert tone="error">{quoteError}</Alert>}
          {quoteErrors.length > 0 && (
            <Alert tone="error" title="Kurven skal rettes">
              <ul className="list-disc pl-5">
                {quoteErrors.map((e) => (
                  <li key={`${e.productId}:${e.variationId}:${e.code}`}>
                    {lines.find((l) => l.productId === e.productId && l.variationId === e.variationId)?.name ?? "Vare"}:{" "}
                    {e.code === "insufficient_stock" ? `kun ${e.available} på lager` : e.code === "out_of_stock" ? "udsolgt" : e.message}
                  </li>
                ))}
              </ul>
              <Link href="/kurv" className="mt-2 inline-block font-medium underline">
                Gå til kurven
              </Link>
            </Alert>
          )}

          <button
            type="submit"
            disabled={payDisabled}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-ink text-base font-semibold text-white transition-colors hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Spinner /> Behandler betaling…
              </>
            ) : quote ? (
              `Betal ${formatPrice(quote.totals.total)}`
            ) : (
              "Betal"
            )}
          </button>
          <p className="text-center text-xs text-muted">
            Ved at betale accepterer du handelsbetingelserne. Totalen beregnes af butikken og kontrolleres igen, når du betaler.
          </p>
        </div>
      </form>

      <aside className="hidden lg:block" aria-label="Ordreoversigt">
        <div className="sticky top-28 rounded-[var(--radius-card)] border border-line bg-surface p-6">{summary}</div>
      </aside>
    </div>
  );
}

type CheckoutResponse =
  | { type: "ready"; clientSecret: string; returnPath: string; order: { id: number; number: string; total: string } }
  | { type: "already_paid"; returnPath: string }
  | { type: "total_changed" | "cart_invalid" | "out_of_stock"; message: string; quote: ClientQuote | null; fields?: undefined }
  | { type?: undefined; code: string; message: string; fields?: Record<string, string>; quote?: undefined }
  | { type: "busy"; message: string; fields?: undefined; quote?: undefined };

function focusFirstError(fields: Record<string, string>) {
  const first = Object.keys(fields)[0];
  if (!first) return;
  const element = document.getElementsByName(first)[0];
  element?.focus();
}
