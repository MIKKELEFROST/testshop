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
- **Kundeservice-e-mails, for hvert domæne:** brandenes adresser i `src/config/store.ts` (`kundeservice@fastelavnskostumer.dk`, `kundeservice@halloweenkostumer.dk`) er "Svar til" i ordremails og den eneste kanal til fortrydelse og reklamation på informationssiderne. De skal kunne modtage mail, før webshoppen går live:
  - Opret postkassen hos mailudbyderen (Simply), og sæt **MX** for domænet (`10 mx.simply.com`).
  - Sæt **SPF** (`v=spf1 include:spf.simply.com -all`, plus de tjenester, der ellers sender fra domænet) og slå **DKIM** til hos udbyderen.
  - Send en testmail til adressen fra en anden udbyder (f.eks. Gmail), og svar på den.
  - Tjekket 15. oktober 2026: `fastelavnskostumer.dk` har MX og SPF. **`halloweenkostumer.dk` har hverken MX eller SPF**, så mails til `kundeservice@halloweenkostumer.dk` kan ikke leveres endnu.
  - Lad `NEXT_PUBLIC_SUPPORT_EMAIL` være tom i begge Vercel-projekter, så brandets adresse bruges (eller sæt den til webshoppens egen adresse, aldrig en fælles).
- **Afsender på ordremails:** **WooCommerce → Indstillinger → E-mails → Fra-adresse** er i dag en personlig postkasse og er afsender på alle mails fra begge webshops. Skift den til en neutral butiksadresse på et domæne med SPF og DKIM (f.eks. `ordre@fastelavnskostumer.dk`), og send mails fra WordPress gennem udbyderens SMTP-server. Se [WOOCOMMERCE.md](WOOCOMMERCE.md#11-ordremails-i-webshoppens-navn).
- **Stripe live, offentlige oplysninger:** i live-tilstand under **Settings → Business → Public details**: det offentlige firmanavn, support-e-mail og en kort, neutral **Shortened descriptor**, der passer til begge webshops. Hver webshop sender sit eget suffiks til kortudtoget (statement descriptor suffix), så kunden kan genkende betalingen. MobilePay viser kontoens firmanavn. Se [STRIPE.md](STRIPE.md).
- **Betalingsmetoder:** handelsbetingelserne ("Betaling") og FAQ'en ("Hvordan kan jeg betale?") i `src/content/info-pages.ts` nævner Visa, Mastercard, MobilePay, Apple Pay og Google Pay. Slå præcis dem til i Stripe live (**Settings → Payment methods**), eller ret listerne, så de passer til det, der er slået til (f.eks. PayPal, Klarna eller Revolut Pay).
- **Produkt-webhooks pr. webshop:** opret WooCommerce-webhooks for *Produkt oprettet / opdateret / slettet* for hver webshop: ét sæt med leverings-URL `https://fastelavnskostumer.dk/api/revalidate` og ét med `https://halloweenkostumer.dk/api/revalidate`, hver med samme secret som `WOOCOMMERCE_WEBHOOK_SECRET` i webshoppens Vercel-projekt. Gør det, når domænerne er forbundet (leveringer til beskyttede `*.vercel.app`-previews fejler). Se [WOOCOMMERCE.md](WOOCOMMERCE.md#4-valgfrit-øjeblikkelig-opdatering-af-produkter).

## 5. Efter deploy

- Følg den manuelle testplan i [TEST.md](TEST.md#manuel-testplan-rigtig-stripe--testpiecedk).
- Preview-deployments bruger samme WooCommerce. De opretter rigtige (test)ordrer der.

## Drift

- HTTPS leveres af Vercel. WooCommerce-forbindelsen kræver HTTPS.
- Rate limiting er pr. serverinstans. Ved rigtig trafik bør du slå Vercel Firewall-rate limiting til på `/api/checkout*`.
- Logs (Vercel → Logs) indeholder kun fejlkoder og ordre-/event-ID'er. Der logges ingen nøgler eller kundedata.

## Flere webshops

Opret ét Vercel-projekt pr. webshop fra samme repo, med sit eget `NEXT_PUBLIC_STORE_ID`, `NEXT_PUBLIC_SITE_URL` og `STRIPE_WEBHOOK_SECRET`. WooCommerce-backenden og Stripe-kontoen deles. Se [MULTISHOP.md](MULTISHOP.md).
