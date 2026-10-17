import { ImageResponse } from "next/og";
import { LogoMark } from "@/components/brand/logo";
import { storeConfig } from "@/config/store";

/** Home screen icon: the mark on the brand's hero colour. */

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: storeConfig.theme.hero ?? "#ffffff" }}>
        <LogoMark mark={storeConfig.logo.mark} size={132} />
      </div>
    ),
    size,
  );
}
