import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { storeConfig } from "@/config/store";

/**
 * Calm header for the checkout: brand and reassurance only, no navigation that pulls the
 * customer away. The bag icon goes back to the cart page.
 */
export function CheckoutHeader() {
  return (
    <header className="border-b border-chrome-line bg-chrome text-chrome-ink">
      <div className="mx-auto grid h-24 max-w-[1120px] grid-cols-[44px_1fr_44px] items-center px-4 sm:px-6">
        <span aria-hidden="true" />
        <div className="text-center">
          <Link href="/" className="inline-block" aria-label={`${storeConfig.name} – forside`}>
            <Logo />
          </Link>
          <p className="mt-0.5 text-[11px] font-medium tracking-wide text-chrome-muted">
            Sikker betaling · Levering i hele Danmark<span className="hidden sm:inline"> · Dansk webshop</span>
          </p>
        </div>
        <Link
          href="/kurv"
          aria-label="Tilbage til kurven"
          className="inline-flex size-11 items-center justify-center rounded-full hover:bg-chrome-ink/10"
        >
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M5 7h14l-1.2 12.1a2 2 0 0 1-2 1.9H8.2a2 2 0 0 1-2-1.9L5 7Z" strokeLinejoin="round" />
            <path d="M9 9V6a3 3 0 0 1 6 0v3" strokeLinecap="round" />
          </svg>
        </Link>
      </div>
    </header>
  );
}
