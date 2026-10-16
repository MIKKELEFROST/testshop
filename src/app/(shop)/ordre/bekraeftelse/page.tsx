import type { Metadata } from "next";
import { Suspense } from "react";
import { ConfirmationEffects } from "@/components/checkout/confirmation-effects";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { storeConfig } from "@/config/store";
import { checkoutDeps } from "@/lib/checkout/deps";
import { finalizePayment } from "@/lib/checkout/service";
import { describeError } from "@/lib/log";
import { formatPrice } from "@/lib/money";
import { stripeGateway } from "@/lib/stripe/server";
import { getOrderDetails } from "@/lib/woocommerce/checkout-api";
import type { WcOrderDetails } from "@/lib/woocommerce/schemas";

export const metadata: Metadata = { title: "Ordrebekræftelse", robots: { index: false, follow: false } };

export default function ConfirmationPage(props: PageProps<"/ordre/bekraeftelse">) {
  return (
    <div className="container-shop max-w-3xl pt-10">
      <Suspense
        fallback={
          <div className="flex items-center gap-3 py-24 text-muted">
            <Spinner /> Henter din ordre…
          </div>
        }
      >
        <Confirmation searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

async function Confirmation({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const orderId = Number(single(params.order));
  const orderKey = single(params.key);
  const paymentIntentId = single(params.payment_intent);

  if (!Number.isSafeInteger(orderId) || orderId <= 0 || !orderKey || !/^wc_order_[A-Za-z0-9]+$/.test(orderKey)) {
    return <NotFound />;
  }

  let order: WcOrderDetails | null;
  try {
    order = await getOrderDetails(orderId, orderKey);
    // Fast path: don't wait for the webhook. The PaymentIntent is read from Stripe — the
    // query string only tells us which one to look at — and finalising is idempotent.
    if (order?.needs_payment && paymentIntentId && paymentIntentId === order.payment_intent_id) {
      const paymentIntent = await stripeGateway.retrieve(paymentIntentId);
      await finalizePayment(paymentIntent, checkoutDeps());
      order = await getOrderDetails(orderId, orderKey);
    }
  } catch (error) {
    console.error("[confirmation] failed:", describeError(error));
    return (
      <Alert tone="warning" title="Vi kan ikke vise din ordre lige nu">
        Din betaling er registreret hos Stripe, hvis du har gennemført den. Genindlæs siden om lidt, eller kontakt{" "}
        {storeConfig.supportEmail}.
      </Alert>
    );
  }

  if (!order) return <NotFound />;

  const paid = order.status === "processing" || order.status === "completed";
  // Capture at shipment: the amount is reserved now and charged when the order is sent.
  const reserved = order.status === "on-hold" && order.capture?.status === "authorized";
  const processing = order.status === "on-hold" && !reserved;
  const failedRedirect = single(params.redirect_status) === "failed";

  return (
    <div>
      <ConfirmationEffects completed={paid || reserved || processing} pending={order.status === "pending" && !failedRedirect} />

      {paid && (
        <Header icon="success" eyebrow={`Ordre #${order.number}`} title="Tak for din ordre!">
          Vi har modtaget din betaling. En bekræftelse er sendt til <strong>{order.email}</strong>.
        </Header>
      )}
      {reserved && (
        <Header icon="success" eyebrow={`Ordre #${order.number}`} title="Tak for din ordre!">
          Vi har reserveret {formatPrice(order.total, order.currency)} på dit betalingsmiddel. Beløbet trækkes først, når vi sender din ordre.
          En bekræftelse er sendt til <strong>{order.email}</strong>.
        </Header>
      )}
      {processing && (
        <Header icon="pending" eyebrow={`Ordre #${order.number}`} title="Din betaling behandles">
          Ordren er modtaget, og vi afventer den endelige bekræftelse fra betalingsudbyderen. Du får en e-mail, så snart betalingen er gennemført.
        </Header>
      )}
      {order.status === "pending" && !failedRedirect && (
        <Header icon="pending" eyebrow={`Ordre #${order.number}`} title="Vi venter på betalingsbekræftelsen">
          Det tager normalt kun et øjeblik. Siden opdateres automatisk.
        </Header>
      )}
      {(order.status === "failed" || (order.status === "pending" && failedRedirect)) && (
        <Header icon="error" eyebrow={`Ordre #${order.number}`} title="Betalingen blev ikke gennemført">
          Der er ikke trukket penge. Du kan prøve igen med det samme.
          <div className="mt-5">
            <ButtonLink href="/checkout">Tilbage til kassen</ButtonLink>
          </div>
        </Header>
      )}
      {(order.status === "cancelled" || order.status === "refunded") && (
        <Header icon="error" eyebrow={`Ordre #${order.number}`} title={order.status === "refunded" ? "Ordren er refunderet" : "Ordren er annulleret"}>
          Kontakt {storeConfig.supportEmail}, hvis du har spørgsmål.
        </Header>
      )}

      <section className="mt-10 rounded-[var(--radius-card)] border border-line bg-surface p-6" aria-labelledby="ordre-detaljer">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="ordre-detaljer" className="text-lg font-semibold">
            Ordre #{order.number}
          </h2>
          <p className="text-sm text-muted">Status: {reserved ? "Modtaget – beløbet er reserveret" : statusLabel(order.status)}</p>
        </div>
        <ul className="mt-5 divide-y divide-line border-y border-line">
          {order.items.map((item, i) => (
            <li key={i} className="flex justify-between gap-4 py-3 text-[15px]">
              <span>
                {item.name} <span className="text-muted">× {item.quantity}</span>
              </span>
              <span className="tabular-nums">{formatPrice(item.total, order.currency)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-soft">Subtotal</dt>
            <dd className="tabular-nums">{formatPrice(order.subtotal, order.currency)}</dd>
          </div>
          {Number(order.discount_total) > 0 && (
            <div className="flex justify-between">
              <dt className="text-ink-soft">Rabat</dt>
              <dd className="tabular-nums">−{formatPrice(order.discount_total, order.currency)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-ink-soft">Fragt {order.shipping_method ? `(${order.shipping_method})` : ""}</dt>
            <dd className="tabular-nums">{formatPrice(order.shipping_total, order.currency)}</dd>
          </div>
          <div className="flex justify-between border-t border-line pt-3 text-base font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatPrice(order.total, order.currency)}</dd>
          </div>
          <p className="text-right text-xs text-muted">Heraf moms {formatPrice(order.total_tax, order.currency)}</p>
          {reserved && <p className="text-right text-xs text-muted">Reserveret nu – trækkes, når vi sender varerne</p>}
        </dl>
      </section>

      <section className="mt-6 grid gap-6 rounded-[var(--radius-card)] border border-line bg-surface p-6 sm:grid-cols-2">
        <div>
          <h3 className="text-sm font-medium">Leveringsadresse</h3>
          <address className="mt-2 text-sm not-italic leading-relaxed text-ink-soft">
            {order.shipping_address.first_name} {order.shipping_address.last_name}
            <br />
            {order.shipping_address.address_1}
            {order.shipping_address.address_2 && (
              <>
                <br />
                {order.shipping_address.address_2}
              </>
            )}
            <br />
            {order.shipping_address.postcode} {order.shipping_address.city}
          </address>
        </div>
        <div>
          <h3 className="text-sm font-medium">Kontakt</h3>
          <p className="mt-2 text-sm text-ink-soft">{order.email}</p>
        </div>
      </section>

      <div className="mt-10">
        <ButtonLink href="/produkter" variant="secondary">
          Fortsæt med at handle
        </ButtonLink>
      </div>
    </div>
  );
}

function Header({
  icon,
  eyebrow,
  title,
  children,
}: {
  icon: "success" | "pending" | "error";
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  const colors = { success: "bg-success", pending: "bg-warning", error: "bg-danger" }[icon];
  return (
    <div className="flex gap-4">
      <span className={`mt-1 flex size-10 shrink-0 items-center justify-center rounded-full text-white ${colors}`} aria-hidden="true">
        {icon === "success" ? "✓" : icon === "pending" ? <Spinner /> : "!"}
      </span>
      <div>
        <p className="text-sm text-muted">{eyebrow}</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        <div className="mt-2 text-ink-soft">{children}</div>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <Alert tone="warning" title="Ordren blev ikke fundet">
      Linket er ugyldigt eller udløbet.
    </Alert>
  );
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function statusLabel(status: string): string {
  return (
    {
      pending: "Afventer betaling",
      processing: "Betalt – behandles",
      "on-hold": "Betaling behandles",
      completed: "Afsendt",
      cancelled: "Annulleret",
      refunded: "Refunderet",
      failed: "Betaling mislykkedes",
    }[status] ?? status
  );
}
