/**
 * Arithmetic for the product gallery's swipe strips: a row of slides that are each as wide as
 * the strip and snap into place one at a time.
 */

/** The slide a strip shows at a scroll position (nearest slide, also while it bounces past an end). */
export function slideAt(scrollLeft: number, width: number, count: number): number {
  if (width <= 0 || count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(scrollLeft / width)));
}

/** The next or previous slide (`delta` ±1); from the last it goes round to the first and back. */
export function stepSlide(index: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (((index + delta) % count) + count) % count;
}
