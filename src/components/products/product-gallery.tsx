"use client";

import { ChevronLeft, ChevronRight, Play, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type UIEvent } from "react";
import { slideAt, stepSlide } from "@/lib/gallery";
import type { ProductImage as ProductImageType } from "@/types/commerce";
import { ProductImage } from "./product-image";

type Slide = { kind: "image"; image: ProductImageType } | { kind: "video"; id: string };

// A row of full-width slides that snap into place one at a time; no scrollbar (swipe, the
// thumbnails or the arrows move it).
const STRIP = "flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

/** Slide smoothly, unless the customer has asked for less motion. */
function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

/**
 * Keeps a strip of full-width slides on `index`: a new index slides it there, and a swipe that
 * comes to rest on another slide reports that one. It reports only once the strip has settled,
 * so a strip on its way to a slide is not turned round halfway.
 */
function useSlideStrip(index: number, count: number, onIndexChange: (index: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  // The slide the strip is on, or on its way to.
  const shown = useRef(index);
  const settle = useRef<number | undefined>(undefined);

  useEffect(() => {
    const strip = ref.current;
    if (!strip || index === shown.current) return;
    shown.current = index;
    strip.scrollTo({ left: index * strip.clientWidth, behavior: scrollBehavior() });
  }, [index]);

  useEffect(() => () => window.clearTimeout(settle.current), []);

  function onScroll(event: UIEvent<HTMLDivElement>) {
    const strip = event.currentTarget;
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      const next = slideAt(strip.scrollLeft, strip.clientWidth, count);
      if (next === shown.current) return;
      shown.current = next;
      onIndexChange(next);
    }, 100);
  }

  return [ref, onScroll] as const;
}

