import type { StockStatus } from "@/types/commerce";

export function stockLabel(status: StockStatus, quantity: number | null): { text: string; tone: "ok" | "low" | "out" } {
  if (status === "outofstock" || quantity === 0) return { text: "Udsolgt", tone: "out" };
  if (status === "onbackorder") return { text: "I restordre – leveres senere", tone: "low" };
  if (quantity !== null && quantity <= 3) return { text: `Kun ${quantity} tilbage`, tone: "low" };
  return { text: "På lager", tone: "ok" };
}
