import type { Metadata } from "next";
import { NotFoundContent } from "@/components/layout/not-found-content";
import { storeConfig } from "@/config/store";

// Its own description, not the front page's. No robots here: Next.js marks a page that is not
// found "noindex" itself.
export const metadata: Metadata = { title: "Siden blev ikke fundet", description: `Siden findes ikke hos ${storeConfig.name}. Søg, eller find kostumet efter tema.` };

/** notFound() in a shop page (e.g. a product another webshop sells): the shop layout already adds header and footer. */
export default function ShopNotFound() {
  return <NotFoundContent />;
}
