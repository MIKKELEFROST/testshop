# WooCommerce-forbindelsen

## 1. Installér pluginet "Headless Checkout Bridge"

1. Byg zip-filen med `npm run plugin:zip` (giver `dist/headless-checkout-bridge.zip`), eller zip mappen `wordpress-plugin/headless-checkout-bridge`.
2. I WordPress: **Plugins → Tilføj nyt → Upload plugin** → vælg zip → **Installer nu** → **Aktivér**.
3. Ved en ny version: upload zip-filen på samme måde, og vælg **Erstat nuværende med uploadet**. Indstillinger og ordrer bevares.
4. Tjek forbindelsen fra Next.js-serveren:
   ```bash
   curl -u "$WOOCOMMERCE_CONSUMER_KEY:$WOOCOMMERCE_CONSUMER_SECRET" https://admin.onlinemarketing.nu/wp-json/wc-headless/v1/status
   ```
   Svaret viser plugin- og WooCommerce-version, moms- og lagerindstillinger, om rabatkoder er slået til, og hvornår ubetalte ordrer sidst blev ryddet op.

Pluginet kræver WooCommerce 8.5+ og PHP 7.4+. Det understøtter både HPOS og det klassiske ordrelager. Det ændrer ikke butikkens normale checkout, bortset fra at "Fri fragt fra" også gælder dér (afsnit 10). Fra version 1.2 tilføjer det **Produkter → Webshops**, boksen **Webshops** på produkterne og kolonnen **Webshop** i ordrelisten (se afsnit 8).

## 2. REST API-nøgle

**WooCommerce → Indstillinger → Avanceret → REST API → Tilføj nøgle**

- Bruger: en **administrator** eller **butiksbestyrer** (pluginet kræver `manage_woocommerce`)
- Tilladelser: **Læs/skriv**
- Nøgle og secret skal kun ligge i `.env.local` eller Vercel. Aldrig i Git.

Forbindelsen bruger HTTP Basic auth over **HTTPS**. WooCommerce afviser Basic auth over almindelig HTTP. Permalinks skal være "pæne" (ikke "Almindelig"), så `/wp-json/` virker.

Shoppens kald til REST API'et sender sin egen User-Agent, `<domæne>-storefront/1.0 (+https://<domæne>)` med webshoppens domæne (`siteUrl` i `src/config/store.ts`), fx `fastelavnskostumer.dk-storefront/1.0 (+https://fastelavnskostumer.dk)`, i stedet for Nodes `node`: Simplys firewall kan afvise generiske User-Agents (HTTP 455). Guirca-importen sender `guirca-import/1.0`. Fotos (`/wp-content/uploads/`) henter billedoptimeringen selv med en User-Agent, shoppen ikke kan ændre: på Vercel Vercels egen, under `next start` og `next dev` Next.js' `node`. Afviser firewallen den, virker API'et, men fotos vises som pladsholdere. Afsnit 13, trin 5, tjekker det.

## 3. WooCommerce-indstillinger, som prototypen bruger

| Indstilling | Hvor | Anbefalet |
| --- | --- | --- |
| Valuta | Generelt | DKK |
| Sælg til | Generelt | Specifikke lande → Danmark (skal matche `storeConfig.countries`) |
| Aktivér moms | Generelt | Ja |
| Priser indtastet med moms | Moms | "Ja, jeg vil indtaste priser inkl. moms" (dansk standard) |
| Beregn moms ud fra | Moms | Kundens leveringsadresse |
| Vis priser i butik/kurv | Moms | Inkl. moms |
| Standardsats | Moms → Standardsatser | DK, 25 %, gælder fragt ✔ |
| Fragtzone | Fragt | "Danmark" med f.eks. Fast sats (pris **ekskl. moms**, f.eks. 39,20 = 49 kr. inkl. moms). Se afsnit 10. |
| Lagerstyring | Produkter → Lager | Aktivér lagerstyring ✔, Hold lager: 60 minutter |

Storefronten beregner **ingen** moms eller fragt selv. Den viser WooCommerces tal, så andre opsætninger (priser ekskl. moms, gratis fragt over X kr., afhentning, flere zoner) virker automatisk.

