import Link from "next/link";
import { ProductImage } from "@/components/products/product-image";
import { COSTUME_CATEGORY_SLUGS } from "@/config/catalog";
import { collectionHref, findCollection, type Tile } from "@/config/merchandising";
import { storeConfig } from "@/config/store";
import { getLinkProducts } from "@/lib/woocommerce/collections";
import { getProductPhoto } from "@/lib/woocommerce/products";

/** "Hvem skal klædes ud?": round photos of who the costume is for. */
export async function AudienceTiles({ title, tiles }: { title: string; tiles: Tile[] }) {
  const photos = await Promise.all(tiles.map((tile) => tilePhoto(tile)));
  return (
    <section className="container-shop mt-12 sm:mt-16" aria-labelledby="hvem">
      <h2 id="hvem" className="heading text-center text-[26px] text-ink sm:text-3xl">
        {title}
      </h2>
      <ul className={`mt-7 grid grid-cols-3 gap-x-3 gap-y-6 sm:gap-x-5 ${tiles.length > 5 ? "lg:grid-cols-6" : "sm:grid-cols-5"}`}>
        {tiles.map((tile, i) => (
          <li key={tile.href}>
            <Link href={tile.href} className="group flex flex-col items-center text-center">
              <span className="relative block aspect-square w-full max-w-40 overflow-hidden rounded-full bg-white shadow-[0_6px_20px_-8px_rgb(0_0_0/0.25)] ring-4 ring-surface transition-transform group-hover:-translate-y-1 group-hover:ring-action">
                <ProductImage image={photos[i] ?? null} name={tile.label} sizes="(min-width: 1024px) 160px, 30vw" decorative />
              </span>
              <span className="mt-3 text-[15px] font-bold text-ink group-hover:text-accent sm:text-base">{tile.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Theme tiles: a photo with the theme's name on it (the front page's, and each section of /tema). */
export async function ThemeTiles({
  title,
  collections,
  id = "temaer",
  className = "mt-14 sm:mt-20",
}: {
  title: string;
  collections: string[];
  /** The heading's id (unique on the page). */
  id?: string;
  className?: string;
}) {
  const themes = collections.map((slug) => findCollection(slug)).filter((c) => c !== undefined);
  const photos = await Promise.all(themes.map((c) => tilePhoto({ label: c.title, href: collectionHref(c), product: c.tileProduct })));
  const halloween = storeConfig.season === "halloween";
  return (
    <section className={`container-shop ${className}`} aria-labelledby={id}>
      <h2 id={id} className="heading text-[26px] text-ink sm:text-3xl">
        {title}
      </h2>
      <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {themes.map((theme, i) => (
          <li key={theme.slug}>
            <Link
              href={collectionHref(theme)}
              className="group relative block aspect-[4/5] overflow-hidden rounded-2xl bg-white ring-1 ring-black/5"
            >
              <ProductImage
                image={photos[i] ?? null}
                name={theme.title}
                sizes="(min-width: 640px) 24vw, 48vw"
                decorative
                className="transition-transform duration-500 group-hover:scale-105"
              />
              {/* Dark enough behind both lines of a two-line label on a white photo: at least about 5:1 for the white text. */}
              <span
                className={`absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3 pt-16 sm:p-4 sm:pt-20 ${
                  halloween ? "bg-gradient-to-t from-[#130f19] via-[#130f19]/80 to-transparent text-white" : "bg-gradient-to-t from-ink/90 via-ink/70 to-transparent text-white"
                }`}
              >
                <span className="heading text-xl leading-tight sm:text-2xl">{theme.title}</span>
                <span aria-hidden="true" className="mb-0.5 text-lg transition-transform group-hover:translate-x-1">
                  →
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A tile's photo: its chosen product's, or else the first costume (or product) behind its link. */
async function tilePhoto(tile: Tile) {
  if (tile.product) {
    const photo = await getProductPhoto(tile.product);
    if (photo?.image) return photo.image;
  }
  const products = (await getLinkProducts(tile.href, 12)).filter((p) => p.image);
  const costume = products.find((p) => p.categories.some((c) => COSTUME_CATEGORY_SLUGS.includes(c.slug)));
  return (costume ?? products[0])?.image ?? null;
}
