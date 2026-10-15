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

Pluginet kræver WooCommerce 8.5+ og PHP 7.4+. Det understøtter både HPOS og det klassiske ordrelager. Det ændrer ikke butikkens normale checkout. Fra version 1.2 tilføjer det **Produkter → Webshops**, boksen **Webshops** på produkterne og kolonnen **Webshop** i ordrelisten (se afsnit 8).

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
| Fragtzone | Fragt | "Danmark" med f.eks. Flat rate (pris **ekskl. moms**, f.eks. 39,20 = 49 kr. inkl. moms) |
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
| `POST /orders` | Opret, genoptag eller gentag (idempotent) ordren for en checkout-session. Reserverer lager og rabatkoder. Afviser, hvis totalen afviger fra den, kunden så, eller hvis en rabatkode ikke længere kan bruges. |
| `POST /orders/{id}/payment-intent` | Tilknyt Stripe PaymentIntent (compare-and-set) |
| `POST /orders/{id}/payment` | Anvend verificeret betalingsstatus (succeeded/processing/failed/canceled) og den betalingsmetode, kunden brugte |
| `GET /orders/{id}?order_key=…` | Ordreoversigt til bekræftelsessiden |
| `GET /shops` · `PUT /shops/{butiks-id}` | Webshops: list, opret eller omdøb |

Produkt-svar i REST API v3 får desuden feltet `headless_prices` med priser beregnet efter butikkens momsvisning og feltet `webshops` med de webshops, der sælger produktet. `webshops` kan også sættes via API'et, og `GET /wc/v3/products?wchc_shop=<butiks-id>` viser kun webshoppens produkter.

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

## Kendte begrænsninger

- "Enhver"-varianter (variant uden fast attributværdi) understøttes ikke. Varianter skal have konkrete værdier.
- Ordrer oprettes som gæsteordrer (ingen kundekonto/login).
