"use client";

import { Play } from "lucide-react";
import { useState } from "react";
import type { ProductImage as ProductImageType } from "@/types/commerce";
import { ProductImage } from "./product-image";

type Slide = { kind: "image"; image: ProductImageType } | { kind: "video"; id: string };

/**
 * Photos and videos. A video shows a play button over the product photo and loads YouTube
 * (privacy-enhanced mode) only when the customer starts it, so no YouTube cookies or requests
 * before that.
 */
export function ProductGallery({
  images,
  videos,
  name,
  badge,
  index,
  onIndexChange,
}: {
  images: ProductImageType[];
  videos: string[];
  name: string;
  badge?: string | null;
  index: number;
  onIndexChange: (index: number) => void;
}) {
  const slides: Slide[] = [...images.map((image) => ({ kind: "image" as const, image })), ...videos.map((id) => ({ kind: "video" as const, id }))];
  const active = slides[Math.min(index, Math.max(slides.length - 1, 0))];
  const [playing, setPlaying] = useState<string | null>(null);
  const poster = images[0] ?? null;

  function select(next: number) {
    setPlaying(null);
    onIndexChange(next);
  }

  return (
    <div>
      <div className="relative aspect-square overflow-hidden rounded-[var(--radius-card)] bg-white ring-1 ring-line">
        {!active || active.kind === "image" ? (
          <ProductImage image={active?.image ?? null} name={name} priority sizes="(min-width: 1024px) 55vw, 100vw" />
        ) : playing === active.id ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${active.id}?autoplay=1&rel=0`}
            title={`Video: ${name}`}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            className="absolute inset-0 size-full"
          />
        ) : (
          <button type="button" onClick={() => setPlaying(active.id)} className="group absolute inset-0" aria-label={`Afspil video: ${name}`}>
            <ProductImage image={poster} name={name} sizes="(min-width: 1024px) 55vw, 100vw" className="opacity-60" />
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <span className="flex size-20 items-center justify-center rounded-full bg-ink/80 text-white shadow-xl transition-transform group-hover:scale-105">
                <Play className="ml-1 size-9 fill-current" aria-hidden="true" />
              </span>
              <span className="rounded-full bg-white/90 px-3 py-1 text-sm font-semibold text-ink">Afspil video (YouTube)</span>
            </span>
          </button>
        )}
        {badge && (!active || active.kind === "image") && (
          <span className="absolute top-3 left-3 rounded-md bg-sale px-2.5 py-1.5 text-base leading-none font-extrabold text-white">{badge}</span>
        )}
      </div>

      {slides.length > 1 && (
        <ul className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          {slides.map((slide, i) => (
            <li key={slide.kind === "image" ? slide.image.src : `video-${slide.id}`} className="w-16 shrink-0 sm:w-[4.75rem]">
              <button
                type="button"
                onClick={() => select(i)}
                aria-label={slide.kind === "image" ? `Vis billede ${i + 1}` : "Vis video"}
                aria-current={i === index}
                className={`relative block aspect-square w-full overflow-hidden rounded-lg bg-white ring-1 ${
                  i === index ? "ring-2 ring-ink" : "ring-line hover:ring-line-strong"
                }`}
              >
                {slide.kind === "image" ? (
                  <ProductImage image={slide.image} name={name} sizes="12vw" />
                ) : (
                  <>
                    <ProductImage image={poster} name={name} sizes="12vw" className="opacity-50" />
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="flex size-9 items-center justify-center rounded-full bg-ink/80 text-white">
                        <Play className="ml-0.5 size-4 fill-current" aria-hidden="true" />
                      </span>
                    </span>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
