# WooCommerce-forbindelsen

## 1. Installér pluginet "Headless Checkout Bridge"

1. Byg zip-filen med `npm run plugin:zip` (giver `dist/headless-checkout-bridge.zip`), eller zip mappen `wordpress-plugin/headless-checkout-bridge`.
2. I WordPress: **Plugins → Tilføj nyt → Upload plugin** → vælg zip → **Installer nu** → **Aktivér**.
3. Tjek forbindelsen fra Next.js-serveren:
   ```bash
   curl -u "$WOOCOMMERCE_CONSUMER_KEY:$WOOCOMMERCE_CONSUMER_SECRET" https://test.piece.dk/wp-json/wc-headless/v1/status
   ```
   Svaret viser plugin- og WooCommerce-version samt moms- og lagerindstillinger.

Pluginet kræver WooCommerce 8.5+ og PHP 7.4+. Det understøtter både HPOS og det klassiske ordrelager. Det tilføjer ingen admin-sider og ændrer ikke butikkens normale checkout.

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
| `GET /status` | Sundhedstjek |
| `POST /quote` | Kurv → priser, lager (inkl. andres reservationer), moms, fragtmetoder, total. Opretter intet. |
| `POST /orders` | Opret, genoptag eller gentag (idempotent) ordren for en checkout-session. Reserverer lager. Afviser, hvis totalen afviger fra den, kunden så. |
| `POST /orders/{id}/payment-intent` | Tilknyt Stripe PaymentIntent (compare-and-set) |
| `POST /orders/{id}/payment` | Anvend verificeret betalingsstatus (succeeded/processing/failed/canceled) |
| `GET /orders/{id}?order_key=…` | Ordreoversigt til bekræftelsessiden |

Produkt-svar i REST API v3 får desuden feltet `headless_prices` med priser beregnet efter butikkens momsvisning.

## Kendte begrænsninger

- Kuponer er ikke koblet på checkouten endnu. WooCommerces kurv understøtter dem, så det er et lille skridt.
- "Enhver"-varianter (variant uden fast attributværdi) understøttes ikke. Varianter skal have konkrete værdier.
- Ordrer oprettes som gæsteordrer (ingen kundekonto/login).