/**
 * Photos and videos in a strip the customer can swipe, one at a time, in step with the
 * thumbnails and with "2/4" on phones. A tap on a photo opens it full screen, where it can be
 * pinch-zoomed and swiped, or stepped through with the arrows (and the arrow keys).
 * A video shows a play button over the product photo and loads YouTube (privacy-enhanced mode)
 * only when the customer starts it, so no YouTube cookies or requests before that.
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
  const current = Math.min(index, Math.max(slides.length - 1, 0));
  const active = slides[current];
  const [playing, setPlaying] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const poster = images[0] ?? null;
  const photoButtons = useRef<(HTMLButtonElement | null)[]>([]);

  function select(next: number) {
    setPlaying(null);
    onIndexChange(next);
  }

  // Swipes, the thumbnails, the full-screen view and a new size's photo all move the same index.
  const [stripRef, onStripScroll] = useSlideStrip(current, slides.length, select);

  function closeViewer() {
    setViewerOpen(false);
    // Back on the photo the customer ended on. Not every phone focuses a button on tap, so the
    // dialog cannot always return focus by itself.
    photoButtons.current[current]?.focus({ preventScroll: true });
  }

  return (
    <div>
      <div className="relative">
        {/* The focus ring goes round the whole strip: the photo would cover a ring on the button. */}
        <div
          ref={stripRef}
          onScroll={onStripScroll}
          className={`${STRIP} rounded-[var(--radius-card)] bg-white ring-1 ring-line has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent`}
        >
          {slides.length === 0 && (
            <div className="relative aspect-square w-full shrink-0">
              <ProductImage image={null} name={name} sizes="(min-width: 1024px) 55vw, 100vw" />
            </div>
          )}
          {slides.map((slide, i) => (
            <div
              key={slide.kind === "image" ? slide.image.src : `video-${slide.id}`}
              className="relative aspect-square w-full shrink-0 snap-center snap-always"
              aria-hidden={i !== current || undefined}
            >
              {slide.kind === "image" ? (
                <button
                  type="button"
                  ref={(element) => {
                    photoButtons.current[i] = element;
                  }}
                  tabIndex={i === current ? 0 : -1}
                  onClick={() => setViewerOpen(true)}
                  aria-label={`Forstør billede ${i + 1} af ${images.length}`}
                  className="absolute inset-0 cursor-zoom-in focus-visible:outline-none"
                >
                  <ProductImage image={slide.image} name={name} priority={i === 0} sizes="(min-width: 1024px) 55vw, 100vw" />
                </button>
              ) : playing === slide.id ? (
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${slide.id}?autoplay=1&rel=0`}
                  title={`Video: ${name}`}
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                  allowFullScreen
                  className="absolute inset-0 size-full"
                />
              ) : (
                <button
                  type="button"
                  tabIndex={i === current ? 0 : -1}
                  onClick={() => setPlaying(slide.id)}
                  className="group absolute inset-0 focus-visible:outline-none"
                  aria-label={`Afspil video: ${name}`}
                >
                  <ProductImage image={poster} name={name} sizes="(min-width: 1024px) 55vw, 100vw" className="opacity-60" />
                  <span className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                    <span className="flex size-20 items-center justify-center rounded-full bg-ink/80 text-white shadow-xl transition-transform group-hover:scale-105">
                      <Play className="ml-1 size-9 fill-current" aria-hidden="true" />
                    </span>
                    <span className="rounded-full bg-white/90 px-3 py-1 text-sm font-semibold text-ink">Afspil video (YouTube)</span>
                  </span>
                </button>
              )}
            </div>
          ))}
        </div>
        {badge && (!active || active.kind === "image") && (
          <span className="pointer-events-none absolute top-3 left-3 rounded-md bg-sale px-2.5 py-1.5 text-base leading-none font-extrabold text-white">{badge}</span>
        )}
        {slides.length > 1 && playing === null && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-3 bottom-3 rounded-full bg-ink/75 px-2.5 py-1 text-xs font-semibold text-white tabular-nums lg:hidden"
          >
            {current + 1}/{slides.length}
          </span>
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
                aria-current={i === current}
                className={`relative block aspect-square w-full overflow-hidden rounded-lg bg-white ring-1 ${
                  i === current ? "ring-2 ring-ink" : "ring-line hover:ring-line-strong"
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

      {viewerOpen && images.length > 0 && (
        <PhotoViewer images={images} name={name} index={Math.min(current, images.length - 1)} onIndexChange={select} onClose={closeViewer} />
      )}
    </div>
  );
}

/**
 * The photos full screen, in a native modal <dialog> (focus trap, Esc closes): swipe or use the
 * arrows (also the arrow keys) to step through them, and pinch to zoom on a phone.
 */
function PhotoViewer({
  images,
  name,
  index,
  onIndexChange,
  onClose,
}: {
  images: ProductImageType[];
  name: string;
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [start] = useState(index);
  const count = images.length;
  const [stripRef, onStripScroll] = useSlideStrip(index, count, onIndexChange);

  // Open on the photo the customer tapped, without sliding there.
  useEffect(() => {
    const dialog = dialogRef.current;
    const element = stripRef.current;
    if (!dialog || !element) return;
    if (!dialog.open) dialog.showModal();
    element.scrollLeft = start * element.clientWidth;
  }, [start, stripRef]);

  // The page behind must not scroll. Keep the scrollbar's space so the layout does not shift.
  useEffect(() => {
    const root = document.documentElement;
    const hadScrollbar = window.innerWidth > root.clientWidth;
    const previous = { overflow: root.style.overflow, scrollbarGutter: root.style.scrollbarGutter };
    root.style.overflow = "hidden";
    if (hadScrollbar) root.style.scrollbarGutter = "stable";
    return () => {
      root.style.overflow = previous.overflow;
      root.style.scrollbarGutter = previous.scrollbarGutter;
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    onIndexChange(stepSlide(index, event.key === "ArrowRight" ? 1 : -1, count));
  }

  const arrow = "absolute top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 text-ink shadow-md ring-1 ring-line hover:bg-surface";
  return (
    <dialog
      ref={dialogRef}
      aria-label={`Billeder af ${name}`}
      onClose={onClose}
      onKeyDown={handleKeyDown}
      className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none touch-pan-x touch-pinch-zoom bg-surface p-0 text-ink backdrop:bg-ink/60"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-4 py-2 pr-2 pl-5">
          <p className="text-sm font-semibold text-ink-soft tabular-nums" aria-live="polite">
            <span className="sr-only">
              Billede {index + 1} af {count}
            </span>
            <span aria-hidden="true">
              {index + 1}/{count}
            </span>
          </p>
          <button
            type="button"
            autoFocus
            onClick={() => dialogRef.current?.close()}
            aria-label="Luk billederne"
            className="inline-flex size-11 items-center justify-center rounded-full hover:bg-black/5"
          >
            <X className="size-6" aria-hidden="true" />
          </button>
        </div>
        <div className="relative min-h-0 flex-1">
          <div ref={stripRef} onScroll={onStripScroll} className={`${STRIP} h-full`}>
            {images.map((image, i) => (
              <div key={image.src} className="relative h-full w-full shrink-0 snap-center snap-always" aria-hidden={i !== index || undefined}>
                <ProductImage image={image} name={name} sizes="100vw" className="object-contain!" />
              </div>
            ))}
          </div>
          {count > 1 && (
            <>
              <button type="button" onClick={() => onIndexChange(stepSlide(index, -1, count))} aria-label="Forrige billede" className={`${arrow} left-3`}>
                <ChevronLeft className="size-6" aria-hidden="true" />
              </button>
              <button type="button" onClick={() => onIndexChange(stepSlide(index, 1, count))} aria-label="Næste billede" className={`${arrow} right-3`}>
                <ChevronRight className="size-6" aria-hidden="true" />
              </button>
            </>
          )}
        </div>
        <p className="hidden py-3 text-center text-xs text-muted pointer-coarse:block">Zoom ind med to fingre</p>
      </div>
    </dialog>
  );
}
