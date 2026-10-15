# WooCommerce-forbindelsen

## 1. Installér pluginet "Headless Checkout Bridge"

1. Byg zip-filen med `npm run plugin:zip` (giver `dist/headless-checkout-bridge.zip`), eller zip mappen `wordpress-plugin/headless-checkout-bridge`.
2. I WordPress: **Plugins → Tilføj nyt → Upload plugin** → vælg zip → **Installer nu** → **Aktivér**.
3. Ved en ny version: upload zip-filen på samme måde, og vælg **Erstat nuværende med uploadet**. Indstillinger og ordrer bevares.
4. Tjek forbindelsen fra Next.js-serveren:
   ```bash
   curl -u "$WOOCOMMERCE_CONSUMER_KEY:$WOOCOMMERCE_CONSUMER_SECRET" https://test.piece.dk/wp-json/wc-headless/v1/status
   ```
   Svaret viser plugin- og WooCommerce-version, moms- og lagerindstillinger, om rabatkoder er slået til, og hvornår ubetalte ordrer sidst blev ryddet op.

Pluginet kræver WooCommerce 8.5+ og PHP 7.4+. Det understøtter både HPOS og det klassiske ordrelager. Det ændrer ikke butikkens normale checkout, bortset fra at "Fri fragt fra" også gælder dér (afsnit 10). Fra version 1.2 tilføjer det **Produkter → Webshops**, boksen **Webshops** på produkterne og kolonnen **Webshop** i ordrelisten (se afsnit 8).

## 2. REST API-nøgle

**WooCommerce → Indstillinger → Avanceret → REST API → Tilføj nøgle**

- Bruger: en **administrator** eller **butiksbestyrer** (pluginet kræver `manage_woocommerce`)
- Tilladelser: **Læs/skriv**
- Nøgle og secret skal kun ligge i `.env.local` eller Vercel. Aldrig i Git.

Forbindelsen bruger HTTP Basic auth over **HTTPS**. WooCommerce afviser Basic auth over almindelig HTTP. Permalinks skal være "pæne" (ikke "Almindelig"), så `/wp-json/` virker.

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

## 4. Valgfrit: øjeblikkelig opdatering af produkter

Produktsider caches i op til et minut. For at opdatere dem med det samme ved ændringer:

**WooCommerce → Indstillinger → Avanceret → Webhooks → Tilføj webhook** for hver af *Produkt oprettet / opdateret / slettet*:

- Leverings-URL: `https://<din-butik>/api/revalidate`
- Secret: samme værdi som `WOOCOMMERCE_WEBHOOK_SECRET`
- API-version: WP REST API Integration v3

## 5. Hvad pluginet gør (endpoints)

Alle routes ligger under `/wp-json/wc-headless/v1` og kræver API-nøglen. De kaldes kun server-til-server.

| Endpoint | Formål |
| --- | --- |
| `GET /status` | Sundhedstjek, inkl. oprydning af ubetalte ordrer |
| `POST /quote` | Kurv → priser, lager (inkl. andres reservationer), rabatkoder, moms, fragtmetoder, total. Opretter intet. |
| `POST /orders` | Opret, genoptag eller gentag (idempotent) ordren for en checkout-session. Reserverer lager og rabatkoder. Afviser, hvis totalen afviger fra den, kunden så, eller hvis en rabatkode ikke længere kan bruges. Gemmer webshoppens brand, sælger og returregler til ordremailene (afsnit 11). |
| `POST /orders/{id}/payment-intent` | Tilknyt Stripe PaymentIntent (compare-and-set) |
| `POST /orders/{id}/payment` | Anvend verificeret betalingsstatus (succeeded/processing/failed/canceled) og den betalingsmetode, kunden brugte |
| `GET /orders/{id}?order_key=…` | Ordreoversigt til bekræftelsessiden |
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
- Shoppen læser det laveste "Fri fragt fra"-beløb og viser det i sine løfter ("Fri fragt v/ 599 kr.") og i kurven ("Køb for 120 kr. mere …"). Teksterne følger derfor med, når beløbet ændres i WooCommerce (inden for en time).
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

## Kendte begrænsninger

- "Enhver"-varianter (variant uden fast attributværdi) understøttes ikke. Varianter skal have konkrete værdier.
- Ordrer oprettes som gæsteordrer (ingen kundekonto/login).
