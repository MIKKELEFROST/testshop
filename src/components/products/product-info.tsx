import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { DELIVERY_FACTS, resolveTexts } from "@/config/usps";
import type { ProductText } from "@/lib/product-text";
import { getFreeShippingFrom } from "@/lib/woocommerce/shipping";
import type { Product } from "@/types/commerce";

/** Description, sizes, delivery and product safety as sections that fold out. */
export async function ProductInfo({ product, text }: { product: Product; text: ProductText }) {
  const freeShippingFrom = await getFreeShippingFrom();
  return (
    <div className="divide-y divide-line border-b border-line">
      {text.about.length > 0 && (
        <Section title="Produktbeskrivelse" open>
          {text.about.map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
        </Section>
      )}
      {(text.sizes || product.sizeChart) && (
        <Section title="Størrelser og pasform">
          {text.sizes && <p>{text.sizes}</p>}
          {product.sizeChart && (
            <p>
              <a href={product.sizeChart} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-4 hover:text-ink">
                Se størrelsesguiden
              </a>
            </p>
          )}
        </Section>
      )}
      <Section title="Levering og retur">
        <ul className="list-disc space-y-1 pl-5">
          {resolveTexts(DELIVERY_FACTS, freeShippingFrom).map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      </Section>
      {(text.producer || product.safetyInfo || product.sku) && (
        <Section title="Produktsikkerhed og varenummer">
          {text.producer && <p>{text.producer}</p>}
          {product.safetyInfo && (
            <p>
              <a href={product.safetyInfo} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-4 hover:text-ink">
                Sikkerhedsinformation og advarsler (producentens mærkat)
              </a>
            </p>
          )}
          {product.sku && <p className="text-muted">Varenr. {product.sku}</p>}
        </Section>
      )}
    </div>
  );
}

function Section({ title, open = false, children }: { title: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="group" open={open}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[15px] font-bold text-ink [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown className="size-5 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="space-y-3 pb-5 text-[15px] leading-relaxed text-ink-soft">{children}</div>
    </details>
  );
}
