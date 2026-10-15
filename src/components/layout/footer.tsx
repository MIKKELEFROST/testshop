import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { INFO_LINKS } from "@/components/content/info-page";
import { company } from "@/config/company";
import { merchandising } from "@/config/merchandising";
import { storeConfig } from "@/config/store";
import { PaymentMarks } from "./payment-marks";

const TEST_MODE = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.startsWith("pk_test_") ?? false;

/** Footer in the brand's footer colours: shop, customer service, contact, payment and the company. */
export function Footer() {
  const service = INFO_LINKS.filter((l) => !["/handelsbetingelser", "/privatlivspolitik", "/cookiepolitik", "/om-os"].includes(l.href));
  const about = INFO_LINKS.filter((l) => ["/om-os", "/handelsbetingelser", "/privatlivspolitik", "/cookiepolitik"].includes(l.href));
  return (
    <footer className="bg-footer text-footer-ink">
      <div className="container-shop grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          {/* The logo uses the header's text colour: switch it to the footer's here. */}
          <Link href="/" aria-label={`${storeConfig.name} – forside`} style={{ ["--color-chrome-ink" as string]: "var(--color-footer-ink)" }}>
            <Logo />
          </Link>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-footer-muted">{storeConfig.description}</p>
          <ul className="mt-5 space-y-1.5 text-sm">
            <li>
              <a href={`mailto:${storeConfig.supportEmail}`} className="font-semibold underline underline-offset-4 hover:text-footer-ink">
                {storeConfig.supportEmail}
              </a>
            </li>
            <li className="text-footer-muted">Telefon: {company.phone}</li>
            <li className="text-footer-muted">Åbent: {company.openingHours}</li>
          </ul>
        </div>
        <FooterColumn title="Shop" links={[...merchandising.nav.map((item) => ({ label: item.label, href: item.href })), { label: "Alle produkter", href: "/produkter" }, { label: "Favoritter", href: "/favoritter" }]} />
        <FooterColumn title="Kundeservice" links={service} />
        <FooterColumn title={`Om ${storeConfig.name}`} links={about} />
      </div>
      <div className="border-t border-footer-line">
        <div className="container-shop flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
          <PaymentMarks />
          <p className="text-xs text-footer-muted">Sikker betaling med Stripe. Alle priser er inkl. moms.</p>
        </div>
      </div>
      <div className="border-t border-footer-line">
        <p className="container-shop py-5 text-xs text-footer-muted">
          © {storeConfig.name} · {company.name} · CVR {company.cvr} · {company.address}
          {TEST_MODE && <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5">Testbutik: betalinger er i testtilstand</span>}
        </p>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <nav aria-label={title}>
      <p className="text-sm font-bold">{title}</p>
      <ul className="mt-3 space-y-2 text-sm text-footer-muted">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="hover:text-footer-ink hover:underline hover:underline-offset-4">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
