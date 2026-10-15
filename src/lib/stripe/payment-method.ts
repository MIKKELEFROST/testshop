import type { PaymentMethodLike } from "./gateway";

/** Stripe payment method types → names customers and shop staff recognise. */
const METHODS: Record<string, string> = {
  mobilepay: "MobilePay",
  klarna: "Klarna",
  link: "Link",
  amazon_pay: "Amazon Pay",
  paypal: "PayPal",
  revolut_pay: "Revolut Pay",
  sepa_debit: "SEPA Direct Debit",
  ideal: "iDEAL",
  bancontact: "Bancontact",
  swish: "Swish",
  vipps: "Vipps",
};

const WALLETS: Record<string, string> = {
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  samsung_pay: "Samsung Pay",
  link: "Link",
};

const CARD_BRANDS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  diners: "Diners Club",
  discover: "Discover",
  jcb: "JCB",
  unionpay: "UnionPay",
  cartes_bancaires: "Cartes Bancaires",
  eftpos_au: "eftpos",
};

/** Payment method title for the WooCommerce order, e.g. "MobilePay (Stripe)" or "Visa-kort (Stripe)". */
export function paymentMethodTitle(method: PaymentMethodLike | null | undefined): string | undefined {
  if (!method?.type) return undefined;
  return `${label(method)} (Stripe)`;
}

function label(method: PaymentMethodLike): string {
  if (method.type !== "card") return METHODS[method.type] ?? humanize(method.type);
  const wallet = method.card?.wallet;
  if (wallet) return WALLETS[wallet] ?? humanize(wallet);
  const brand = method.card?.brand ? CARD_BRANDS[method.card.brand] : undefined;
  return brand ? `${brand}-kort` : "Betalingskort";
}

function humanize(type: string): string {
  const words = type.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
