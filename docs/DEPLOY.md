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
| `NEXT_PUBLIC_SUPPORT_EMAIL` | (valgfri) kundeservice-e-mail. Uden den bruges brandets, f.eks. `kundeservice@halloweenkostumer.dk` (`src/config/store.ts`). Den står i footer, på informationssiderne og som "Svar til" i ordremails. |

4. **Deploy.**

`NEXT_PUBLIC_*` bygges ind i koden ved build. Redeploy derfor, når de ændres.

## 2. Installér pluginet på WordPress

Se [WOOCOMMERCE.md](WOOCOMMERCE.md#1-installér-pluginet-headless-checkout-bridge).

## 3. Stripe-webhook

Opret endpointet `https://<projekt>.vercel.app/api/stripe/webhook` som beskrevet i [STRIPE.md](STRIPE.md#webhook-påkrævet). Indsæt derefter signing secret'en i Vercel, og redeploy.

## 4. Før go-live

- **Firmaoplysninger:** Udfyld `src/config/company.ts` (firmanavn, CVR, adresse, telefon, åbningstider, returadresse) og de fire beslutninger til handelsbetingelserne. Alt i [klammer] står fremhævet med gult på siderne, indtil det er udfyldt.
- **Juridiske tekster** (`src/content/info-pages.ts`) er udkast efter de almindelige danske regler. Få dem læst igennem af en jurist.
- **Kortbetaling:** I dag trækkes betalingen, når ordren lægges. Efter danske regler må et betalingskort som udgangspunkt først debiteres, når varen sendes. Overvej at reservere ved køb og trække beløbet ved afsendelse (Stripe "manual capture").
- **Stripe live-nøgler** og et live-webhook i stedet for test.
- **Domæner** (fastelavnskostumer.dk, halloweenkostumer.dk): tilføj dem i Vercel-projekterne, sæt `NEXT_PUBLIC_SITE_URL` til dem, og registrér dem i Stripe under **Payment method domains** (Apple Pay/Google Pay) og som webhook-endpoints.
- **Kundeservice-e-mails:** sørg for, at brandenes adresser findes, eller sæt `NEXT_PUBLIC_SUPPORT_EMAIL`.

## 5. Efter deploy

- Følg den manuelle testplan i [TEST.md](TEST.md#manuel-testplan-rigtig-stripe--testpiecedk).
- Preview-deployments bruger samme WooCommerce. De opretter rigtige (test)ordrer der.

## Drift

- HTTPS leveres af Vercel. WooCommerce-forbindelsen kræver HTTPS.
- Rate limiting er pr. serverinstans. Ved rigtig trafik bør du slå Vercel Firewall-rate limiting til på `/api/checkout*`.
- Logs (Vercel → Logs) indeholder kun fejlkoder og ordre-/event-ID'er. Der logges ingen nøgler eller kundedata.

## Flere webshops

Opret ét Vercel-projekt pr. webshop fra samme repo, med sit eget `NEXT_PUBLIC_STORE_ID`, `NEXT_PUBLIC_SITE_URL` og `STRIPE_WEBHOOK_SECRET`. WooCommerce-backenden og Stripe-kontoen deles. Se [MULTISHOP.md](MULTISHOP.md).
