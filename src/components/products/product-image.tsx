import Image from "next/image";
import type { ProductImage as ProductImageType } from "@/types/commerce";

/** Product image with a neutral, branded placeholder when WooCommerce has no image. */
export function ProductImage({
  image,
  name,
  sizes,
  priority = false,
  className = "",
}: {
  image: ProductImageType | null;
  name: string;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  if (!image) {
    return (
      <div
        className={`flex size-full items-center justify-center bg-gradient-to-br from-[#efe9e1] to-[#e2dad0] ${className}`}
        role="img"
        aria-label={name}
      >
        <span className="text-5xl font-semibold text-black/10 select-none">{name.slice(0, 1)}</span>
      </div>
    );
  }

  return (
    <Image
      src={image.src}
      alt={image.alt || name}
      fill
      sizes={sizes}
      priority={priority}
      className={`object-cover ${className}`}
    />
  );
}
