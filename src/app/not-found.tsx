import type { Metadata } from "next";
import { NotFoundContent } from "@/components/layout/not-found-content";
import { ShopChrome } from "@/components/layout/shop-chrome";
import { storeConfig } from "@/config/store";

// Its own description, not the front page's. No robots here: Next.js marks a page that is not
// found "noindex" itself.
export const metadata: Metadata = { title: "Siden blev ikke fundet", description: `Siden findes ikke hos ${storeConfig.name}. Søg, eller find kostumet efter tema.` };

/** Unknown URLs: rendered in the root layout only, so it brings the shop's header and footer itself. */
export default function NotFound() {
  return (
    <ShopChrome>
      <NotFoundContent />
    </ShopChrome>
  );
}
