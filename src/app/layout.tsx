import "@fontsource-variable/inter";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { CartProvider } from "@/components/cart/cart-provider";
import { storeConfig, themeStyle } from "@/config/store";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: { default: `${storeConfig.name} – ${storeConfig.tagline}`, template: `%s · ${storeConfig.name}` },
  description: storeConfig.description,
};

export const viewport: Viewport = {
  themeColor: storeConfig.theme.paper ?? "#faf8f5",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="da" className="h-full antialiased" style={themeStyle(storeConfig.theme)}>
      <body className="flex min-h-full flex-col">
        <a
          href="#indhold"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-ink focus:px-4 focus:py-2 focus:text-white"
        >
          Gå til indhold
        </a>
        {/* Shop pages add header, footer and cart drawer in app/(shop)/layout.tsx; the checkout has its own frame. */}
        <CartProvider>{children}</CartProvider>
      </body>
    </html>
  );
}
