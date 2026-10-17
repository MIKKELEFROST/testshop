import "@fontsource-variable/inter";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { CartProvider } from "@/components/cart/cart-provider";
import { brandStyle, storeConfig } from "@/config/store";
import { SITE_URL } from "@/lib/seo";
// The brands' heading fonts; only the one the brand uses is downloaded.
import { bebasNeue, fredoka } from "./fonts";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${storeConfig.name} – ${storeConfig.tagline}`, template: `%s · ${storeConfig.name}` },
  description: storeConfig.description,
  // For the pages without Open Graph data of their own (cart, search …); the others name it
  // with openGraphFor (lib/seo.tsx), which replaces this object.
  openGraph: { type: "website", siteName: storeConfig.name, locale: "da_DK" },
};

export const viewport: Viewport = {
  // The browser's toolbar matches the header.
  themeColor: storeConfig.theme.chrome ?? "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="da" className={`h-full antialiased ${fredoka.variable} ${bebasNeue.variable}`} style={brandStyle(storeConfig)}>
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
