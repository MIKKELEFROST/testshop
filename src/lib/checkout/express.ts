import type { CartLine } from "@/lib/cart/cart";
import { deliveryEstimate } from "@/lib/delivery";
import { stripeCurrencyExponent, toMinorUnits } from "@/lib/money";
import type { ClientQuote } from "./quote";

/**
 * Pure helpers for the express checkout (Apple Pay / Google Pay): turn what the wallet
 * returns into the same checkout request the form sends. The server validates and prices
 * it exactly like a normal checkout.
 */

export type WalletAddress = {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  postal_code?: string | null;
  country?: string | null;
};

export type WalletContact = { name?: string | null; address?: WalletAddress | null };

/** `deliveryEstimate` is text: the structured form can make a wallet show dates, and no date is promised. */
export type WalletShippingRate = { id: string; amount: number; displayName: string; deliveryEstimate: string };

/** Wallets give one name field; WooCommerce wants first and last name. */
export function splitName(fullName: string | null | undefined): { firstName: string; lastName: string } {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0]!, lastName: parts[0]! };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1]! };
}

/** Danish postcodes are four digits; wallets sometimes add a country prefix ("DK-8000"). */
export function walletPostcode(postalCode: string | null | undefined): string {
  return (postalCode ?? "").replace(/\D/g, "");
}

export function toFormAddress(contact: WalletContact | null | undefined) {
  const address = contact?.address ?? {};
  return {
    ...splitName(contact?.name),
    company: "",
    address1: address.line1?.trim() ?? "",
    address2: address.line2?.trim() ?? "",
    postcode: walletPostcode(address.postal_code),
    city: address.city?.trim() ?? "",
    country: (address.country ?? "").toUpperCase(),
  };
}

function isComplete(address: ReturnType<typeof toFormAddress>): boolean {
  return Boolean(address.firstName && address.address1 && address.postcode && address.city && address.country);
}

/**
 * The quote's shipping rates for the wallet sheet, WooCommerce's current choice first. Made when
 * the sheet opens or the address changes, so the delivery text fits the time (`now`).
 */
export function walletShippingRates(quote: ClientQuote, now: Date = new Date()): WalletShippingRate[] {
  const exponent = stripeCurrencyExponent(quote.currency);
  const estimate = deliveryEstimate(now);
  const rates = quote.shippingRates.map((rate) => ({
    id: rate.id,
    displayName: rate.label,
    amount: toMinorUnits(rate.price, exponent),
    deliveryEstimate: estimate,
  }));
  return [...rates.filter((r) => r.id === quote.shippingRateId), ...rates.filter((r) => r.id !== quote.shippingRateId)];
}

/**
 * The quote to open the wallet sheet with: the form's quote when it has shipping rates (or
 * nothing is shipped), else the quote for ESTIMATE_ADDRESS (the sheet is repriced as soon as
 * the customer picks their own address). Null when neither can be used.
 */
export function walletOpeningQuote(formQuote: ClientQuote, estimate: ClientQuote | null): ClientQuote | null {
  if (!formQuote.needsShipping || formQuote.shippingRates.length > 0) return formQuote;
  if (estimate && estimate.errors.length === 0 && estimate.shippingRates.length > 0) return estimate;
  return null;
}

/** The estimate for ESTIMATE_ADDRESS the checkout asks for in advance, and how far it has got. */
export type WalletEstimate = { status: "loading" | "ok" | "failed"; quote: ClientQuote | null };

/** How long a tap waits for an estimate still on its way; the sheet must open within a second. */
export const WALLET_WAIT_MS = 800;

/**
 * What a tap on a wallet button does: open the sheet with a quote, wait a moment for the
 * estimate still on its way ("wait"), or not open and ask for the estimate again ("retry", once
 * it has failed or cannot open the sheet, e.g. sold out since: a tap never restarts an estimate
 * under way).
 */
export function walletTap(
  formQuote: ClientQuote,
  estimate: WalletEstimate | null,
): { action: "open"; quote: ClientQuote } | { action: "wait" } | { action: "retry" } {
  const opening = walletOpeningQuote(formQuote, estimate?.status === "ok" ? estimate.quote : null);
  if (opening) return { action: "open", quote: opening };
  return estimate?.status === "loading" ? { action: "wait" } : { action: "retry" };
}

/**
 * Where the estimate for `request` comes from: the one here or on its way ("keep"), a quote this
 * tab got moments ago for the same request (`recent`, e.g. the cart's), or WooCommerce ("ask").
 * One that failed, or that a tap marked failed because it could not open the sheet, is asked
 * for anew: `recent` may be that very answer.
 */
export function estimateSource(
  current: { request: string; status: WalletEstimate["status"] } | null,
  request: string,
  recent: ClientQuote | null,
): { from: "keep" } | { from: "recent"; quote: ClientQuote } | { from: "ask" } {
  if (current?.request === request) return current.status === "failed" ? { from: "ask" } : { from: "keep" };
  return recent ? { from: "recent", quote: recent } : { from: "ask" };
}

export function quoteAmount(quote: ClientQuote): number {
  return toMinorUnits(quote.totals.total, stripeCurrencyExponent(quote.currency));
}

/**
 * The checkout request for a confirmed wallet payment. `quote` is the latest quote shown in
 * the wallet sheet, so its total is what the customer approved.
 */
export function expressCheckoutRequest({
  lines,
  quote,
  billingDetails,
  shippingAddress,
  shippingRateId,
}: {
  lines: CartLine[];
  quote: ClientQuote;
  billingDetails: WalletContact & { email?: string | null; phone?: string | null };
  shippingAddress?: WalletContact | null;
  shippingRateId?: string | null;
}) {
  const billing = toFormAddress(billingDetails);
  // Not every wallet returns a separate shipping contact; then the billing contact is it.
  const shipping = shippingAddress?.address ? toFormAddress({ name: shippingAddress.name || billingDetails.name, address: shippingAddress.address }) : billing;
  const billingSameAsShipping = !isComplete(billing) || JSON.stringify(billing) === JSON.stringify(shipping);

  return {
    items: lines.map((l) => ({ productId: l.productId, variationId: l.variationId, quantity: l.quantity })),
    contact: { email: billingDetails.email?.trim() ?? "", phone: billingDetails.phone?.trim() ?? "" },
    shipping,
    billingSameAsShipping,
    billing: billingSameAsShipping ? undefined : billing,
    shippingRateId: quote.needsShipping ? (shippingRateId ?? quote.shippingRateId) : null,
    expectedTotal: quote.totals.total,
    customerNote: "",
    coupons: quote.coupons.map((c) => c.code),
  };
}
