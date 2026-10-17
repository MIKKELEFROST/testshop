const number = new Intl.NumberFormat("da-DK");

/** "1 vare", "8.623 varer". */
export function productCount(total: number): string {
  return `${number.format(total)} ${total === 1 ? "vare" : "varer"}`;
}
