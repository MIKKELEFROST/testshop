import { storeConfig } from "@/config/store";

/**
 * Monetary amounts are passed around as decimal strings exactly as WooCommerce returns
 * them ("547.00") and only converted to integer minor units at the Stripe boundary.
 * Never use floating point arithmetic to calculate prices in the storefront.
 */

const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d+))?$/;

/** Currencies Stripe treats as zero-decimal or three-decimal. Everything else uses 2. */
const ZERO_DECIMAL = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
]);
const THREE_DECIMAL = new Set(["bhd", "jod", "kwd", "omr", "tnd"]);

export function stripeCurrencyExponent(currency: string): number {
  const c = currency.toLowerCase();
  if (ZERO_DECIMAL.has(c)) return 0;
  if (THREE_DECIMAL.has(c)) return 3;
  return 2;
}

/**
 * Convert a decimal string to integer minor units without floating point errors.
 * Extra precision is rounded half-up.
 */
export function toMinorUnits(decimal: string, exponent: number): number {
  const match = DECIMAL_RE.exec(decimal.trim());
  if (!match) throw new Error(`Invalid decimal amount: ${decimal}`);
  const [, sign, whole, fraction = ""] = match;

  const padded = fraction.padEnd(exponent, "0");
  let minor = BigInt(whole + padded.slice(0, exponent));
  const rest = padded.slice(exponent);
  if (rest.length > 0 && Number(rest[0]) >= 5) minor += BigInt(1);

  const value = Number(sign === "-" ? -minor : minor);
  if (!Number.isSafeInteger(value)) throw new Error(`Amount out of range: ${decimal}`);
  return value;
}

/** Convert integer minor units back to a decimal string. */
export function fromMinorUnits(minor: number, exponent: number): string {
  if (!Number.isSafeInteger(minor)) throw new Error(`Invalid minor amount: ${minor}`);
  const negative = minor < 0;
  const digits = Math.abs(minor).toString().padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = exponent > 0 ? `.${digits.slice(-exponent)}` : "";
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

/** Compare two decimal strings for equality at the given precision. */
export function sameAmount(a: string, b: string, exponent = 2): boolean {
  return toMinorUnits(a, exponent) === toMinorUnits(b, exponent);
}

/** Multiply a decimal string by an integer quantity (display only). */
export function multiplyAmount(decimal: string, quantity: number, exponent = 2): string {
  return fromMinorUnits(toMinorUnits(decimal, exponent) * quantity, exponent);
}

const formatters = new Map<string, Intl.NumberFormat>();

/** "199" or "199,50" (no øre on whole amounts, no currency): for large price displays. */
export function formatAmount(amount: string, locale: string = storeConfig.locale): string {
  // Display only: a 2-decimal string formats safely as a number.
  const value = Number(amount);
  const whole = Number.isInteger(value);
  return value.toLocaleString(locale, { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

export function formatPrice(
  amount: string | null | undefined,
  currency: string = storeConfig.currency,
  locale: string = storeConfig.locale,
): string {
  if (amount === null || amount === undefined || amount === "") return "";
  const key = `${locale}|${currency}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { style: "currency", currency });
    formatters.set(key, formatter);
  }
  // Display only: Intl needs a number, which is safe for formatting a 2-decimal string.
  return formatter.format(Number(amount));
}
