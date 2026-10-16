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
| `NEXT_PUBLIC_TRUSTPILOT_BUSINESS_UNIT_ID`, `NEXT_PUBLIC_TRUSTPILOT_PROFILE_URL` | (valgfri) webshoppens Trustpilot, i stedet for i `src/config/trustpilot.ts`. Se [Trustpilot](#trustpilot-trustboxe) nedenfor. |

4. **Deploy.**

`NEXT_PUBLIC_*` bygges ind i koden ved build. Redeploy derfor, når de ændres.

## 2. Installér pluginet på WordPress

Se [WOOCOMMERCE.md](WOOCOMMERCE.md#1-installér-pluginet-headless-checkout-bridge).

## 3. Stripe-webhook

Opret endpointet `https://<projekt>.vercel.app/api/stripe/webhook` som beskrevet i [STRIPE.md](STRIPE.md#webhook-påkrævet). Indsæt derefter signing secret'en i Vercel, og redeploy.

## 4. Før go-live

- **Firmaoplysninger:** I `src/config/company.ts` mangler kun åbningstiderne (`openingHours`) og beslutningen om uafhentede pakker (`unclaimedParcels`). Firmanavn, CVR, adresse, telefon, returadresse, returfragt (gratis returlabel), prismatch (30 dage) og svartid (24 timer) er udfyldt. Alt i [klammer] står fremhævet med gult på siderne, indtil det er udfyldt.
- **Juridiske tekster** (`src/content/info-pages.ts`) er udkast efter de almindelige danske regler. Få dem læst igennem af en jurist.
- **Kortbetaling:** beløbet reserveres ved køb og trækkes, når ordren markeres *Gennemført* (plugin 1.5, se nedenfor og [WOOCOMMERCE.md](WOOCOMMERCE.md#12-reservation-og-træk-ved-afsendelse)). **Upload plugin 1.5.0 først** (`npm run plugin:zip` → Plugins → Tilføj nyt → Upload plugin → Erstat nuværende med uploadet): med et ældre plugin trækker shoppen beløbet med det samme, selvom teksterne siger "reserveret". Tjek derefter, at `CRON_SECRET` er sat i begge projekter (gjort 16-10-2026), at begge Stripe-webhooks har `payment_intent.amount_capturable_updated` (tilføjet i testtilstand 16-10-2026; gør det samme i live-tilstand), og at en testordre markeret *Gennemført* får noten "Betalingen er trukket".
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
- **Trustpilot (valgfrit):** business unit ID, profilside og TrustBoxe pr. webshop, se [Trustpilot](#trustpilot-trustboxe).
- **Varer kun for voksne:** `python3 scripts/guirca/import_guirca.py adult --apply` flytter de 48 grove varer til kun Halloweenkostumer.dk (ejerens beslutning 16-10-2026). Den skriver kun feltet Webshops: varerne forbliver udgivne i deres egne kategorier, og de 37 i "Polterabend (18+)" sælges allerede kun dér. Kør først prøvekørslen uden `--apply` (den læser kun), og ikke mens webshopperne har travlt. Se [IMPORT-GUIRCA.md](IMPORT-GUIRCA.md#varer-kun-for-voksne-18).
- **Produkt-webhooks pr. webshop:** opret WooCommerce-webhooks for *Produkt oprettet / opdateret / slettet* for hver webshop: ét sæt med leverings-URL `https://fastelavnskostumer.dk/api/revalidate` og ét med `https://halloweenkostumer.dk/api/revalidate`, hver med samme secret som `WOOCOMMERCE_WEBHOOK_SECRET` i webshoppens Vercel-projekt. Gør det, når domænerne er forbundet (leveringer til beskyttede `*.vercel.app`-previews fejler). Se [WOOCOMMERCE.md](WOOCOMMERCE.md#4-valgfrit-øjeblikkelig-opdatering-af-produkter).

## Trustpilot (TrustBoxe)

Webshopperne kan vise Trustpilots egne TrustBoxe med webshoppens rigtige bedømmelse: under løfterækken på forsiden, under løfterne ved "Læg i kurv", i kurven og i kassens ordreoversigt og i footerens nederste linje (mørkt tema). Kun Trustpilots script og kode viser bedømmelsen; shoppen tegner aldrig Trustpilots logo, stjerner eller farver selv (Trustpilots varemærke, og en bedømmelse, kunden ikke kan finde hos Trustpilot, vildleder). Indtil TrustBoxene er sat op, viser produktsiden teksten "Bedømt som Fremragende – +30.000 femstjernede anmeldelser" som i dag, og der hentes intet fra Trustpilot.

**Det skal ejeren give for hver webshop (Fastelavnskostumer.dk og Halloweenkostumer.dk):**

1. **Business unit ID** (24 tegn): Trustpilot Business → **Integrations** → **TrustBox widgets** (i nogle konti **Share & promote → Website widgets**) → vælg en TrustBox → **Get code**. Koden har `data-businessunit-id="…"`. Hver webshop skal helst have sin egen profil på sit eget domæne (gør krav på profilen i Trustpilot Business, og bekræft domænet). Én fælles business unit kun, hvis begge domæner hører til samme profil hos Trustpilot; ellers viser den ene webshop en bedømmelse, kunden ikke finder under dens navn.
2. **Profilside**: `https://dk.trustpilot.com/review/<domæne>`, f.eks. `https://dk.trustpilot.com/review/halloweenkostumer.dk`. Den er linket i hver TrustBox (Trustpilot kræver det; uden JavaScript vises kun linket).
3. **Hvilke TrustBoxe, og hvilket abonnement**: template-ID'et er `data-template-id` i samme kode. På Trustpilots Free-plan virker kun **Review Collector** ("Bedøm os på Trustpilot"; den viser ingen bedømmelse, kopiér også `data-token`). **Micro Star**, **Micro TrustScore**, **Micro Combo** og de større TrustBoxe kræver et betalt abonnement. Shoppen starter med:

| Placering | TrustBox (`TRUSTBOX_TEMPLATES` i `src/config/trustpilot.ts`) | Tema |
| --- | --- | --- |
| Løfterækken over footeren, kun på forsiden (`strip`) | Micro Star | lyst |
| Under løfterne ved "Læg i kurv" (`product`); erstatter teksten "Bedømt som Fremragende" | Micro Star | lyst |
| Kurven og kassens ordreoversigt (`cart`) | Micro TrustScore (Micro Star mister Trustpilots logo under ca. 310 px, og kurven er kun 278 px bred på en 360 px telefon) | lyst |
| Footerens nederste linje ved betalingsmærkerne (`footer`), ikke på ordrebekræftelsen (`/ordre/…`): dens adresse har ordrens nøgle og efter MobilePay Stripes client secret, og Trustpilot får adressen på hver side med en TrustBox | Micro TrustScore | mørkt (footeren er mørk i begge webshops) |

**Sådan slås de til:** udfyld `businessUnitId` og `profileUrl` (og evt. `placements`) for webshoppen i `src/config/trustpilot.ts`, eller sæt `NEXT_PUBLIC_TRUSTPILOT_BUSINESS_UNIT_ID` og `NEXT_PUBLIC_TRUSTPILOT_PROFILE_URL` i webshoppens Vercel-projekt, og redeploy. Har ID'et eller adressen et forkert format, vises teksten i stedet. Et ID i rigtigt format, der er forkert, eller en TrustBox, abonnementet ikke omfatter (Free: kun Review Collector), kan shoppen ikke se: så viser Trustpilot kun sit logo, og produktsiden har mistet teksten "Bedømt som Fremragende". Tjek derfor alle placeringer i en Vercel-preview, før det går i produktion. En placering, der fjernes fra `placements`, viser ingen TrustBox. Andre `data-*` fra Trustpilots kode (f.eks. `data-token`, `data-stars`) skrives i `data` uden "data-".

**Før de slås til:**

- **Tallene skal passe sammen.** TrustBoxen viser Trustpilots tal. "+500.000 glade kunder" i løfterækken og "Bedømt som Fremragende – +30.000 femstjernede anmeldelser" i FAQ'en og "Om os"-listerne står der stadig: de skal kunne dokumenteres og må ikke modsige det, profilen viser. Trustpilots vilkår kræver, at bedømmelsen altid vises korrekt og ikke vildledende, og kun med Trustpilots egne widgets.
- **Cookies og samtykke.** TrustBoxene sætter ingen cookies og gemmer intet i browseren (tjekket i Trustpilots scripts 16-10-2026; Trustpilots eneste cookie, `TrustboxSplitTest_…`, kommer kun med deres A/B-test, `data-group`, som shoppen ikke bruger). Men browseren henter dem fra widget.trustpilot.com, når siden er indlæst, og Trustpilot får IP-adresse, sidens adresse, siden kunden kom fra, browser, sprog og styresystem, og tæller visninger og klik. Cookie- og privatlivspolitikken beskriver det automatisk, når TrustBoxene er slået til (`trustbox: true` i `src/content/info-pages.ts`). Om det kræver samtykke, skal juristen vurdere sammen med de øvrige tekster (EDPB's retningslinjer 2/2023 regner også sporing uden cookies med under ePrivacy-direktivets art. 5, stk. 3). Kræver det samtykke, må TrustBoxene først indlæses efter et ja; shoppen har ingen samtykkeløsning i dag.
- **Databehandleraftale.** Trustpilot behandler widgetdata (IP-adresse og metadata) for virksomheden efter Trustpilots databehandleraftale (DPA), som er en del af Trustpilots vilkår for virksomheder og accepteres med Trustpilot Business-kontoen.

## 5. Efter deploy

- Følg den manuelle testplan i [TEST.md](TEST.md#manuel-testplan-rigtig-stripe--testpiecedk).
- Preview-deployments bruger samme WooCommerce. De opretter rigtige (test)ordrer der.

## Drift

- HTTPS leveres af Vercel. WooCommerce-forbindelsen kræver HTTPS.
- Rate limiting er pr. serverinstans. Ved rigtig trafik bør du slå Vercel Firewall-rate limiting til på `/api/checkout*`.
- Logs (Vercel → Logs) indeholder kun fejlkoder og ordre-/event-ID'er. Der logges ingen nøgler eller kundedata.

## Flere webshops

Opret ét Vercel-projekt pr. webshop fra samme repo, med sit eget `NEXT_PUBLIC_STORE_ID`, `NEXT_PUBLIC_SITE_URL`, `STRIPE_WEBHOOK_SECRET` og `CRON_SECRET`. Hvert projekt kører det daglige job for sin egen webshop. WooCommerce-backenden og Stripe-kontoen deles. Se [MULTISHOP.md](MULTISHOP.md).