**Udsalgspris og førpris – læs før du bruger udsalgspris:** Har et produkt eller en variant en **Udsalgspris**, viser shoppen den normale pris som overstreget "Før"-pris, et "-X%"-mærke på produktkort og produktbillede og "Spar X kr." på produktsiden. Efter prisoplysningsbekendtgørelsen (EU's Omnibus-regler) skal førprisen ved en prisnedsættelse være den laveste pris, varen er solgt til i de 30 dage før nedsættelsen. Shoppen og pluginet gemmer ingen prishistorik og kan ikke kontrollere det. Brug derfor kun Udsalgspris, når normalprisen har været uændret i mindst de 30 dage før, og hæv aldrig normalprisen op til et udsalg. Ellers skal du rette normalprisen i stedet. Priserne er fælles, så en udsalgspris gælder i alle webshops, der sælger varen. Leverandørimporten sætter kun normalprisen.

## 4. Produktwebhooks for hver webshop

**Ikke sat op endnu** (`GET wc/v3/webhooks` gav en tom liste 17-10-2026, og begge webshoppers `/api/revalidate` svarer 503 "not configured", fordi `WOOCOMMERCE_WEBHOOK_SECRET` mangler). Uden webhooks vises en ændring i WooCommerce, når cachen alligevel opdateres: en produktside 5 min. efter sidste opdatering, lister og menu efter 15 min. og relaterede varer efter en time, hver gang når siden bliver vist (se [ARKITEKTUR.md](ARKITEKTUR.md#caching)). Med webhooks opdateres det ændrede produkt med det samme.

1. Lav en tilfældig, lang secret (fx `openssl rand -hex 32`), og sæt den som `WOOCOMMERCE_WEBHOOK_SECRET` i **begge** Vercel-projekter (Production). Redeploy.
2. **WooCommerce → Indstillinger → Avanceret → Webhooks → Tilføj webhook**, tre for hver webshop (seks i alt): *Produkt oprettet*, *Produkt opdateret* og *Produkt slettet*.
   - Leverings-URL: `https://fastelavnskostumer.dk/api/revalidate` for den ene webshops tre, `https://halloweenkostumer.dk/api/revalidate` for den andens. Ikke en `*.vercel.app`-preview: de er beskyttede, og leveringen fejler.
   - Secret: værdien fra trin 1.
   - API-version: WP REST API Integration v3.
   - Status: Aktiv.
3. Tjek under **Webhooks → (webhooken) → Logs**, at en ændring af et produkt får svar 200 (`{"ok":true,…}`).

Hvad en levering gør (`src/app/api/revalidate/route.ts`): produktets egne poster (produktside, relaterede varer, foto; for en variant dens produkt) markeres forældede med det samme. Hele kataloget (lister, menuens antal, sitemap) kun, når varer kan komme til eller forsvinde (oprettet, slettet, gendannet eller ikke længere udgivet), og højst hver 5. minut, så en import af tusindvis af varer ikke får hver liste læst igen efter hver vare. Næste visning får den gamle udgave med det samme, mens den nye hentes. Undtagen for en slettet eller ikke længere udgivet vare: dens egne poster udløber med det samme, så næste visning svarer 404 i stedet for at vise den gamle vare.

## 5. Hvad pluginet gør (endpoints)

Alle routes ligger under `/wp-json/wc-headless/v1` og kræver API-nøglen. De kaldes kun server-til-server.

| Endpoint | Formål |
| --- | --- |
| `GET /status` | Sundhedstjek, inkl. oprydning af ubetalte ordrer |
| `POST /quote` | Kurv → priser, lager (inkl. andres reservationer), rabatkoder, moms, fragtmetoder, total. Opretter intet. |
| `POST /orders` | Opret, genoptag eller gentag (idempotent) ordren for en checkout-session. Reserverer lager og rabatkoder. Afviser, hvis totalen afviger fra den, kunden så, eller hvis en rabatkode ikke længere kan bruges. Gemmer webshoppens brand, sælger og returregler til ordremailene (afsnit 11). |
| `POST /orders/{id}/payment-intent` | Tilknyt Stripe PaymentIntent (compare-and-set) |
| `POST /orders/{id}/payment` | Anvend verificeret betalingsstatus og den betalingsmetode, kunden brugte: `authorized` (1.5: beløbet er reserveret, med shoppens callback-adresse og ordrens token), `succeeded` (betalt eller trukket), `processing`, `failed`, `canceled` (annulleret, frigivet eller udløbet) og `capture_failed` (1.5: Stripe afviste trækket) |
| `POST /payments/sweep` | (1.5) Shoppens daglige job: webshoppens ordrer, hvis reservation skal trækkes (*Gennemført*) eller frigives (annulleret, refunderet, mislykket), og advarsel (note og mail) om reservationer ældre end 5 dage og om sendte ordrer, der et døgn senere ikke er trukket. Se afsnit 12. |
| `GET /orders/{id}?order_key=…` | Ordreoversigt til bekræftelsessiden (fra 1.5 med `capture`: reservationens status og det beløb, der trækkes) |
| `GET /shops` · `PUT /shops/{butiks-id}` | Webshops: list, opret eller omdøb |
| `GET /shops/{butiks-id}/category-counts` | (1.4) Antal udgivne produkter pr. kategori i webshoppen, underkategorier medregnet, i ét kald: `{"<kategori-id>": antal, …}`. Caches, til et produkt, en kategori eller en webshop ændres (også papirkurv, gendannelse og planlagt udgivelse). En optælling, som en ændring overlappede, gemmes ikke. Frontenden bruger det til menuen i stedet for ét kald pr. kategori. |

Produkt-svar i REST API v3 får desuden feltet `headless_prices` med priser beregnet efter butikkens momsvisning og feltet `webshops` med de webshops, der sælger produktet. `webshops` kan også sættes via API'et, og `GET /wc/v3/products?wchc_shop=<butiks-id>` viser kun webshoppens produkter.

`GET /wc/v3/products?category=<id>&wchc_in_category=<id>[,<id>…]` (plugin 1.4) viser kun de produkter i `category`, der også ligger i hver af kategorierne i `wchc_in_category` eller deres underkategorier. Damekostumer og Halloween giver f.eks. halloweenkostumerne til kvinder. WooCommerces eget `category` giver produkter i blot én af sine kategorier. Ikke-numeriske og ukendte ID'er ignoreres, og filteret virker også sammen med `wchc_shop`.

`wchc_not_in_category=<id>[,<id>…]` (plugin 1.4) udelader produkter, der ligger i en af kategorierne eller deres underkategorier. Fastelavnsshoppen holder f.eks. halloween- og juleprodukter væk fra sine temasider. Filteret kan kombineres med `category`, `tag`, `wchc_in_category` og `wchc_shop` (produkterne skal opfylde dem alle), og ikke-numeriske ID'er ignoreres.

`wchc_in_any_category=<id>[,<id>…]` (plugin 1.4) viser kun produkter, der ligger i mindst én af kategorierne (eller deres underkategorier). Sammen med `wchc_not_in_category` bruger kategorisiderne det til at vise shoppens egen sæson først og resten bagefter (se ARKITEKTUR.md).

## 6. Rabatkoder

Opret rabatkoder i **Marketing → Kuponer** som i en almindelig WooCommerce-butik. Kassen viser feltet "Rabatkode", når **WooCommerce → Indstillinger → Generelt → Aktivér brug af kuponkoder** er slået til.

WooCommerce afgør alt: rabattype, minimumsbeløb, produkter og kategorier, udløbsdato, brugsgrænser og tilladte e-mailadresser. Kassen viser WooCommerces begrundelse, hvis en kode afvises. En kode med brugsgrænse reserveres til kundens ordre, mens betalingen står på, så kunden kan prøve igen efter en afvist betaling, uden at andre når at bruge den sidste gang. Forbruget tælles, når ordren er betalt.

## 7. Ubetalte ordrer

- En ordre med reserveret betaling (*Afventer*) er ikke ubetalt i denne forstand: den annulleres aldrig automatisk (afsnit 12).
- En ubetalt ordre genbruges, når kunden trykker Betal igen i samme browser, men kun i butikkens "Hold lager"-tid (60 minutter, hvis feltet er tomt). Kommer kunden senere, annulleres den gamle ordre, og kunden får en ny med dagens dato og nyt nummer.
- Pluginet annullerer selv ubetalte headless-ordrer, når "Hold lager"-tiden er gået. Det sker hvert kvarter via WP-Cron og desuden, når shoppen kalder pluginet (højst hvert 5. minut). Oprydningen virker derfor også, når ingen besøger WordPress-siden. Lager og reserverede rabatkoder frigives.
- Ordren viser den betalingsmetode, kunden faktisk brugte, f.eks. "MobilePay (Stripe)" eller "Visa-kort (Stripe)". Indtil betalingen står der "Stripe".
- Et afvist betalingsforsøg noteres én gang på ordren, selv om både webhooken og kundens browser melder det.

## 8. Webshops (flere frontends)

Flere webshops kan dele denne WooCommerce. Opret hver webshop under **Produkter → Webshops** med webshoppens butiks-ID (`NEXT_PUBLIC_STORE_ID`) som slug. Kryds derefter af i boksen **Webshops** på hvert produkt, hvilke webshops der sælger det (kan også gøres for mange produkter ad gangen med **Masseredigering** i produktlisten). Se [MULTISHOP.md](MULTISHOP.md).

- En webshop viser og sælger kun sine egne produkter. Kassen afviser andre produkter.
- Et nyt produkt sælges ingen steder, før en webshop er krydset af.
- Et butiks-ID, der ikke er oprettet som webshop, sælger alle produkter (som før version 1.2).

## 9. Felter, shoppen læser fra en import

Leverandørimporten ([IMPORT-GUIRCA.md](IMPORT-GUIRCA.md)) gemmer data på produktet, som shoppen bruger. De kan også sættes i hånden (Brugerdefinerede felter) eller via REST API'et (`meta_data`):

| Meta-nøgle | Bruges til |
| --- | --- |
| `_wchc_external_images` | Liste med links til leverandørens fotos. Vises, når produktet ikke har egne billeder. Kun værter i `src/config/images.ts`. |
| `_wchc_size_chart` | Link til størrelsesguide på produktsiden |
| `_wchc_safety_info` | Link til leverandørens sikkerhedsmærkat med advarsler (EU's GPSR) |
| `_supplier`, `_supplier_article_codes` | Leverandør og varenumre; importen finder varen igen med dem |
| `_wchc_import_issue` | Hvorfor importen lavede varen som kladde (f.eks. manglende pris) |

## 10. Fragt og fri fragt

Fragtmetoderne oprettes under **WooCommerce → Indstillinger → Forsendelse** i zonen "Danmark" og er fælles for alle webshops. Kassen viser dem i zonens rækkefølge, og den første er valgt på forhånd.

- **Pris:** "Fast sats" indtastes **ekskl. moms**. 39 kr. inkl. moms skrives som 31,20 (39 / 1,25).
- **Fri fragt fra** (plugin 1.3): feltet på en Fast sats-metode. Når varerne koster mindst beløbet (inkl. moms og efter rabat, som i kurven), viser kassen metoden som "Gratis", og ordren får 0 kr. i fragt. Kunden vælger stadig selv fragtfirma. Lad feltet stå tomt på metoder, der altid koster det samme, f.eks. levering til døren.
- Shoppen læser det laveste "Fri fragt fra"-beløb og viser det i sine løfter ("Fri fragt til pakkeshop v/ 599 kr.") og i kurven ("Køb for 120 kr. mere …"). Teksterne følger derfor med, når beløbet ændres i WooCommerce (inden for en time).
- WooCommerces egen metode **Gratis forsendelse** virker også, men den vises som et ekstra valg ved siden af de betalte metoder. Den skal bruges, hvis en rabatkode skal give fri fragt (kuponens afkrydsning for gratis forsendelse). "Fri fragt fra" reagerer ikke på sådanne rabatkoder.

## 11. Ordremails i webshoppens navn

Fra plugin 1.4 viser WooCommerces ordremails den webshop, kunden har købt i, i stedet for WordPress-sidens navn. Shoppen sender sit brand med ordren (`store` i `POST /orders`, bygget i `src/lib/checkout/branding.ts`), og pluginet gemmer de gyldige felter på ordren som meta `_wchc_store_branding`:

| Felt | Fra shoppen | Krav (ellers gemmes feltet ikke) |
| --- | --- | --- |
| `name` | `storeConfig.name` | Ren tekst, højst 100 tegn |
| `url` | `NEXT_PUBLIC_SITE_URL` | http- eller https-adresse |
| `email` | `storeConfig.supportEmail` (`NEXT_PUBLIC_SUPPORT_EMAIL`) | Gyldig e-mailadresse |
| `color` | Brandets farve `action`, ellers `#1d1b19` | `#rrggbb` |
| `logo` | `NEXT_PUBLIC_SITE_URL` + `/email-logo.png` (`public/email-logo.png` i shoppen) | https-adresse |
| `company_name`, `company_address`, `cvr` | `company.name`, `company.address`, `company.cvr` i `src/config/company.ts` | Ren tekst, højst 100 / 200 / 50 tegn |
| `return_address` | `company.returnAddress` | Ren tekst, højst 200 tegn |
| `return_shipping` | `company.returnShipping` (hvem betaler returfragten, som en sætning) | Ren tekst, højst 500 tegn |
| `return_days` | `RETURN_DAYS` i `src/lib/checkout/branding.ts` (30, som i handelsbetingelserne) | Helt tal, 14–365 |

Mails om en ordre med brandet (kundens mails, f.eks. *Behandler*, *Gennemført*, *Afventer*, *Refunderet*, faktura og kundenote, og *Ny ordre* til butikken) ændres sådan:

- **Afsendernavn:** webshoppens navn. Afsenderadressen er stadig WooCommerces (**WooCommerce → Indstillinger → E-mails → Fra-adresse**), se nedenfor.
- **Svar til (Reply-To):** webshoppens e-mail i kundens mails. *Ny ordre* og de andre mails til butikken har stadig kunden som Svar til, som i WooCommerce.
- **Pladsholdere** i emne, overskrift, ekstra indhold og sidefodstekst: `{site_title}` bliver webshoppens navn, `{site_url}` webshoppens domæne, `{store_url}` dens fulde adresse og `{store_email}` webshoppens e-mail (i WooCommerce er den ellers Fra-adressen, som alle webshops deler).
- **Logo og farve:** headerbilledet er webshoppens logo og linker til webshoppen. Grundfarven er webshoppens farve.
- **Ny ordre:** emnet nævner webshoppen, også hvis det ikke indeholder `{site_title}`, f.eks. "[Maskerade] Ny ordre #123".
- **Fortrydelsesret i ordrebekræftelsen:** kundens *Behandler* og *Afventer* (HTML og ren tekst) får efter adresserne et afsnit "Fortrydelsesret og 30 dages returret" og hele standardfortrydelsesformularen. Forbrugeraftaleloven kræver oplysningerne på et varigt medium (mailen) senest ved levering; et link til siden er ikke nok. Afsnittet har: 14 dages fortrydelsesret og shoppens returret (`return_days`) fra modtagelsen, besked til webshoppens e-mail med ordrenummeret, returnering senest 14 dage efter beskeden, returadressen, returfragten, tilbagebetaling senest 14 dage efter beskeden, værdiforringelse, undtagelsen for forseglede hygiejnevarer og sælgeren (firmanavn, CVR, adresse). Formularen er stilet til firmaet, dets adresse og webshoppens e-mail. Teksten følger `/fortrydelsesret` og `/handelsbetingelser` (`src/content/info-pages.ts`); ændres de, skal `WCHC_Emails::withdrawal_sections()` i pluginet følge med (integrationstesten sammenligner formularen med siden). *Ny ordre* til butikken får det ikke.

Et felt, der mangler eller er ugyldigt, bruger WooCommerces egen indstilling. Mangler sælger- eller returfelterne (en shop før denne version), udelades de linjer, og formularen stiles til webshoppens navn. Uden `email` kommer afsnittet ikke med. Firmaoplysninger, der stadig er pladsholdere (`[Returadresse]`), sendes som de er, så testmails viser, hvad der mangler. Udfyld dem i `src/config/company.ts`, før shoppen går live. Ordrer uden brand (fra en shop før plugin 1.4 eller oprettet i WordPress) får WooCommerces mails som før. WooCommerces blokbaserede e-mail-editor (slået fra som standard) får afsendernavn, Svar til og tekster. Dér kommer logo eller sidetitel og farver fra editorens skabelon.

Sæt `NEXT_PUBLIC_SUPPORT_EMAIL` i hver webshops Vercel-projekt, hvis kundeservice skal have en anden adresse end brandets i `src/config/store.ts`.

**Til ejeren – Fra-adressen:** pluginet ændrer ikke WooCommerces indstillinger. Fra-adressen (**WooCommerce → Indstillinger → E-mails → Fra-adresse**) er afsender på alle mails fra begge webshops. Sæt den til en neutral butiksadresse (f.eks. `ordre@fastelavnskostumer.dk`) i stedet for en personlig postkasse, og send mails fra WordPress gennem en godkendt SMTP-server med SPF og DKIM for domænet, så de ikke ender som spam.

## 12. Reservation og træk ved afsendelse

Fra plugin 1.5 trækkes kundens betaling først, når ordren sendes (et betalingskort må som udgangspunkt først debiteres, når varen sendes). Kræver shoppen fra samme version (se [STRIPE.md](STRIPE.md#reservation-og-træk-ved-afsendelse)).

**Sådan ser det ud i WooCommerce:**

1. Kunden betaler: beløbet **reserveres**. Ordren står som **Afventer** (on-hold) med noten "Betalingen er reserveret og trækkes, når ordren sendes", lageret er trukket, og kunden får ordrebekræftelsen (*Afventer*, med fortrydelsesretten og teksten "Vi har reserveret … Beløbet trækkes først, når vi sender din ordre"). Butikken får *Ny ordre* med "Betalingen … er reserveret, ikke trukket". Ordren har endnu intet transaktions-ID og ingen betalingsdato.
2. **Når pakken sendes, markeres ordren som Gennemført** (enkeltvis eller med masseredigering i ordrelisten). Pluginet beder straks shoppen om at trække beløbet. Få sekunder senere står noten "Betalingen er trukket: … (pi_…)", og ordren har transaktions-ID og betalingsdato (tidspunktet for trækket). Kunden får *Gennemført*-mailen med "Vi trækker nu det reserverede beløb".
3. **Kan en vare ikke sendes:** refundér den i WooCommerce (**Refunder** → **Refunder manuelt**), før ordren markeres *Gennemført*. Så trækkes kun resten, og resten af reservationen frigives. Kundens refunderingsmail fra WooCommerce får teksten "Beløbet er ikke trukket endnu, så der er intet at betale tilbage …", da intet er trukket.
4. **Skal ordren ikke sendes:** sæt den til **Annulleret**. Reservationen frigives (noten "Reservationen på … er frigivet"), kunden betaler ingenting, og WooCommerce lægger varerne tilbage på lager. (Refunderet frigiver også reservationen, men lægger ikke varerne på lager.)
5. Ordren kan godt stå som *Behandler* (fx mens den pakkes). Det er *Gennemført*, der trækker beløbet. Indtil da har ordren ingen betalingsdato, heller ikke som *Behandler*.

**Når noget går galt:**

- **Trækket afvises:** ordren sættes tilbage til **Afventer** med noten "Betalingen kunne ikke trækkes: …", og butikken får en mail. Kontakt kunden om betalingen. Markér ordren *Gennemført* igen for et nyt forsøg.
- **Reservationen udløber** i Stripe, før ordren er sendt (normalt efter 7 dage): note og mail. Beløbet kan ikke længere trækkes, og en ordre markeret *Gennemført* går tilbage til *Afventer* med en ny note og mail. Få betalingen fra kunden på anden vis (fx et betalingslink fra Stripe Dashboard eller en bankoverførsel), vælg så **Betalingen er klaret uden om webshoppen** under **Ordrehandlinger** og tryk **Opdater**, og markér derefter ordren *Gennemført*. Det samme gælder en annulleret ordre, der genåbnes og sendes, og et træk, der bliver ved med at blive afvist. Handlingen vises kun, når reservationen ikke kan trækkes.
- **Efter 5 dage** uden afsendelse: shoppens daglige job noterer det på ordren og sender én mail med de ordrer, der snart udløber.
- **Sendt, men ikke trukket et døgn senere** (fx fordi Stripe eller WordPress fejlede, da shoppen prøvede): det daglige job noterer "Ordren er sendt, men betalingen er endnu ikke trukket" og sender én mail pr. forsøg. Jobbet prøver igen hver morgen; vælg **Træk eller frigiv betalingen nu**, eller kontakt udvikleren, før reservationen udløber.
- **Shoppen kunne ikke nås** (fx en preview bag Vercels beskyttelse, eller nede): noten "Webshoppen kunne ikke få besked om betalingen …". Det daglige job trækker eller frigiver beløbet næste morgen. Vil du ikke vente, så vælg **Træk eller frigiv betalingen nu** under **Ordrehandlinger** på ordren og tryk **Opdater**.
- Ordren må aldrig trækkes to gange: shoppen læser altid ordren og betalingen igen, før den trækker, og Stripe accepterer kun ét træk pr. reservation. Gentagne beskeder, en ordre markeret *Gennemført* to gange og det daglige job ændrer intet, når beløbet er trukket.

**Teknisk:**

- Ordremeta: `_wchc_capture_status` (`authorized`, `captured`, `failed`, `expired`, `released`, `manual` = klaret uden om webshoppen), `_wchc_authorized_at`, `_wchc_settle_callback` (shoppens adresse og ordrens token), `_wchc_reservation_warned`, `_wchc_capture_attempt`, `_wchc_capture_late_warned`. Ordrer uden `_wchc_capture_status` (betalt før 1.5) røres ikke.
- Ved statusskiftet sender pluginet, når WordPress er færdig med ordren, `POST <shop>/api/payments/settle` med `{"orders":[{"id","order_key","token"}]}` (højst 10 ordrer pr. forespørgsel, timeout 10 sek., kun https, højst to omdirigeringer med 301/307/308). Tokenet er shoppens HMAC af webshop, ordre-ID og ordrenøgle (med `STRIPE_SECRET_KEY`): kun shoppen kan lave det, og WordPress skal ikke have en ny hemmelighed. Shoppen svarer med det samme og trækker bagefter; resultatet kommer tilbage som en betalingshændelse under ordrelåsen.
- Advarslen efter 5 dage kan ændres med filteret `wchc_reservation_warn_days`. Mails til butikken går til modtagerne af *Ny ordre* (ellers sidens administrator-e-mail).

## 13. Flytning af WordPress til en anden adresse

WordPress med WooCommerce flyttede 17-10-2026 fra `https://test.piece.dk` til `https://admin.onlinemarketing.nu`, en kopi på et andet webhotel hos Simply (onlinemarketing.nu, mappen `/admin/test`, databasen `onlinemarketing_nu_db_woo`). Webshopperne finder WordPress via `WOOCOMMERCE_URL`, og billedoptimeringen får sin vært derfra, når projektet bygges (`next.config.ts`). Tag trinene i denne rækkefølge.

**Først:** den version af shoppen, der kender begge værter, skal køre i produktion i begge Vercel-projekter. `WORDPRESS_MOVE_HOSTS` i `src/config/images.ts` tillader fotos (`/wp-content/uploads/`) fra både test.piece.dk og admin.onlinemarketing.nu, hvilken af dem `WOOCOMMERCE_URL` end peger på, og shoppens API-kald sender sin egen User-Agent (afsnit 2).

1. **Den nye vært på HTTPS:** `https://admin.onlinemarketing.nu` skal svare med et gyldigt certifikat (Let's Encrypt hos Simply). WooCommerce afviser Basic auth over HTTP.
2. **Kopiér database og filer** til det nye webhotel: databasen (hos Simply: **MySQL → Importer MySQL-database → Importer fra MySQL-server**, ellers eksport og import med phpMyAdmin) og hele WordPress-mappen med `wp-content` (uploads, plugins, tema) og `.htaccess`. Ordrer og ændringer på test.piece.dk efter kopien kommer ikke med: kopiér, når der er stille, og ret ikke produkter eller ordrer i den gamle WordPress bagefter. Hvad der alligevel kommer dertil, indtil trin 7 er gjort i begge projekter, tjekkes i trin 9.
3. **`wp-config.php` på den nye vært:** den nye databases `DB_NAME`, `DB_USER`, `DB_PASSWORD` og `DB_HOST`, og adressen:
   ```php
   define('WP_HOME', 'https://admin.onlinemarketing.nu');
   define('WP_SITEURL', 'https://admin.onlinemarketing.nu');
   ```
4. **Søg og erstat** med pluginet Better Search Replace (**Værktøjer → Better Search Replace**) på den nye vært: `test.piece.dk` → `admin.onlinemarketing.nu` i alle tabeller. Kør først som prøvekørsel (**Run as dry run?** slået til), se antallet af ændringer, og kør så for alvor. Slå **Replace GUIDs?** fra: et indlægs GUID må ikke ændres. Pluginet retter også serialiserede indstillinger, som en SQL-`REPLACE` ødelægger. Gem bagefter **Indstillinger → Permalinks** én gang.
5. **Tjek forbindelsen** med API-nøglen (den samme: nøglerne ligger i databasen) og shoppens User-Agent (curls egen kan blive afvist af firewallen):
   ```bash
   curl -A "fastelavnskostumer.dk-storefront/1.0 (+https://fastelavnskostumer.dk)" \
     -u "$WOOCOMMERCE_CONSUMER_KEY:$WOOCOMMERCE_CONSUMER_SECRET" \
     https://admin.onlinemarketing.nu/wp-json/wc-headless/v1/status
   ```
   Svaret skal have plugin-versionen og `"currency":"DKK"`. Med samme kommando skal `…/wp-json/wc/v3/products?per_page=1` vise fotos (`images[].src`) under `https://admin.onlinemarketing.nu/wp-content/uploads/`, ikke på test.piece.dk. Fotos hentes med billedoptimeringens User-Agent (afsnit 2), så tjek også et af de links:
   ```bash
   curl -sI -A node https://admin.onlinemarketing.nu/wp-content/uploads/<sti fra images[].src>
   ```
   skal svare `200` med `content-type: image/…`, og `https://fastelavnskostumer.dk/_next/image?url=<samme link, URL-kodet>&w=640&q=75` skal vise fotoet i browseren (Vercels billedoptimering; den kørende version må allerede hente fra den nye vært). Svarer en af dem med 455 eller en fejl, så få Simply til at lade `/wp-content/uploads/` igennem, før trin 6.
6. **`WOOCOMMERCE_URL` i begge Vercel-projekter** (Production og Preview): `https://admin.onlinemarketing.nu`. Nøgle og secret er uændrede. Ret den også i `.env.local` (Guirca-importen og lokale builds).
7. **Sæt ét projekt ad gangen i produktion.** `WOOCOMMERCE_URL` læses ved build, så projektet skal bygges igen (**Deployments** → den aktuelle produktion → **Redeploy**). Tjek webshoppen, før det andet projekt følger: forsiden, en produktside med fotos, kurven og fragten i kassen (en POST til WooCommerce), og at Vercels logs ikke har `WooCommerce request failed` (fx 401 eller 455).
8. **Varm cachen op** for hver webshop med `scripts/warm.mjs` ([DEPLOY.md](DEPLOY.md#5-efter-deploy)).
9. **Ordrer, der kom på den gamle vært.** Indtil trin 7 er live i begge projekter, skriver webshopperne stadig til test.piece.dk: nye ordrer, betalinger fra Stripe og det daglige jobs træk og frigivelser (afsnit 12). Sammenlign derfor nu, mens den gamle admin kan nås (trin 10 omdirigerer den), ordrelisterne på de to værter: ordrer oprettet efter kopien, og kopierede ordrer, hvis status er ændret siden (fx *Afventer* på test.piece.dk, men *Afventende betaling* eller *Annulleret* på admin.onlinemarketing.nu). En kopieret ordre retter shoppen selv: send betalingens seneste hændelse igen i Stripe Dashboard (**Developers → Webhooks** → webshoppens endpoint → hændelsen → **Resend**), så læser shoppen betalingen i Stripe og skriver den på den nye vært. En ordre, der kun findes på test.piece.dk, kender shoppen ikke længere: opret den i hånden på admin.onlinemarketing.nu, og træk eller annullér dens betaling (`pi_…` i ordrens note om reservationen) i Stripe Dashboard, når den sendes, eller hvis den ikke skal sendes. Jo kortere tid mellem kopien og trin 7 i begge projekter, jo færre er der.
10. **Først nu: 301 fra den gamle vært.** Øverst i `.htaccess` på test.piece.dk, før WordPress' egen blok:
    ```apache
    RewriteEngine On
    RewriteCond %{HTTP_HOST} ^test\.piece\.dk$ [NC]
    RewriteCond %{REQUEST_URI} !^/\.well-known/
    RewriteCond %{REQUEST_URI} !^/wp-content/uploads/
    RewriteRule ^(.*)$ https://admin.onlinemarketing.nu/$1 [R=301,L]
    ```
    Kun værtsnavnet test.piece.dk omdirigeres (ikke andre domæner på webhotellet), og sti og søgestreng følger med, så gamle links til fotos og sider virker. `/.well-known/` omdirigeres ikke: Simply fornyer Let's Encrypt-certifikatet derigennem, og uden certifikat virker omdirigeringen heller ikke. `/wp-content/uploads/` omdirigeres heller ikke: gamle fotolinks hentes direkte fra den gamle kopis filer, så de virker, uanset om billedoptimeringen følger en omdirigering. Aldrig før trin 7 er gjort i begge projekter: følger shoppen en omdirigering til en anden vært, sendes `Authorization` ikke med (WooCommerce svarer 401), og en 301 gør kassens POST (fragt og ordre) til en GET. Det samme gælder Guirca-importen, som derfor skal have den nye `WOOCOMMERCE_URL` først.
11. **Ca. 31 dage efter trin 7:** tøm `WORDPRESS_MOVE_HOSTS` i `src/config/images.ts` (`[]`), og deploy begge projekter. Så længe gemmer billedoptimeringen sine kopier (`minimumCacheTTL` i `next.config.ts`), og så længe kan sider og delinger have fotolinks til test.piece.dk. Kurve gemt i kundernes browsere beholder deres fotolinks, til varen lægges i kurven igen: et foto, der stadig peger på test.piece.dk, vises bagefter som pladsholder (kun udseendet, købet virker). Lad 301'en blive stående for søgemaskiner og delte links.

**Udført 17-10-2026.** Begge webshops læser fra admin.onlinemarketing.nu (Fastelavn fra kl. 11.49, Halloween fra 11.51 UTC). Tjekket: forside, produktside med egne fotos via `/_next/image`, fragt i kassen (`/api/checkout/quote`) og ingen henvisninger til test.piece.dk i siderne; ingen ordrer oprettet eller ændret på nogen af værterne efter kopien (trin 9 var tomt); begge caches varmet (`warm.mjs`, alt 200); Simplys firewall- og fejllog uden afvisninger af shoppen. test.piece.dk sender alt videre med 301, undtagen `/.well-known/` (certifikatfornyelse) og `/wp-content/uploads/` (gamle fotolinks i kurve og delinger hentes stadig direkte). README, `.env.example`, DEPLOY.md og TEST.md nævner nu den nye vært.

**Tilbage:** tøm `WORDPRESS_MOVE_HOSTS` omkring 17-11-2026 (trin 11). Når den gamle kopi ikke skal bruges som nødplan længere: slet WordPress-filerne i `/test` på piece.dk (behold `/test/.htaccess`, `/test/wp-content/uploads/` og certifikatet, så længe omdirigeringen skal virke) og kun shoppens tabeller i `piece_dk_db` (præfikset `clka586f98fc9_`). Slet ikke hele databasen: tabellerne med præfikset `clke9e9d3b641_` hører til en anden WordPress på piece.dk, som stadig bruger den. De samme `clke9e9d3b641_`-tabeller kom med i kopien i `onlinemarketing_nu_db_woo`, hvor ingen bruger dem.

## Kendte begrænsninger

- "Enhver"-varianter (variant uden fast attributværdi) understøttes ikke. Varianter skal have konkrete værdier.
- Ordrer oprettes som gæsteordrer (ingen kundekonto/login).
