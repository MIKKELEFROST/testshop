import localFont from "next/font/local";

/**
 * The brands' heading fonts (`font` in src/config/store.ts), loaded with next/font: each gets a
 * fallback font sized to its metrics, so a heading takes the same room before the font has
 * arrived and does not jump when it swaps in (it did, by up to 160 px on a phone, with the plain
 * @font-face rules). Not preloaded: a shop uses one of the two, and a preload would make every
 * page of the other shop download it too. Latin only (Danish, with æ, ø and å); a rarer letter
 * is drawn by the fallback.
 */
export const fredoka = localFont({
  src: "../../node_modules/@fontsource-variable/fredoka/files/fredoka-latin-wght-normal.woff2",
  weight: "300 700",
  style: "normal",
  display: "swap",
  preload: false,
  variable: "--font-fredoka",
});

export const bebasNeue = localFont({
  src: "../../node_modules/@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2",
  weight: "400",
  style: "normal",
  display: "swap",
  preload: false,
  variable: "--font-bebas-neue",
});
