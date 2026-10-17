import { ImageResponse } from "next/og";
import { LogoMark } from "@/components/brand/logo";
import { storeConfig } from "@/config/store";

/** Favicon: the brand's mark (the cat in the barrel, or the jack-o'-lantern). */

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <LogoMark mark={storeConfig.logo.mark} size={64} />
      </div>
    ),
    size,
  );
}
