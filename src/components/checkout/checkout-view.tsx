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
import { includesShipping, type ClientQuote } from "@/lib/checkout/quote";
import { DELIVERY_ESTIMATE, DISPATCH_PROMISE } from "@/lib/delivery";
import { formatPrice, stripeCurrencyExponent, toMinorUnits } from "@/lib/money";
import { getStripeClient } from "@/lib/stripe/client";
import { addressSchema, checkoutRequestSchema, contactSchema, fieldErrors, postcodeSchema } from "@/lib/validation/checkout";
import { CouponField } from "./coupon-field";
import { ExpressCheckout } from "./express-checkout";
import { LEGAL_LINKS, LegalLink, TermsNotice } from "./legal-links";
import { OrderSummary } from "./order-summary";
import { QuoteError } from "./quote-error";
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

// Stripe needs real colour values, not CSS variables.
const action = storeConfig.theme.action ?? "#1d1b19";

const appearance: StripeElementsOptions["appearance"] = {
  theme: "stripe",
  // Floating labels, like the checkout's own fields.
  labels: "floating",
  variables: {
    colorPrimary: action,
    colorText: "#1d1b19",
    colorDanger: "#b42318",
    colorBackground: "#ffffff",
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif",
    borderRadius: "12px",
    spacingUnit: "4px",
  },
  rules: {
    ".Input": { borderColor: storeConfig.theme["line-strong"] ?? "#d4cdc4", boxShadow: "none", padding: "13px 14px" },
    ".Input:focus": { borderColor: action, boxShadow: `0 0 0 1px ${action}` },
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
    // Kept above Stripe's minimum charge (2.50 DKK): a smaller placeholder can make the first
    // Payment Element load fail even though the real total is fine.
    amount: 1000,
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
  const [couponCodes, setCouponCodes] = useState<string[]>([]);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [paymentReady, setPaymentReady] = useState(false);
  const [paymentLoadError, setPaymentLoadError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const postcodeValid = postcodeSchema.safeParse(shipping.postcode).success;
  const emailValid = contactSchema.shape.email.safeParse(contact.email).success;
  const { quote, loading: quoteLoading, error: quoteError, setQuote, retry: retryQuote } = useQuote(
    lines,
    {
      country: shipping.country,
      postcode: postcodeValid ? shipping.postcode : undefined,
      city: postcodeValid ? shipping.city || undefined : undefined,
      address1: postcodeValid ? shipping.address1 || undefined : undefined,
    },
    shippingRateId,
    hydrated,
    { codes: couponCodes, email: emailValid ? contact.email.trim() : undefined },
  );

  // Follow WooCommerce's choice when the selected rate is not (or no longer) available.
  const quotedRateId = quote?.shippingRateId ?? null;
  const selectedRateId = quote && quote.shippingRates.some((r) => r.id === shippingRateId) ? shippingRateId : quotedRateId;

  const amountMinor = quote ? toMinorUnits(quote.totals.total, stripeCurrencyExponent(quote.currency)) : null;
  useEffect(() => {
    if (elements && amountMinor && amountMinor > 0) elements.update({ amount: amountMinor });
  }, [elements, amountMinor]);

  if (!hydrated) {
    return <div className="mx-auto mt-10 h-96 w-full max-w-[1120px] animate-pulse rounded-[var(--radius-card)] bg-black/5" aria-hidden="true" />;
  }

  if (lines.length === 0) {
    return (
      <div className="mx-auto my-16 w-full max-w-md px-4 text-center">
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
      // Only codes WooCommerce applied to the total the customer sees.
      coupons: quote?.coupons.map((c) => c.code) ?? [],
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

      if (data.type === "coupon_invalid") {
        if (data.quote) setQuote(data.quote);
        setNotice(`${data.message} Kontrollér totalen, og tryk på Betal igen.`);
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
    <div className="grid grid-cols-2 gap-3">
      <SelectField
        className="col-span-2"
        label="Land/område"
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
        className="col-span-2"
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
        className="col-span-2"
        label="Lejlighed, etage osv. (valgfrit)"
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
      {scope === "shipping" && (
        <Field
          className="col-span-2"
          label="Telefon (valgfrit)"
          name="contact.phone"
          type="tel"
          autoComplete="tel"
          value={contact.phone}
          onChange={(e) => setContact({ ...contact, phone: e.target.value })}
          onBlur={(e) => validateField("contact", "phone", e.target.value)}
          error={errors["contact.phone"]}
          hint="Bruges kun af fragtfirmaet ved levering."
        />
      )}
    </div>
  );

  const couponField = (id: string) =>
    quote?.couponsEnabled ? (
      <CouponField id={id} quote={quote} loading={quoteLoading} requested={couponCodes} onChange={setCouponCodes} />
    ) : null;

  return (
    <div className="flex flex-1 flex-col lg:grid lg:grid-cols-2">
      {/* Order summary: a collapsible bar at the top on mobile, the right-hand column on desktop. */}
      <aside aria-label="Ordreoversigt" className="border-b border-line bg-paper lg:order-2 lg:border-b-0 lg:border-l">
        <div className="lg:sticky lg:top-0 lg:max-w-[480px] lg:px-10 lg:py-10 xl:px-12">
          <button
            type="button"
            onClick={() => setSummaryOpen((open) => !open)}
            aria-expanded={summaryOpen}
            aria-controls="ordreoversigt"
            className="mx-auto flex w-full max-w-[600px] items-center justify-between gap-4 px-4 py-4 text-left sm:px-6 lg:hidden"
          >
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-sm font-medium text-accent">
                {summaryOpen ? "Skjul ordreoversigt" : "Vis ordreoversigt"}
                <svg
                  viewBox="0 0 16 16"
                  className={`size-4 transition-transform ${summaryOpen ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  aria-hidden="true"
                >
                  <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              {/* What is being bought stays visible while the summary is folded away. */}
              {!summaryOpen && (
                <span className="mt-0.5 block truncate text-xs text-muted">
                  {lines.map((l) => `${l.quantity > 1 ? `${l.quantity} × ` : ""}${l.name}${l.variantLabel ? ` (${l.variantLabel})` : ""}`).join(", ")}
                </span>
              )}
            </span>
            <span className="shrink-0 text-lg font-semibold tabular-nums">{quote ? formatPrice(quote.totals.total) : ""}</span>
          </button>
          <div
            id="ordreoversigt"
            className={`${summaryOpen ? "block" : "hidden"} mx-auto max-w-[600px] px-4 pb-6 sm:px-6 lg:block lg:max-w-none lg:p-0`}
          >
            <OrderSummary
              lines={lines}
              quote={quote}
              loading={quoteLoading}
              addressComplete={postcodeValid}
              coupon={<div className="hidden lg:block">{couponField("couponCode")}</div>}
            />
          </div>
        </div>
      </aside>

      <div className="flex-1 bg-surface lg:order-1">
        <form
          onSubmit={handleSubmit}
          noValidate
          className="mx-auto max-w-[600px] space-y-9 px-4 py-8 sm:px-6 lg:ml-auto lg:mr-0 lg:px-10 lg:py-10 xl:px-12"
        >
          {quote && quoteErrors.length === 0 && !stripeFailed && <ExpressCheckout lines={lines} quote={quote} />}

          <section aria-labelledby="kontakt">
            <h2 id="kontakt" className="text-[19px] font-semibold">
              Kontaktoplysninger
            </h2>
            <Field
              className="mt-4"
              label="E-mail"
              name="contact.email"
              type="email"
              autoComplete="email"
              value={contact.email}
              onChange={(e) => setContact({ ...contact, email: e.target.value })}
              onBlur={(e) => validateField("contact", "email", e.target.value)}
              error={errors["contact.email"]}
              hint="Ordrebekræftelsen sendes hertil."
              required
            />
          </section>

          <section aria-labelledby="levering">
            <h2 id="levering" className="text-[19px] font-semibold">
              Levering
            </h2>
            <div className="mt-4">{addressFields("shipping", shipping, setShipping)}</div>
          </section>

          {quote?.needsShipping !== false && (
            <section aria-labelledby="fragt">
              <h2 id="fragt" className="text-base font-semibold">
                Leveringsmetode
              </h2>
              <div className="mt-3">
                {!postcodeValid ? (
                  <p className="rounded-[var(--radius-control)] bg-paper px-4 py-4 text-sm text-muted">
                    Angiv din leveringsadresse for at se de tilgængelige leveringsmetoder.
                  </p>
                ) : !quote && quoteLoading ? (
                  <div className="flex items-center gap-2 rounded-[var(--radius-control)] bg-paper px-4 py-4 text-sm text-muted">
                    <Spinner /> Henter leveringsmetoder…
                  </div>
                ) : quote && quote.shippingRates.length === 0 ? (
                  <Alert tone="warning">Vi kan desværre ikke levere til den adresse.</Alert>
                ) : (
                  <>
                    <fieldset className="overflow-hidden rounded-[var(--radius-control)] border border-line-strong">
                      <legend className="sr-only">Vælg leveringsmetode</legend>
                      {quote?.shippingRates.map((rate) => (
                        <label
                          key={rate.id}
                          className={`flex cursor-pointer items-center gap-3 border-b border-line px-4 py-4 last:border-b-0 ${
                            selectedRateId === rate.id ? "bg-accent-soft/60 outline outline-1 -outline-offset-1 outline-ink" : ""
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
                          <span className="flex-1">
                            <span className="block text-[15px]">{rate.label}</span>
                            <span className="block text-xs text-muted">{DELIVERY_ESTIMATE}</span>
                          </span>
                          <span className="text-[15px] font-medium tabular-nums">
                            {Number(rate.price) === 0 ? "Gratis" : formatPrice(rate.price)}
                          </span>
                        </label>
                      ))}
                    </fieldset>
                    <p className="mt-2 text-xs text-muted">{DISPATCH_PROMISE}</p>
                  </>
                )}
              </div>
            </section>
          )}

          <section aria-labelledby="betaling">
            <h2 id="betaling" className="text-[19px] font-semibold">
              Betaling
            </h2>
            <p className="mt-1 text-sm text-muted">Alle transaktioner er sikre og krypterede.</p>
            <div className="mt-4">
              {stripeFailed ? (
                <Alert tone="error" title="Betalingsformularen kunne ikke indlæses">
                  Kontrollér din internetforbindelse, slå eventuelle annonceblokkere fra, og genindlæs siden.
                </Alert>
              ) : paymentLoadError ? (
                <Alert tone="error" title="Betalingsformularen kunne ikke indlæses">
                  Genindlæs siden.
                  <span className="mt-1 block text-xs opacity-80">{paymentLoadError}</span>
                </Alert>
              ) : (
                !paymentReady && (
                  <div className="flex items-center gap-2 rounded-[var(--radius-control)] bg-paper px-4 py-6 text-sm text-muted">
                    <Spinner /> Indlæser betalingsmetoder…
                  </div>
                )
              )}
              <PaymentElement
                onReady={() => {
                  // A later successful load (e.g. after the real amount is set) clears an earlier failure.
                  setPaymentReady(true);
                  setPaymentLoadError(null);
                }}
                onChange={() => setPaymentLoadError(null)}
                onLoadError={(event) => {
                  console.error("[checkout] Payment Element failed to load:", event.error.type, event.error.message);
                  setPaymentLoadError(event.error.message ?? event.error.type);
                }}
                options={{
                  layout: { type: "accordion", defaultCollapsed: false, radios: "always", spacedAccordionItems: false },
                  fields: { billingDetails: { email: "never", address: "never" } },
                  // Apple Pay and Google Pay are offered as "Hurtig betaling" at the top instead.
                  wallets: { applePay: "never", googlePay: "never" },
                  business: { name: storeConfig.name },
                }}
              />
            </div>

            <label className="mt-4 flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={billingSame}
                onChange={(e) => setBillingSame(e.target.checked)}
                className="size-4 accent-ink"
              />
              Brug leveringsadressen som faktureringsadresse
            </label>
            {!billingSame && (
              <div className="mt-4">
                <h3 className="mb-3 text-base font-semibold">Faktureringsadresse</h3>
                {addressFields("billing", billing, setBilling)}
              </div>
            )}
          </section>

          {/* On mobile the summary is folded away, so the coupon field sits in the form instead. */}
          {quote?.couponsEnabled && <div className="lg:hidden">{couponField("couponCodeMobile")}</div>}

          <section aria-label="Bemærkning til ordren">
            {noteOpen || note ? (
              <>
                <label htmlFor="customerNote" className="mb-1.5 block text-sm font-medium text-ink-soft">
                  Bemærkning til ordren (valgfrit)
                </label>
                <textarea
                  id="customerNote"
                  value={note}
                  maxLength={500}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  autoFocus={noteOpen && !note}
                  className="w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3.5 py-3 text-[15px] outline-none focus:border-ink focus:ring-1 focus:ring-ink"
                />
              </>
            ) : (
              <button
                type="button"
                onClick={() => setNoteOpen(true)}
                className="text-sm font-medium text-accent underline underline-offset-4 hover:text-ink"
              >
                Tilføj en bemærkning til ordren
              </button>
            )}
          </section>

          <div className="space-y-4">
            {notice && <Alert tone="warning">{notice}</Alert>}
            {formError && <Alert tone="error">{formError}</Alert>}
            {quoteError && <QuoteError error={quoteError} onRetry={retryQuote} />}
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
              aria-describedby="betal-total"
              className="flex h-14 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-action text-base font-semibold text-on-action transition-colors hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Spinner /> Behandler betaling…
                </>
              ) : (
                "Betal nu"
              )}
            </button>
            <p id="betal-total" className="text-center text-xs leading-relaxed text-muted">
              {quote
                ? includesShipping(quote, selectedRateId)
                  ? `Du betaler ${formatPrice(quote.totals.total)} inkl. moms og levering. `
                  : `Du betaler ${formatPrice(quote.totals.total)} inkl. moms. Levering beregnes, når du har angivet din adresse. `
                : ""}
              <TermsNotice action="trykke på Betal nu" />
            </p>
          </div>

          <nav aria-label="Kundeservice" className="flex flex-wrap gap-x-4 gap-y-2 border-t border-line pt-5 text-xs">
            <Link href="/kurv" className="text-accent underline underline-offset-4 hover:text-ink">
              Tilbage til kurven
            </Link>
            <a href={`mailto:${storeConfig.supportEmail}`} className="text-accent underline underline-offset-4 hover:text-ink">
              Kontakt kundeservice
            </a>
            {LEGAL_LINKS.map((link) => (
              <LegalLink key={link.href} href={link.href} className="text-accent underline underline-offset-4 hover:text-ink">
                {link.label}
              </LegalLink>
            ))}
            <span className="text-muted">Betaling håndteres af Stripe</span>
          </nav>
        </form>
      </div>
    </div>
  );
}

type CheckoutResponse =
  | { type: "ready"; clientSecret: string; returnPath: string; order: { id: number; number: string; total: string } }
  | { type: "already_paid"; returnPath: string }
  | {
      type: "total_changed" | "cart_invalid" | "out_of_stock" | "coupon_invalid";
      message: string;
      quote: ClientQuote | null;
      fields?: undefined;
    }
  | { type?: undefined; code: string; message: string; fields?: Record<string, string>; quote?: undefined }
  | { type: "busy"; message: string; fields?: undefined; quote?: undefined };

function focusFirstError(fields: Record<string, string>) {
  const first = Object.keys(fields)[0];
  if (!first) return;
  const element = document.getElementsByName(first)[0];
  element?.focus();
}
