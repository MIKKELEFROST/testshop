import type { StockStatus } from "@/types/commerce";

export function stockLabel(status: StockStatus, quantity: number | null): { text: string; tone: "ok" | "low" | "out" } {
  if (status === "outofstock" || quantity === 0) return { text: "Udsolgt", tone: "out" };
  if (status === "onbackorder") return { text: "I restordre – leveres senere", tone: "low" };
  if (quantity !== null && quantity <= 3) return { text: `Kun ${quantity} tilbage`, tone: "low" };
  return { text: "På lager", tone: "ok" };
}

export function StockBadge({ status, quantity }: { status: StockStatus; quantity: number | null }) {
  const { text, tone } = stockLabel(status, quantity);
  const dot = tone === "ok" ? "bg-success" : tone === "low" ? "bg-warning" : "bg-danger";
  return (
    <p className="flex items-center gap-2 text-sm text-ink-soft">
      <span className={`size-2 rounded-full ${dot}`} aria-hidden="true" />
      {text}
    </p>
  );
}
