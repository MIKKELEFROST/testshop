import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { LogoMark } from "@/components/brand/logo";
import { storeConfig } from "@/config/store";

/**
 * The brand in generated images (favicon, share image, e-mail logo). They have no CSS, so the
 * heading font is loaded from assets/fonts (both fonts are under the SIL Open Font License).
 */

const FONT_FILES = { fredoka: "fredoka-latin-700-normal.woff", bebas: "bebas-neue-latin-400-normal.woff" };

const halloween = storeConfig.logo.mark === "pumpkin";

// Read once, when the module is loaded (as in Next.js's opengraph-image docs). Read inside the
// image function, it made /opengraph-image render on every request instead of being prerendered.
const fontData = await readFile(join(process.cwd(), "assets/fonts", halloween ? FONT_FILES.bebas : FONT_FILES.fredoka));

export async function brandFonts() {
  return [{ name: "Brand", data: fontData, weight: (halloween ? 400 : 700) as 400 | 700, style: "normal" as const }];
}

/** The logo as it stands on a light background (e-mails) or a dark one (share image). */
export function BrandLockup({ scale = 1, onDark = false }: { scale?: number; onDark?: boolean }) {
  const theme = storeConfig.theme;
  const word = onDark ? "#ffffff" : (theme.ink ?? "#1d1b19");
  const suffix = halloween ? (theme.action ?? "#f2690d") : (theme.highlight ?? "#e8336f");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 * scale }}>
      <LogoMark mark={storeConfig.logo.mark} size={76 * scale} />
      <div style={{ display: "flex", flexDirection: "column", fontFamily: "Brand", lineHeight: 1 }}>
        <span style={{ fontSize: (halloween ? 58 : 46) * scale, color: word, letterSpacing: halloween ? 1 : -0.5, textTransform: halloween ? "uppercase" : "none" }}>
          {storeConfig.logo.word}
        </span>
        <span
          style={{
            fontSize: (halloween ? 24 : 30) * scale,
            color: suffix,
            letterSpacing: halloween ? 7 * scale : 0,
            textTransform: halloween ? "uppercase" : "none",
            marginTop: halloween ? 2 * scale : 0,
          }}
        >
          {storeConfig.logo.suffix}
        </span>
      </div>
    </div>
  );
}
