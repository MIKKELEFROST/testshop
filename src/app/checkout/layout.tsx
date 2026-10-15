import { CheckoutFooter } from "@/components/checkout/checkout-footer";
import { CheckoutHeader } from "@/components/checkout/checkout-header";

/** The checkout has its own frame: no shop navigation or cart drawer, and a slim footer with the seller and the terms. */
export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <CheckoutHeader />
      <main id="indhold" className="flex flex-1 flex-col bg-surface">
        {children}
      </main>
      <CheckoutFooter />
    </>
  );
}
