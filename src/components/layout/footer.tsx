import Link from "next/link";
import { OpenCartButton } from "@/components/cart/cart-drawer";
import { storeConfig } from "@/config/store";

export function Footer() {
  return (
    <footer className="mt-24 border-t border-line bg-surface">
      <div className="container-shop grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <p className="text-lg font-semibold">{storeConfig.name}</p>
          <p className="mt-2 max-w-sm text-sm text-muted">{storeConfig.description}</p>
        </div>
        <div>
          <p className="text-sm font-medium">Butik</p>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            <li>
              <Link href="/produkter" className="hover:text-ink">
                Alle produkter
              </Link>
            </li>
            <li>
              <OpenCartButton className="hover:text-ink">Kurv</OpenCartButton>
            </li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-medium">Kundeservice</p>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            <li>
              <a href={`mailto:${storeConfig.supportEmail}`} className="hover:text-ink">
                {storeConfig.supportEmail}
              </a>
            </li>
            <li>Betaling håndteres sikkert af Stripe</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-line">
        <p className="container-shop py-5 text-xs text-muted">
          © {storeConfig.name} · Testbutik – ingen rigtige ordrer
        </p>
      </div>
    </footer>
  );
}
