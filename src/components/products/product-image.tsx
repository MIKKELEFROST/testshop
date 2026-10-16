"use client";

import Image from "next/image";
import { useState } from "react";
import type { ProductImage as ProductImageType } from "@/types/commerce";

/**
 * Product image with a neutral, branded placeholder when there is no image or it fails to
 * load (e.g. a supplier link that has gone). Supplier photos (`fit: "contain"`) are shown
 * whole on white instead of cropped. `decorative`: the image sits next to the product's name
 * (in the same link or button), so screen readers skip it instead of reading the name twice.
 */
export function ProductImage({
  image,
  name,
  sizes,
  priority = false,
  decorative = false,
  className = "",
}: {
  image: ProductImageType | null;
  name: string;
  sizes: string;
  priority?: boolean;
  decorative?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);

  if (!image || failed === image.src) {
    return (
      <div
        className={`flex size-full items-center justify-center bg-gradient-to-br from-tint to-tint-strong ${className}`}
        role={decorative ? undefined : "img"}
        aria-label={decorative ? undefined : name}
        aria-hidden={decorative || undefined}
      >
        <span className="text-5xl font-semibold text-black/10 select-none">{name.slice(0, 1)}</span>
      </div>
    );
  }

  const contain = image.fit === "contain";
  return (
    <Image
      src={image.src}
      alt={decorative ? "" : image.alt || name}
      fill
      sizes={sizes}
      priority={priority}
      onError={() => setFailed(image.src)}
      className={`${contain ? "bg-white object-contain p-[6%]" : "object-cover"} ${className}`}
    />
  );
}
