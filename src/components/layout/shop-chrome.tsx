import { Suspense } from "react";
import { CartDrawer } from "@/components/cart/cart-drawer";
import { UspStrip } from "@/components/marketing/usps";
import { Footer } from "./footer";
import { Header } from "./header";

/** Header, footer and cart drawer around every shop page (the checkout has its own, calmer frame). */
export function ShopChrome({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main id="indhold" className="flex-1">
        {children}
      </main>
      <Suspense fallback={<div className="mt-20" />}>
        <UspStrip />
      </Suspense>
      <Footer />
      <CartDrawer />
    </>
  );
}
