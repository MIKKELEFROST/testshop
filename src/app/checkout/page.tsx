import type { Metadata } from "next";
import { CheckoutView } from "@/components/checkout/checkout-view";

export const metadata: Metadata = { title: "Kassen", robots: { index: false } };

export default function CheckoutPage() {
  return (
    <div className="container-shop pt-8 sm:pt-10">
      <h1 className="text-3xl font-semibold tracking-tight">Kassen</h1>
      <CheckoutView />
    </div>
  );
}
