import "server-only";
import { stripeGateway } from "@/lib/stripe/server";
import { attachPaymentIntent, createOrder, sendPaymentEvent } from "@/lib/woocommerce/checkout-api";
import type { CheckoutDeps } from "./service";

export function checkoutDeps(): CheckoutDeps {
  return {
    backend: { createOrder, attachPaymentIntent, sendPaymentEvent },
    gateway: stripeGateway,
  };
}
