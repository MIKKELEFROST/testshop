import { formatPrice } from "@/lib/money";

/** Price with sale price / regular price and "fra" for variable products. */
export function Price({
  price,
  regularPrice,
  onSale,
  range,
  size = "md",
}: {
  price: string | null;
  regularPrice?: string | null;
  onSale?: boolean;
  range?: { min: string; max: string } | null;
  size?: "md" | "lg";
}) {
  const text = size === "lg" ? "text-2xl" : "text-[15px]";

  if (range && range.min !== range.max) {
    return (
      <p className={`${text} font-medium`}>
        <span className="text-muted">fra </span>
        {formatPrice(range.min)}
      </p>
    );
  }

  if (!price) return <p className={`${text} text-muted`}>Pris ikke tilgængelig</p>;

  const showSale = onSale && regularPrice && regularPrice !== price;
  return (
    <p className={`${text} flex flex-wrap items-baseline gap-x-2 font-medium`}>
      <span className={showSale ? "text-sale" : ""}>{formatPrice(price)}</span>
      {showSale && (
        <span className="text-[0.85em] font-normal text-muted line-through">
          <span className="sr-only">Før </span>
          {formatPrice(regularPrice)}
        </span>
      )}
    </p>
  );
}
