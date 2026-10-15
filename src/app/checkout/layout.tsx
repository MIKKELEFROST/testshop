import { CheckoutHeader } from "@/components/checkout/checkout-header";

/** The checkout has its own frame: no shop navigation, footer or cart drawer. */
export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <CheckoutHeader />
      <main id="indhold" className="flex flex-1 flex-col bg-surface">
        {children}
      </main>
    </>
  );
}
