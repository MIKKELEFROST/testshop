import { Check } from "lucide-react";
import { UspIcon } from "@/components/icons/usp-icons";
import { resolveTexts, resolveUsps, USP_BAR, USP_PRODUCT, USP_STRIP } from "@/config/usps";
import { getFreeShippingFrom } from "@/lib/woocommerce/shipping";

/** The five selling points with large icons, above the footer. */
export async function UspStrip() {
  const usps = resolveUsps(USP_STRIP, await getFreeShippingFrom());
  if (usps.length === 0) return null;
  return (
    <section aria-label="Derfor handler du hos os" className="mt-20 border-t border-line bg-surface">
      {/* Scrolls sideways on phones: focusable, so the keyboard can scroll it too (arrow keys). */}
      <ul tabIndex={0} aria-label="Fordele" className="container-shop flex snap-x gap-6 overflow-x-auto py-10 sm:grid sm:grid-cols-3 sm:gap-y-10 lg:grid-cols-5">
        {usps.map((usp) => (
          <li key={usp.title} className="flex w-36 shrink-0 snap-start flex-col items-center text-center sm:w-auto">
            <UspIcon name={usp.icon} className="size-14 text-price" strokeWidth={1.4} />
            <p className="mt-4 text-[15px] font-bold text-ink-soft">{usp.title}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 2 × 2 promises under "Læg i kurv" (delivery, Danish shop, free shipping, rating). */
export async function ProductUsps() {
  const usps = resolveUsps(USP_PRODUCT, await getFreeShippingFrom());
  if (usps.length === 0) return null;
  return (
    <ul className="grid gap-x-6 gap-y-5 border-y border-line py-6 sm:grid-cols-2">
      {usps.map((usp) => (
        <li key={usp.title} className="flex items-start gap-3.5">
          <UspIcon
            name={usp.icon}
            className={usp.icon === "denmark" ? "mt-1 h-6 w-8 shrink-0" : "size-8 shrink-0 text-ink-soft/80"}
            strokeWidth={1.7}
          />
          <p className="leading-snug">
            <span className="block text-[15px] font-bold text-ink-soft">{usp.title}</span>
            {usp.text && <span className="block text-sm text-muted">{usp.text}</span>}
          </p>
        </li>
      ))}
    </ul>
  );
}

/** The bar above the header: one promise on phones, three on larger screens. */
export async function UspBar() {
  return <UspBarItems texts={resolveTexts(USP_BAR, await getFreeShippingFrom())} />;
}

export function UspBarItems({ texts }: { texts: string[] }) {
  return (
    <ul className="container-shop flex h-9 items-center justify-center gap-8 text-xs font-medium tracking-wide">
      {texts.map((text, index) => (
        <li key={text} className={`items-center gap-1.5 ${index === 0 ? "flex" : "hidden sm:flex"}`}>
          <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
          {text}
        </li>
      ))}
    </ul>
  );
}
