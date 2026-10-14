# Arkitektur

```
 Browser ──► Next.js (Vercel) ──────────────► WooCommerce (WordPress)
   │           │  Server Components             • REST API v3: produkter, kategorier
   │           │  /api/checkout/quote ─────────► • wc-headless/v1 (pluginet):
   │           │  /api/checkout ───────────────►     quote, ordrer, betalingsstatus
   │           │  /api/stripe/webhook ─────────►
   │           ▼
   └──► Stripe.js (Payment Element) ◄──► Stripe ──webhook──► /api/stripe/webhook
```

## Ansvarsfordeling

| | Autoritativ kilde |
| --- | --- |
| Produkter, varianter, priser, tilbud, lager, moms, fragt, ordrer, ordrestatus | **WooCommerce** |
| Betaling, betalingsoplysninger (kort-data), betalingsstatus | **Stripe** |
| Præsentation, kurv (kun *hvad* kunden vil have), checkout-UX | **Next.js** |

Browseren bestemmer aldrig en pris. Kurven i `localStorage` indeholder kun produkt-ID, variant-ID og antal, plus den pris kunden så, til visning. Alle beløb beregnes af WooCommerce.

## Hvorfor et lille WordPress-plugin?

WooCommerce REST API v3 alene kan ikke levere et sikkert flow:

1. **Moms og fragt for en kurv uden at oprette en ordre.** Fragtmetoder som "gratis fragt over X kr." er bundet til WooCommerces *kurv*. Pluginet bygger en rigtig WooCommerce-kurv i en isoleret, ikke-gemt session og returnerer WooCommerces egne totaler.
2. **Lagerreservation ved samtidige køb.** REST-oprettede ordrer reserverer ikke lager, så to kunder kan købe den sidste vare. Pluginet opretter ordren via `WC_Checkout::create_order()`, som udløser WooCommerces egen `ReserveStock` (atomisk SQL med `FOR UPDATE`).
3. **Idempotens og samtidighed.** Én ordre pr. checkout-session og én PaymentIntent pr. ordre. Det sikres med databaselåse (`GET_LOCK`) og compare-and-set.

Pluginet implementerer **ikke** sin egen lager- eller momslogik. Lagertræk sker kun i WooCommerce core (`payment_complete()` / statusskift), som selv beskytter mod dobbelt træk.

## Ordre-livscyklus

```
 Kunde trykker "Betal"
   │
   ▼
 POST /api/checkout                         (same-origin, rate limit, Zod)
   │  sender kurv + adresse + fragtmetode + "den total kunden så"
   ▼
 Plugin: POST /orders  (lås pr. checkout-session)
   • bygger WooCommerce-kurv → priser, lager, moms, fragt beregnes af WooCommerce
   • total ≠ den kunden så? → 409 total_changed + ny quote (kunden skal bekræfte)
   • udsolgt? → 409/422 (ingen ordre)
   • opretter/genoptager ÉN ordre "pending" pr. session + reserverer lager (60 min*)
   ▼
 Next.js: sikrer ÉN PaymentIntent pr. ordre for præcis ordretotalen
   • idempotency key = ordre + nøgle + beløb  → ingen dubletter ved retries
   • eksisterende PaymentIntent genbruges / beløb opdateres
   • tilknyttes ordren med compare-and-set (parallelle klik giver samme betaling)
   ▼
 Browser: stripe.confirmPayment() (kortdata går direkte til Stripe, 3-D Secure)
   ▼
 Stripe webhook  ──►  /api/stripe/webhook (signatur verificeres på rå body)
 Retur-URL       ──►  /ordre/bekraeftelse (hurtig vej, samme kode)
   • PaymentIntent hentes FRISK fra Stripe (event-data og URL stoles ikke på)
   • Plugin: POST /orders/{id}/payment (lås pr. ordre, ordrenøgle kræves)
       succeeded → beløb + valuta tjekkes mod ordren → payment_complete()
                   → WooCommerce trækker lager én gang, frigiver reservation, sender mails
       processing → "on-hold" (lager trækkes, async betalingsmetoder)
       failed     → note på ordren, ordren forbliver betalbar (kunden kan prøve igen)
       canceled   → "cancelled" → reservation frigives / lager gendannes
   ▼
 Bekræftelsesside: ordrenummer, status, varer, levering. Kurven tømmes, ny session.
```

