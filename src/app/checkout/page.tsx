import type { Metadata } from "next";
import { CheckoutView } from "@/components/checkout/checkout-view";

export const metadata: Metadata = { title: "Kassen", robots: { index: false } };

export default function CheckoutPage() {
  return (
    <>
      <h1 className="sr-only">Kassen</h1>
      <CheckoutView />
    </>
  );
}
