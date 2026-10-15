import type { Metadata } from "next";
import { FavoritesView } from "@/components/favorites/favorites-view";
import { CardBand } from "@/components/products/product-card";

export const metadata: Metadata = { title: "Favoritter", robots: { index: false } };

export default function FavoritesPage() {
  return (
    <CardBand>
      <div className="container-shop pt-8 sm:pt-10">
        <h1 className="heading text-[34px] text-ink sm:text-5xl">Favoritter</h1>
        <p className="mt-2 text-ink-soft">Dine gemte produkter. De gemmes i din browser på denne enhed.</p>
        <FavoritesView />
      </div>
    </CardBand>
  );
}
