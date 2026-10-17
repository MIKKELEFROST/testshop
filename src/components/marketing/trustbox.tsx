"use client";

import { usePathname } from "next/navigation";
import Script from "next/script";
import { useEffect, useRef } from "react";
import { TRUSTPILOT_SCRIPT, trustBox, type TrustBoxPlacement } from "@/config/trustpilot";

declare global {
  interface Window {
    Trustpilot?: { loadFromElement(element: HTMLElement, forceReload?: boolean): void };
  }
}

/**
 * The shop's TrustBox at a placement (src/config/trustpilot.ts), nothing when it shows none
 * there. Trustpilot's own markup: its script, loaded once and only when the page is idle, turns
 * it into an iframe from widget.trustpilot.com. Until then, and without JavaScript, it is the
 * link to the shop's Trustpilot page that Trustpilot requires.
 */
export function TrustBox({ placement, className }: { placement: TrustBoxPlacement; className?: string }) {
  const box = trustBox(placement);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // The script loads the TrustBoxes on the page once, when it has loaded. One that appears
    // later (after a client-side navigation) is loaded here; before that, the script does it.
    if (ref.current && window.Trustpilot) window.Trustpilot.loadFromElement(ref.current, true);
  }, [box]);

  if (!box) return null;
  const data = Object.fromEntries(Object.entries(box.data ?? {}).map(([key, value]) => [`data-${key}`, value]));
  return (
    <div className={className}>
      <div
        ref={ref}
        className="trustpilot-widget"
        data-locale={box.locale}
        data-template-id={box.templateId}
        data-businessunit-id={box.businessUnitId}
        data-style-height={box.height}
        data-style-width="100%"
        data-theme={box.theme}
        {...data}
        style={{ minHeight: box.height }}
      >
        <a href={box.profileUrl} target="_blank" rel="noopener" className="text-sm underline underline-offset-2">
          Trustpilot
        </a>
      </div>
      <Script id="trustpilot-bootstrap" src={TRUSTPILOT_SCRIPT} strategy="lazyOnload" />
    </div>
  );
}

/**
 * The trust strip's TrustBox, on the front page only (the strip is on every page, above the
 * footer, which has its own). usePathname needs a Suspense boundary around it.
 */
export function FrontPageTrustBox({ className }: { className?: string }) {
  return usePathname() === "/" ? <TrustBox placement="strip" className={className} /> : null;
}

/**
 * The footer's TrustBox, on every page but the order pages. An order page's address holds the
 * order key (anyone with it can see the order) and, after a redirect payment, Stripe's client
 * secret, and Trustpilot's statistics get the address of each page that shows a TrustBox.
 * usePathname needs a Suspense boundary around it.
 */
export function FooterTrustBox({ className }: { className?: string }) {
  return usePathname().startsWith("/ordre/") ? null : <TrustBox placement="footer" className={className} />;
}
