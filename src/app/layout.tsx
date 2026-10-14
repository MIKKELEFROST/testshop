import "@fontsource-variable/inter";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { CartProvider } from "@/components/cart/cart-provider";
import { AddedToCartToast } from "@/components/cart/added-to-cart-toast";
import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { storeConfig } from "@/config/store";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: { default: `${storeConfig.name} – ${storeConfig.tagline}`, template: `%s · ${storeConfig.name}` },
  description: storeConfig.description,
};

export const viewport: Viewport = {
  themeColor: "#faf8f5",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="da" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <a
          href="#indhold"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-ink focus:px-4 focus:py-2 focus:text-white"
        >
          Gå til indhold
        </a>
        <CartProvider>
          <Header />
          <main id="indhold" className="flex-1">
            {children}
          </main>
          <Footer />
          <AddedToCartToast />
        </CartProvider>
      </body>
    </html>
  );
}
