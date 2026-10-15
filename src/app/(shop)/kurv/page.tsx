import type { Metadata } from "next";
import { CartView } from "@/components/cart/cart-view";

export const metadata: Metadata = { title: "Kurv", robots: { index: false } };

export default function CartPage() {
  return (
    <div className="container-shop pt-10">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Kurv</h1>
      <CartView />
    </div>
  );
}
