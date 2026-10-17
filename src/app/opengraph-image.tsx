import { ImageResponse } from "next/og";
import { storeConfig } from "@/config/store";
import { BrandLockup, brandFonts } from "@/lib/brand-images";

/** The share image for links to the shop (product pages use the product's photo instead). */

export const alt = storeConfig.name;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  const halloween = storeConfig.season === "halloween";
  const theme = storeConfig.theme;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 90px",
          background: halloween
            ? "radial-gradient(circle at 85% 15%, #4c1d95 0%, #140f1d 55%)"
            : "linear-gradient(135deg, #ffd84d 0%, #ffd84d 55%, #ff9ec2 100%)",
          color: halloween ? "#ffffff" : (theme.ink ?? "#1d2246"),
        }}
      >
        <BrandLockup scale={1.6} onDark={halloween} />
        <div style={{ marginTop: 44, fontSize: 46, fontWeight: 700, lineHeight: 1.2, maxWidth: 900, display: "flex" }}>{storeConfig.tagline}</div>
        <div style={{ marginTop: 26, fontSize: 28, display: "flex", gap: 28, color: halloween ? "#f2690d" : (theme.accent ?? "#2446c8") }}>
          <span>1-dags levering</span>
          <span>·</span>
          <span>Gratis retur i 30 dage</span>
          <span>·</span>
          <span>Dansk webshop</span>
        </div>
      </div>
    ),
    { ...size, fonts: await brandFonts() },
  );
}