\* Bruger WooCommerces indstilling "Hold lager (minutter)". Er den tom, reserverer pluginet i 15 minutter. Ubetalte ordrer annulleres automatisk af WooCommerce efter samme periode.

## Garantier og hvordan de opnås

| Krav | Mekanisme |
| --- | --- |
| Ingen dobbeltordrer | Checkout-session-ID (httpOnly-cookie) → én ordre pr. session. Lås + fingerprint giver idempotent replay. |
| Ingen dobbeltbetalinger | Én PaymentIntent pr. ordre (Stripe idempotency key + compare-and-set i WooCommerce). Klientside dobbeltklik-spærre. En betaling, der alligevel ankommer til en allerede betalt eller erstattet ordre, **refunderes automatisk**. |
| Intet dobbelt lagertræk | Kun WooCommerce core trækker lager (`_order_stock_reduced`). Betalingshændelser behandles under ordrelås, og ordren genindlæses fra databasen efter låsen. |
| Idempotente webhooks | PaymentIntent hentes frisk. Statusmaskinen i pluginet gør gentagelser til no-ops. Rækkefølgen af events er ligegyldig. |
| Samtidige køb af sidste vare | WooCommerce `ReserveStock` (atomisk). Testet med 4 parallelle købere: præcis én får varen. |
| Pris ændret under checkout | Serveren sammenligner WooCommerces nye total med den, kunden så. Ved forskel → ny quote, og kunden skal trykke Betal igen. |
| Manipulation af priser | Klienten sender ingen priser. Zod fjerner ukendte felter. Beløbet til Stripe = WooCommerce-ordrens total. Webhook tjekker beløb og valuta. |
| Afbrudt betaling | Ordren forbliver "pending" med reservation. WooCommerce annullerer den automatisk efter hold-perioden. Kommer pengene alligevel bagefter, genåbnes ordren, hvis lageret er der, ellers refunderes. |
| WooCommerce nede | Katalog: venlig fejlbesked, cache kun 30 sek. Checkout: ingen betaling oprettes (503). Webhook: 500, så Stripe prøver igen i op til 3 dage. |

## Sikkerhed

- API-nøgler og Stripe secret key bruges kun i server-kode (`import "server-only"`). Fejlbeskeder og logs indeholder aldrig nøgler, request-bodies eller kundedata.
- Plugin-endpoints kræver WooCommerce-API-nøgle (read/write) for en bruger med `manage_woocommerce`. Ordre-endpoints kræver desuden ordrenøglen.
- API-routes: same-origin-tjek (CSRF), kun `application/json`, maks. body-størrelse, Zod-validering og rate limiting pr. IP (in-memory pr. instans; brug Vercel Firewall eller Upstash ved rigtig trafik).
- Stripe-webhooks verificeres med `constructEvent` på den rå body.
- Sikkerhedsheaders: HSTS, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`. En Content-Security-Policy med nonces er ikke slået til i prototypen.
- Produktbeskrivelser fra WordPress vises som ren tekst. Der injiceres ingen HTML.

## Caching

- Katalogdata hentes med `'use cache'` + `cacheLife('minutes')` + tags. WooCommerce-produktwebhooks (`/api/revalidate`) og betalte ordrer invaliderer cachen.
- Lager og priser på produktsider er informative. Kurv og checkout henter altid friske tal fra WooCommerce.

## Klar til flere webshops

- `src/config/store.ts` + `NEXT_PUBLIC_STORE_*`: navn, butiks-ID, lande, betalingsmetodens titel. Designtokens findes i `globals.css` (`@theme`).
- Hver ordre får `_wchc_store_id`, og hver PaymentIntent får `metadata.store_id`. Webhooks for andre butikkers betalinger ignoreres, så flere butikker kan dele én Stripe-konto og én WooCommerce.
- Data- og checkoutlaget (`lib/woocommerce`, `lib/checkout`) er uafhængigt af UI'et og kan genbruges af andre frontends.
- Ikke implementeret endnu: produktfordeling pr. butik (f.eks. via kategori eller tag i `getProducts`) og separate Vercel-projekter pr. domæne.
