import { company } from "@/config/company";
import { storeConfig } from "@/config/store";
import { LEGAL_LINKS, LegalLink } from "./legal-links";

/**
 * Slim footer for the checkout: who the customer buys from (e-handelsloven § 7: name, address,
 * CVR and e-mail) and the terms. The shop footer's navigation is left out on purpose.
 */
export function CheckoutFooter() {
  return (
    <footer className="border-t border-line bg-paper">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-3 px-4 py-6 text-xs text-muted sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <p className="leading-relaxed">
          {storeConfig.name} · {company.name} · {company.address} · CVR {company.cvr} ·{" "}
          <a href={`mailto:${storeConfig.supportEmail}`} className="wrap-anywhere underline underline-offset-2 hover:text-ink">
            {storeConfig.supportEmail}
          </a>
        </p>
        <nav aria-label="Vilkår">
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {LEGAL_LINKS.map((link) => (
              <li key={link.href}>
                <LegalLink href={link.href}>{link.label}</LegalLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
