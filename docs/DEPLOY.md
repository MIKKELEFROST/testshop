# GitHub og Vercel

Projektet er en standard Next.js-app, så Vercel registrerer den automatisk. Der kræves ingen `vercel.json`.

## 1. Importér repoet i Vercel

1. https://vercel.com/new → **Import Git Repository** → `MIKKELEFROST/testshop`
2. Framework preset: **Next.js** (automatisk). Build command og output skal ikke ændres.
3. Under **Environment Variables** tilføjer du (for *Production* og *Preview*):

| Navn | Værdi |
| --- | --- |
| `WOOCOMMERCE_URL` | `https://test.piece.dk` |
| `WOOCOMMERCE_CONSUMER_KEY` | `ck_…` |
| `WOOCOMMERCE_CONSUMER_SECRET` | `cs_…` |
| `STRIPE_SECRET_KEY` | `sk_test_…` (**test** indtil go-live) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_test_…` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` (trin 3) |
| `NEXT_PUBLIC_SITE_URL` | `https://<projekt>.vercel.app` |
| `NEXT_PUBLIC_STORE_ID` | `piece-dk` (webshoppens butiks-ID, se [MULTISHOP.md](MULTISHOP.md)) |
| `WOOCOMMERCE_WEBHOOK_SECRET` | (valgfri) tilfældig lang streng |

4. **Deploy.**

`NEXT_PUBLIC_*` bygges ind i koden ved build. Redeploy derfor, når de ændres.

## 2. Installér pluginet på WordPress

Se [WOOCOMMERCE.md](WOOCOMMERCE.md#1-installér-pluginet-headless-checkout-bridge).

## 3. Stripe-webhook

Opret endpointet `https://<projekt>.vercel.app/api/stripe/webhook` som beskrevet i [STRIPE.md](STRIPE.md#webhook-påkrævet). Indsæt derefter signing secret'en i Vercel, og redeploy.

## 4. Efter deploy

- Følg den manuelle testplan i [TEST.md](TEST.md#manuel-testplan-rigtig-stripe--testpiecedk).
- Preview-deployments bruger samme WooCommerce. De opretter rigtige (test)ordrer der.

## Drift

- HTTPS leveres af Vercel. WooCommerce-forbindelsen kræver HTTPS.
- Rate limiting er pr. serverinstans. Ved rigtig trafik bør du slå Vercel Firewall-rate limiting til på `/api/checkout*`.
- Logs (Vercel → Logs) indeholder kun fejlkoder og ordre-/event-ID'er. Der logges ingen nøgler eller kundedata.

## Flere webshops

Opret ét Vercel-projekt pr. webshop fra samme repo, med sit eget `NEXT_PUBLIC_STORE_ID`, `NEXT_PUBLIC_SITE_URL` og `STRIPE_WEBHOOK_SECRET`. WooCommerce-backenden og Stripe-kontoen deles. Se [MULTISHOP.md](MULTISHOP.md).
