import type { ReactNode } from "react";
import { Alert } from "@/components/ui/alert";

/** A failed quote with "Prøv igen" (the quote is also asked for again by itself, see use-quote.ts). */
export function QuoteError({ error, onRetry, children }: { error: string; onRetry: () => void; children?: ReactNode }) {
  return (
    <Alert tone="error">
      <p>{error}</p>
      {children && <p className="mt-1 text-ink-soft">{children}</p>}
      <button
        type="button"
        onClick={onRetry}
        className="-mx-2 mt-1 inline-flex min-h-11 items-center px-2 font-medium underline underline-offset-4 hover:text-ink"
      >
        Prøv igen
      </button>
    </Alert>
  );
}
