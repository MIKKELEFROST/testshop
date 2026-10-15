/**
 * Splits a product description (plain-text paragraphs) into what the product page shows in
 * different places: the sizes paragraph ("Størrelser: 3-4 år (109 cm), …") next to the size
 * buttons, the producer ("Producent: …") under product safety, and the rest as the
 * description. Paragraphs written another way simply stay in the description.
 */
export type ProductText = {
  about: string[];
  sizes: string | null;
  producer: string | null;
  /** Size option -> body height, e.g. { "3-4 år": "109 cm" }. */
  heights: Record<string, string>;
};

const SIZES = /^Størrelser:\s*/i;
const PRODUCER = /^Producent:\s*/i;

export function splitProductText(paragraphs: string[]): ProductText {
  const about: string[] = [];
  let sizes: string | null = null;
  let producer: string | null = null;
  for (const paragraph of paragraphs) {
    if (sizes === null && SIZES.test(paragraph)) sizes = paragraph;
    else if (producer === null && PRODUCER.test(paragraph)) producer = paragraph;
    else about.push(paragraph);
  }
  return { about, sizes, producer, heights: sizes ? sizeHeights(sizes) : {} };
}

/** "Størrelser: 3-4 år (109 cm), 5-6 år (123 cm) og L (42-44) (180 cm)." -> size -> height. */
export function sizeHeights(paragraph: string): Record<string, string> {
  const list = paragraph.replace(SIZES, "").replace(/\.\s*$/, "");
  const heights: Record<string, string> = {};
  for (const item of list.split(/,\s+|\s+og\s+/)) {
    const match = /^(.+?)\s*\((\d+(?:\s*[–-]\s*\d+)?\s*cm)\)$/.exec(item.trim());
    if (match) heights[match[1]!] = match[2]!.replace(/\s+/g, " ");
  }
  return heights;
}
