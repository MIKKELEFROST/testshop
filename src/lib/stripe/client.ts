"use client";

import { loadStripe, type Stripe } from "@stripe/stripe-js";

let stripePromise: Promise<Stripe | null> | null = null;

/** Stripe.js is loaded once, only on pages that take payments. */
export function getStripeClient(): Promise<Stripe | null> | null {
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!key || !key.startsWith("pk_")) return null;
  stripePromise ??= loadStripe(key, { locale: "da" }).catch(() => {
    // Network/CSP failure: allow a retry on the next mount.
    stripePromise = null;
    return null;
  });
  return stripePromise;
}
