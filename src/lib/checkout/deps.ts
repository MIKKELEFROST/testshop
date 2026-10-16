import "server-only";
import { stripeEnv } from "@/lib/env";
import { stripeGateway } from "@/lib/stripe/server";
import { attachPaymentIntent, createOrder, getOrderDetails, sendPaymentEvent, sweepPayments } from "@/lib/woocommerce/checkout-api";
import type { CheckoutDeps } from "./service";
import { settleCallbackFor, settleUrl, type SettleDeps } from "./settle";

export function checkoutDeps(): CheckoutDeps {
  return {
    backend: { createOrder, attachPaymentIntent, sendPaymentEvent },
    gateway: stripeGateway,
    // The order's callback for capture at shipment, with its token (see ./settle.ts).
    settleCallback: (orderId, orderKey) => settleCallbackFor(settleSecret(), settleUrl())(orderId, orderKey),
  };
}

export function settleDeps(): SettleDeps {
  const deps = checkoutDeps();
  return { ...deps, backend: { ...deps.backend, getOrder: getOrderDetails, sweepPayments } };
}

/** The secret the settle callback's tokens are made with: no new secret to set (see ./settle.ts). */
export function settleSecret(): string {
  return stripeEnv().STRIPE_SECRET_KEY;
}
