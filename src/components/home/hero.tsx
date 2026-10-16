import { LogoMark } from "@/components/brand/logo";
import { ProductImage } from "@/components/products/product-image";
import { ButtonLink } from "@/components/ui/button";
import type { HomePage } from "@/config/merchandising";
import { storeConfig } from "@/config/store";
import type { ProductSummary } from "@/types/commerce";
import { EventCountdown } from "./event-countdown";

/**
 * The front page's first screen in the shop's own style, with the countdown to its holiday,
 * two clear ways in and real product photos.
 * Fastelavn: sunny yellow with confetti. Halloween: a night sky with a moon and bats.
 */
export function Hero({ hero, products }: { hero: HomePage["hero"]; products: ProductSummary[] }) {
  const halloween = storeConfig.season === "halloween";
  return (
    <section className="container-shop pt-4 sm:pt-6">
      {/* On the dark night sky the focus ring is white. */}
      <div className={`relative isolate overflow-hidden rounded-[1.75rem] bg-hero ${halloween ? "text-white [--color-focus:#ffffff]" : "text-ink"}`}>
        {halloween ? <NightSky /> : <Confetti />}
        <div className="relative grid items-center gap-8 px-6 py-10 sm:px-10 sm:py-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:px-14 lg:py-16">
          <div>
            {/* Fastelavn: the brand pink only on the icon; as small text it is too light on white. */}
            <EventCountdown
              season={storeConfig.season}
              className={halloween ? "bg-white/10 text-action ring-1 ring-white/15" : "bg-white text-ink shadow-sm"}
              iconClassName={halloween ? "" : "text-highlight"}
            />
            <h1 className={`heading mt-5 text-balance ${halloween ? "text-[52px] leading-[0.95] sm:text-[72px] lg:text-[84px]" : "text-[40px] sm:text-[56px] lg:text-[64px]"}`}>
              {hero.title}
            </h1>
            <p className={`mt-5 max-w-xl text-lg leading-relaxed ${halloween ? "text-white/80" : "text-ink-soft"}`}>{hero.text}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href={hero.primary.href} size="lg" className="px-7 text-[17px] font-bold">
                {hero.primary.label}
              </ButtonLink>
              <ButtonLink
                href={hero.secondary.href}
                size="lg"
                variant="secondary"
                className={`px-7 text-[17px] font-bold ${halloween ? "border-white/40! bg-transparent! text-white! hover:border-white!" : "border-ink/15!"}`}
              >
                {hero.secondary.label}
              </ButtonLink>
            </div>
          </div>
          <HeroPhotos products={products} halloween={halloween} />
        </div>
      </div>
    </section>
  );
}

function HeroPhotos({ products, halloween }: { products: ProductSummary[]; halloween: boolean }) {
  const shown = products.filter((p) => p.image).slice(0, 3);
  if (shown.length === 0) {
    return (
      <div className="hidden justify-center lg:flex">
        <LogoMark mark={storeConfig.logo.mark} className="size-72 drop-shadow-xl" />
      </div>
    );
  }
  const tilt = ["-rotate-3", "rotate-2", "-rotate-1"];
  const place = ["lg:translate-y-6", "lg:-translate-y-4", "lg:translate-y-10"];
  return (
    <ul className="grid grid-cols-3 gap-3 sm:gap-4">
      {shown.map((product, i) => (
        <li key={product.id} className={`${tilt[i]} ${place[i]} transition-transform hover:rotate-0`}>
          <a
            href={`/produkter/${product.slug}`}
            className={`block overflow-hidden rounded-2xl bg-white p-1.5 sm:p-2 ${
              halloween ? "shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_18px_50px_-10px_rgb(242_105_13/0.55)]" : "shadow-[0_18px_40px_-12px_rgb(29_34_70/0.35)]"
            }`}
          >
            <span className="relative block aspect-[3/4] overflow-hidden rounded-xl">
              <ProductImage image={product.image} name={product.name} sizes="(min-width: 1024px) 15vw, 30vw" priority={i === 0} decorative />
            </span>
            <span className="sr-only">{product.name}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function Confetti() {
  const pieces = [
    { x: 6, y: 14, c: "#e8336f", r: 18, s: 14 },
    { x: 18, y: 78, c: "#2446c8", r: -24, s: 12 },
    { x: 34, y: 8, c: "#18b6a8", r: 40, s: 10 },
    { x: 46, y: 88, c: "#ff8a3d", r: 12, s: 14 },
    { x: 58, y: 6, c: "#2446c8", r: -30, s: 12 },
    { x: 72, y: 92, c: "#e8336f", r: 28, s: 10 },
    { x: 86, y: 10, c: "#ff8a3d", r: -12, s: 16 },
    { x: 94, y: 62, c: "#18b6a8", r: 34, s: 12 },
    { x: 52, y: 46, c: "#ffffff", r: 20, s: 9 },
    { x: 3, y: 52, c: "#ffffff", r: -16, s: 11 },
  ];
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-0">
      <div className="absolute -top-24 -right-20 size-[26rem] rounded-full bg-hero-blob opacity-60 blur-3xl" />
      <div className="absolute -bottom-28 -left-16 size-80 rounded-full bg-white opacity-50 blur-3xl" />
      {pieces.map((p, i) => (
        <span
          key={i}
          className={`absolute ${i % 3 === 0 ? "rounded-full" : "rounded-[3px]"}`}
          style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.s, height: i % 3 === 0 ? p.s : p.s * 0.55, background: p.c, transform: `rotate(${p.r}deg)` }}
        />
      ))}
    </div>
  );
}

function NightSky() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_85%_10%,rgb(109_40_217/0.45),transparent_55%),radial-gradient(90%_80%_at_10%_110%,rgb(242_105_13/0.35),transparent_60%)]" />
      <div className="absolute -top-8 -right-8 size-24 rounded-full bg-[#fff4d6] opacity-80 shadow-[0_0_80px_20px_rgb(255_222_150/0.3)] sm:top-8 sm:right-[8%] sm:size-36 sm:opacity-90" />
      <svg viewBox="0 0 400 200" className="absolute top-6 right-[20%] hidden w-96 text-black/70 sm:block">
        {[
          [40, 60, 1],
          [120, 30, 0.7],
          [210, 80, 0.85],
          [300, 40, 0.6],
        ].map(([x, y, s], i) => (
          <path
            key={i}
            transform={`translate(${x} ${y}) scale(${s})`}
            fill="currentColor"
            d="M0 10c6-8 14-10 20-4 2-4 5-6 8-5l2 5 2-5c3-1 6 1 8 5 6-6 14-4 20 4-7-2-12 0-15 5-3-2-6-2-8 1-2-3-5-3-7-1-2-3-5-3-7-1-3-5-8-6-15-4Z"
          />
        ))}
      </svg>
      <svg viewBox="0 0 1200 120" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-16 w-full text-black/35 sm:h-24">
        <path
          fill="currentColor"
          d="M0 120V80l60-10 30-30 10 30 50 6 40-26 30 20 70-12 20-34 14 34 66 10 60-30 50 22 60-6 40-40 12 40 70 10 50-18 60 16 40-30 20 30 80 4 50-26 30 22 60-8 40-24 30 30 50 4v80Z"
        />
      </svg>
    </div>
  );
}
