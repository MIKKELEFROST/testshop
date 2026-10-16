# Headless WooCommerce-webshop med egen checkout

Proof of concept for en headless webshop:

- **WooCommerce** (`test.piece.dk`) står for produkter, varianter, priser, moms, fragt, lager, kunder og ordrer.
- **Next.js 16** (App Router, TypeScript strict, Tailwind CSS 4) står for hele kundeoplevelsen: forside, kategorier, produktsider, kurv, en specialbygget checkout på én side og ordrebekræftelse.
- **Stripe** (Payment Intents + Payment Element + webhooks) står for betalingen. Beløbet reserveres, når kunden bestiller, og trækkes, når ordren markeres *Gennemført* (sendt) i WooCommerce. Se [docs/STRIPE.md](docs/STRIPE.md#reservation-og-træk-ved-afsendelse).
- Et lille **WordPress-plugin** ([`wordpress-plugin/headless-checkout-bridge`](wordpress-plugin/headless-checkout-bridge)) giver sikre server-til-server-endpoints. Det bruger WooCommerces egen kurv, moms, fragt, ordreoprettelse og lagerreservation.

Der kører to webshops på samme WooCommerce: **Fastelavnskostumer.dk** (`piece-dk`) og **Halloweenkostumer.dk** (`halloween-kostumer-dk`). De sælger begge hele Guircas sortiment, men har hver sit DNA: logo, farver, skrift, menu, forside, temaer og den sæson, de viser først. Se [docs/MULTISHOP.md](docs/MULTISHOP.md).

## Hurtig start (lokalt)

```bash
npm install
cp .env.example .env.local     # udfyld værdierne, se nedenfor
npm run dev                    # http://localhost:3000
```

| Variabel | Hvad |
| --- | --- |
| `WOOCOMMERCE_URL` | F.eks. `https://test.piece.dk` |
| `WOOCOMMERCE_CONSUMER_KEY` / `_SECRET` | WooCommerce → Indstillinger → Avanceret → REST API. Nøglen skal have **Read/Write** og tilhøre en administrator eller butiksbestyrer. |
| `STRIPE_SECRET_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe Dashboard → Developers → API keys. Brug **kun `sk_test_`/`pk_test_`** uden for produktion. |
| `STRIPE_WEBHOOK_SECRET` | Webhookens signing secret (`whsec_…`). Se [docs/STRIPE.md](docs/STRIPE.md). |
| `CRON_SECRET` | Tilfældig streng på mindst 16 tegn. Vercel sender den til det daglige job, der trækker eller frigiver betalinger, WordPress ikke kunne melde (se [docs/DEPLOY.md](docs/DEPLOY.md)). |
| `NEXT_PUBLIC_SITE_URL` | Butikkens offentlige URL |
| `NEXT_PUBLIC_STORE_ID` | Webshoppens butiks-ID: vælger brand og de produkter, webshoppen sælger, og mærker ordrer og betalinger |
| `WOOCOMMERCE_WEBHOOK_SECRET` | Valgfri. Lader WooCommerce invalidere produktcachen med det samme. |

Secrets læses kun på serveren. De bliver aldrig sendt til browseren eller logget. `.env.local` er i `.gitignore`.

**Pluginet skal være installeret på WordPress**, ellers kan checkout ikke virke. Se [docs/WOOCOMMERCE.md](docs/WOOCOMMERCE.md).

## Dokumentation

- [docs/ARKITEKTUR.md](docs/ARKITEKTUR.md): opbygning, ordre-livscyklus og sikkerhed
- [docs/WOOCOMMERCE.md](docs/WOOCOMMERCE.md): forbindelse, plugin, påkrævede WooCommerce-indstillinger
- [docs/STRIPE.md](docs/STRIPE.md): nøgler, webhooks og testkort
- [docs/TEST.md](docs/TEST.md): automatiserede tests, manuel testplan og testresultater
- [docs/DEPLOY.md](docs/DEPLOY.md): GitHub og Vercel
- [docs/MULTISHOP.md](docs/MULTISHOP.md): flere webshops på samme WooCommerce
- [docs/IMPORT-GUIRCA.md](docs/IMPORT-GUIRCA.md): import af leverandørens produktark (Guirca)

## Scripts

| Kommando | |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` / `typecheck` | ESLint og TypeScript |
| `npm test` | Unit-tests (Vitest) |
| `npm run test:integration` | Ordre- og betalingsflow mod en rigtig WooCommerce i Docker (`./scripts/local-woocommerce/setup.sh` først) |
| `npm run plugin:zip` | Bygger `dist/headless-checkout-bridge.zip` til upload i WordPress |
| `python3 scripts/guirca/import_guirca.py` | Importerer Guircas produktark i WooCommerce (se docs/IMPORT-GUIRCA.md) |

## Projektstruktur

```
src/
  app/                       Sider og API-routes (App Router)
    api/checkout/            POST: opret ordre + PaymentIntent · quote/: priser, moms, fragt · session/
    api/stripe/webhook/      Stripe → WooCommerce betalingsstatus
    api/payments/settle/     WordPress → shoppen: ordren er sendt (træk betalingen) eller annulleret (frigiv den)
    api/cron/settle-payments/ Dagligt sikkerhedsnet (Vercel Cron) for det samme
    api/revalidate/          WooCommerce-produktwebhooks → cache-invalidering
    produkter/ kategori/ kurv/ checkout/ ordre/bekraeftelse/
  components/                UI: layout, products, cart, checkout, ui
  config/store.ts            Brand/butik-konfiguration (multishop)
  lib/
    woocommerce/             Server-only REST-klient, Zod-skemaer, produkter, plugin-API
    checkout/                Ordre-/betalingsorkestrering, webhook-logik, session, quote
    stripe/                  Stripe server-gateway + Stripe.js-loader
    cart/                    Ren kurv-logik + localStorage-store
    validation/              Zod-skemaer (deles af browser og server)
    security/                Rate limiting, same-origin-tjek
wordpress-plugin/            Headless Checkout Bridge (PHP)
scripts/local-woocommerce/   Lokal WordPress+WooCommerce i Docker til udvikling og tests
tests/                       Integrationstests og test-hjælpere
```
