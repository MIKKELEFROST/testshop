/** Whole percentage off the regular price; null unless both prices are known and the price is lower. */
export function discountPercent(price: string | null, regularPrice: string | null, onSale: boolean): number | null {
  if (!onSale || !price || !regularPrice) return null;
  // Display only: a rounded percentage from two 2-decimal amounts.
  const now = Number(price);
  const before = Number(regularPrice);
  if (!(before > 0) || !(now >= 0) || now >= before) return null;
  const percent = Math.round((1 - now / before) * 100);
  return percent >= 1 ? percent : null;
}
