import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The terms, withdrawal rights and privacy policy, reachable from every step where the
 * customer pays (forbrugeraftaleloven § 8, e-handelsloven § 7). They open in a new tab, so
 * the checkout form keeps what the customer has typed.
 */
export const LEGAL_LINKS = [
  { label: "Handelsbetingelser", href: "/handelsbetingelser" },
  { label: "Fortrydelsesret og returret", href: "/fortrydelsesret" },
  { label: "Privatlivspolitik", href: "/privatlivspolitik" },
] as const;

export function LegalLink({ href, className = "underline underline-offset-2 hover:text-ink", children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <Link href={href} target="_blank" rel="noopener" className={className}>
      {children}
      <span className="sr-only"> (åbner i en ny fane)</span>
    </Link>
  );
}

/** When the customer is charged (capture at shipment, see lib/checkout/settle.ts). */
export const PAYMENT_TIMING = "Beløbet reserveres nu og trækkes først, når vi sender varerne.";

/**
 * "Ved at trykke på Betal nu accepterer du …", under the pay button and the wallet buttons. With
 * an 18+ item in the cart it also says that paying confirms the buyer's age, as the terms do.
 */
export function TermsNotice({ action, adult = false }: { action: string; adult?: boolean }) {
  return (
    <>
      {adult && (
        <>
          <strong className="font-semibold text-ink-soft">Din kurv indeholder varer for voksne (18+).</strong> Ved at {action} bekræfter du, at du er
          fyldt 18 år.{" "}
        </>
      )}
      {PAYMENT_TIMING} Ved at {action} accepterer du vores <LegalLink href="/handelsbetingelser">handelsbetingelser</LegalLink>. Læs også om{" "}
      <LegalLink href="/fortrydelsesret">fortrydelsesret og 30 dages returret</LegalLink> samt vores{" "}
      <LegalLink href="/privatlivspolitik">privatlivspolitik</LegalLink>.
    </>
  );
}
