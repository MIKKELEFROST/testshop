import { ImageResponse } from "next/og";
import { BrandLockup, brandFonts } from "@/lib/brand-images";

/**
 * GET /email-logo.png — the shop's logo for its order e-mails (the plugin shows it in the
 * e-mail header; see src/lib/checkout/branding.ts). Transparent, for a light background.
 */
export async function GET() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <BrandLockup />
      </div>
    ),
    { width: 480, height: 120, fonts: await brandFonts(), headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
