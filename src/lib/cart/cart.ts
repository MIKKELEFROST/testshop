import { z } from "zod";

/** Pure cart state logic (no React), unit tested. */

export const MAX_LINE_QUANTITY = 99;
export const MAX_LINES = 50;

export type CartLine = {
  key: string;
  productId: number;
  variationId: number;
  quantity: number;
  name: string;
  slug: string;
  /** e.g. "Størrelse: M" */
  variantLabel?: string;
  image?: { src: string; alt: string } | null;
  /** Display price when added. Informational only — never used to charge. */
  unitPrice: string | null;
  /** Known stock when added (null = not tracked). Server re-validates. */
  maxQuantity: number | null;
};

export type CartAction =
  | { type: "add"; line: Omit<CartLine, "key"> }
  | { type: "setQuantity"; key: string; quantity: number }
  | { type: "remove"; key: string }
  | { type: "replace"; lines: CartLine[] };

export function lineKey(productId: number, variationId: number) {
  return `${productId}:${variationId}`;
}

function clampQuantity(quantity: number, max: number | null) {
  const upper = Math.min(MAX_LINE_QUANTITY, max ?? MAX_LINE_QUANTITY);
  return Math.max(0, Math.min(Math.floor(quantity), upper));
}

export function cartReducer(lines: CartLine[], action: CartAction): CartLine[] {
  switch (action.type) {
    case "add": {
      const key = lineKey(action.line.productId, action.line.variationId);
      const existing = lines.find((l) => l.key === key);
      if (existing) {
        const quantity = clampQuantity(existing.quantity + action.line.quantity, action.line.maxQuantity);
        return lines.map((l) => (l.key === key ? { ...l, ...action.line, key, quantity: Math.max(quantity, 1) } : l));
      }
      if (lines.length >= MAX_LINES) return lines;
      const quantity = clampQuantity(action.line.quantity, action.line.maxQuantity);
      if (quantity < 1) return lines;
      return [...lines, { ...action.line, key, quantity }];
    }
    case "setQuantity": {
      return lines
        .map((l) => (l.key === action.key ? { ...l, quantity: clampQuantity(action.quantity, null) } : l))
        .filter((l) => l.quantity > 0);
    }
    case "remove":
      return lines.filter((l) => l.key !== action.key);
    case "replace":
      return action.lines;
  }
}

const storedLineSchema = z.object({
  productId: z.number().int().positive(),
  variationId: z.number().int().nonnegative(),
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
  name: z.string().max(300),
  slug: z.string().max(300),
  variantLabel: z.string().max(300).optional(),
  image: z.object({ src: z.string().max(2000), alt: z.string().max(300) }).nullable().optional(),
  unitPrice: z.string().max(20).nullable(),
  maxQuantity: z.number().int().nullable(),
});

const storedCartSchema = z.object({ version: z.literal(1), lines: z.array(storedLineSchema).max(MAX_LINES) });

export function cartStorageKey(storeId: string) {
  return `cart:v1:${storeId}`;
}

export function serializeCart(lines: CartLine[]): string {
  return JSON.stringify({
    version: 1,
    lines: lines.map((line) => {
      const { key, ...rest } = line;
      void key; // derived from productId/variationId when reading
      return rest;
    }),
  });
}

/** Corrupt or tampered storage simply yields an empty cart. */
export function deserializeCart(raw: string | null): CartLine[] {
  if (!raw) return [];
  try {
    const parsed = storedCartSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return [];
    const seen = new Set<string>();
    return parsed.data.lines.flatMap((line) => {
      const key = lineKey(line.productId, line.variationId);
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ ...line, key }];
    });
  } catch {
    return [];
  }
}
