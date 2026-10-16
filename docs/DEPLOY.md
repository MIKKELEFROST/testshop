# GitHub og Vercel

Projektet er en standard Next.js-app, så Vercel registrerer den automatisk. `vercel.json` sætter funktionernes region og det daglige job, der trækker og frigiver betalinger (se nedenfor).

### Region: Stockholm (`arn1`)

Serverfunktionerne (sider, der bygges om, `/api/*`) kører i `arn1` (Stockholm), tæt på WordPress. `test.piece.dk` er `93.191.156.40` (`linux186.unoeuro.com`), hos Simply.com (team.blue Denmark, AS48854) i Danmark (DNS-opslag 16-10-2026). Uden `vercel.json` kører funktionerne i Vercels standardregion, Washington (`iad1`): så krydser hver WooCommerce-forespørgsel Atlanten (ca. 100 ms frem og tilbage), og en side med flere læsninger venter på hver af dem. Stockholm og Frankfurt (`fra1`) er de nærmeste Vercel-regioner, begge ca. 600-700 km fra Danmark; Stockholm er valgt. Begge Vercel-projekter bruger samme `vercel.json`. Flyttes WordPress, så ret regionen. Hobby-planen tillader én region, og det er nok her.

### Træk ved afsendelse: `CRON_SECRET` og callbacks

Beløbet reserveres, når kunden betaler, og trækkes, når ordren markeres *Gennemført* i WooCommerce ([STRIPE.md](STRIPE.md#reservation-og-træk-ved-afsendelse)). To veje fører dertil:

1. **Callback (med det samme):** pluginet kalder `POST /api/payments/settle` på den webshop, der oprettede ordren. I produktionen er adressen webshoppens egen `NEXT_PUBLIC_SITE_URL` (når den er https). Fra en preview er den projektets produktionsadresse (`VERCEL_PROJECT_PRODUCTION_URL`: det korteste eget domæne, ellers `<projekt>.vercel.app`): previews er bag Vercels beskyttelse (Deployment Protection), så WordPress kan ikke nå dem; produktionen har samme butiks-ID, samme WooCommerce og, indtil go-live, samme Stripe-testnøgle og trækker derfor også previewens ordrer (efter go-live ikke, se [Før go-live](#4-før-go-live)). Brug **Standard Protection** (eller ingen), ikke **All Deployments**: produktionsdomænet skal kunne nås af WordPress. Uden for Vercel bruges `NEXT_PUBLIC_SITE_URL`. Adressen, WordPress kalder, skal svare direkte uden at omdirigere: sæt `NEXT_PUBLIC_SITE_URL` til det primære domæne (fx `https://www.fastelavnskostumer.dk`, hvis apex-domænet omdirigerer dertil). WordPress følger højst to omdirigeringer med 301/307/308; en 302 bliver til en GET, som shoppen afviser.
2. **Dagligt job (sikkerhedsnet):** `vercel.json` har en Vercel Cron Job, `GET /api/cron/settle-payments`, en gang i døgnet mellem 5.00 og 6.00 UTC (kl. 6-7 dansk vintertid, 7-8 sommertid). Hobby-planen tillader kun jobs én gang i døgnet, og Vercel kan køre det når som helst inden for timen (`17 5 * * *`). Jobbet beder pluginet om webshoppens ordrer, der er *Gennemført* uden at være trukket eller annulleret uden at være frigivet, og ordner dem, tre ad gangen i højst 45 sekunder (resten næste dag); pluginet advarer samtidig om reservationer ældre end 5 dage og om sendte ordrer, der et døgn efter ikke er trukket (note og mail). Svarer WordPress 508 eller 429, spørger jobbet én gang til efter 2 sekunder. Vercel kalder kun produktionen og sender `Authorization: Bearer $CRON_SECRET`. Uden `CRON_SECRET` svarer ruten 503 og gør intet.

Sæt `CRON_SECRET` i **begge** Vercel-projekter (Production), og redeploy. Vercel viser jobbet under **Settings → Cron Jobs**, hvor det også kan køres med det samme (**Run**). Fra en terminal:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<webshop>/api/cron/settle-payments
# {"listed":1,"captured":1,"released":0,…,"warned":0}
```

En preview med denne kode, før den er i produktion, kan kun ordne sine egne testordrer manuelt: kald previewens `/api/cron/settle-payments` med `CRON_SECRET` og Vercels bypass-header for automatisering (`x-vercel-protection-bypass`), eller træk/annullér PaymentIntent i Stripe Dashboard (test).

Ordrens token er lavet med `STRIPE_SECRET_KEY`. Ruller du nøglen (eller skifter til live), kan ældre ordrers callback ikke godkendes (HTTP 401, noteret på ordren); det daglige job trækker dem næste morgen.

Rækkefølge ved opdatering: upload plugin 1.5.0 først, deploy derefter shoppen. Møder shoppen et ældre plugin, trækker den beløbet med det samme som før, så ingen betaling bliver hængende.

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
| `CRON_SECRET` | Tilfældig streng på mindst 16 tegn (fx `openssl rand -hex 32`), sin egen i hvert projekt. Uden den kører det daglige job ikke (se nedenfor). |
| `NEXT_PUBLIC_SITE_URL` | `https://<projekt>.vercel.app`. Uden den bruger sitemap, kanoniske adresser og strukturerede data brandets domæne (`siteUrl` i `src/config/store.ts`), aldrig `localhost`. |
| `NEXT_PUBLIC_STORE_ID` | `piece-dk` (webshoppens butiks-ID, se [MULTISHOP.md](MULTISHOP.md)) |
| `WOOCOMMERCE_WEBHOOK_SECRET` | (valgfri) tilfældig lang streng |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | (valgfri) kundeservice-e-mail. Uden den bruges brandets, f.eks. `hej@halloweenkostumer.dk` (`src/config/store.ts`). Den står i footer, på informationssiderne og som "Svar til" i ordremails. |

4. **Deploy.**

`NEXT_PUBLIC_*` bygges ind i koden ved build. Redeploy derfor, når de ændres.

## 2. Installér pluginet på WordPress

Se [WOOCOMMERCE.md](WOOCOMMERCE.md#1-installér-pluginet-headless-checkout-bridge).

## 3. Stripe-webhook

Opret endpointet `https://<projekt>.vercel.app/api/stripe/webhook` som beskrevet i [STRIPE.md](STRIPE.md#webhook-påkrævet). Indsæt derefter signing secret'en i Vercel, og redeploy.

## 4. Før go-live

- **Firmaoplysninger:** Udfyld `src/config/company.ts` (firmanavn, CVR, adresse, telefon, åbningstider, returadresse) og de fire beslutninger til handelsbetingelserne. Alt i [klammer] står fremhævet med gult på siderne, indtil det er udfyldt.
- **Juridiske tekster** (`src/content/info-pages.ts`) er udkast efter de almindelige danske regler. Få dem læst igennem af en jurist.
- **Kortbetaling:** beløbet reserveres ved køb og trækkes, når ordren markeres *Gennemført* (plugin 1.5, se nedenfor og [WOOCOMMERCE.md](WOOCOMMERCE.md#12-reservation-og-træk-ved-afsendelse)). Tjek før go-live, at `CRON_SECRET` er sat i begge projekter, at begge Stripe-webhooks har `payment_intent.amount_capturable_updated`, og at en testordre markeret *Gennemført* får noten "Betalingen er trukket".
- **Stripe live-nøgler** og et live-webhook i stedet for test. Før skiftet: markér alle testordrer med reserveret betaling *Gennemført* eller *Annulleret*. Efter skiftet kan produktionen ikke trække eller frigive testordrer fra previews (live-nøglen kender ikke test-betalingerne; det daglige job springer dem over): annullér dem i WooCommerce, og lad dem udløbe i Stripe (test).
- **Domæner** (fastelavnskostumer.dk, halloweenkostumer.dk): tilføj dem i Vercel-projekterne, sæt `NEXT_PUBLIC_SITE_URL` til dem, og registrér dem i Stripe under **Payment method domains** (Apple Pay/Google Pay) og som webhook-endpoints. Kobl begge på samtidig: produktsiderne peger allerede på hinandens domæner (`siteUrl` i `src/config/store.ts`, se [MULTISHOP.md](MULTISHOP.md)). Får en webshop et andet domæne, så ret også `siteUrl`.
- **Kundeservice-e-mails, for hvert domæne:** brandenes adresser i `src/config/store.ts` (`hej@fastelavnskostumer.dk`, `hej@halloweenkostumer.dk`) er "Svar til" i ordremails og den eneste kanal til fortrydelse og reklamation på informationssiderne. De skal kunne modtage mail, før webshoppen går live:
  - Opret postkassen hos mailudbyderen (Simply), og sæt **MX** for domænet (`10 mx.simply.com`).
  - Sæt **SPF** (`v=spf1 include:spf.simply.com -all`, plus de tjenester, der ellers sender fra domænet) og slå **DKIM** til hos udbyderen.
  - Send en testmail til adressen fra en anden udbyder (f.eks. Gmail), og svar på den.
  - Tjekket 15. oktober 2026: `fastelavnskostumer.dk` har MX og SPF. **`halloweenkostumer.dk` har hverken MX eller SPF**, så mails til `hej@halloweenkostumer.dk` kan ikke leveres endnu.
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

Opret ét Vercel-projekt pr. webshop fra samme repo, med sit eget `NEXT_PUBLIC_STORE_ID`, `NEXT_PUBLIC_SITE_URL`, `STRIPE_WEBHOOK_SECRET` og `CRON_SECRET`. Hvert projekt kører det daglige job for sin egen webshop. WooCommerce-backenden og Stripe-kontoen deles. Se [MULTISHOP.md](MULTISHOP.md).
