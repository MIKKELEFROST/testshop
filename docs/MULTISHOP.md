# Flere webshops på samme WooCommerce

Flere frontends (Fastelavnskostumer.dk og Halloweenkostumer.dk) deler **én WooCommerce**: samme produkter, lager, kunder og ordrer, samme Stripe-konto. Hver webshop har sit eget domæne, sit eget design og sin egen kasse, og sælger kun de produkter, den har fået tildelt.

## Sådan hænger det sammen

| Hvor | Hvad |
| --- | --- |
| Vercel | Ét projekt pr. webshop, alle fra samme GitHub-repo. Forskellen er miljøvariablerne, især `NEXT_PUBLIC_STORE_ID`. |
| `src/config/store.ts` | Webshoppens brand: navn, logo, tekster, farver, overskriftsskrift, kundeservice-e-mail og den sæson, shoppen er bygget op om. Valgt ud fra `NEXT_PUBLIC_STORE_ID`. |
| `src/config/merchandising.ts` | Hvad webshoppen viser først: menu, forside, temasider (`/tema/…`), egne kategoritekster, hvilke kategorier forsiden og temasiderne holder sig fra, og hvilken sæson kategorisiderne viser først. |
| `src/config/company.ts` | Firmaet bag webshoppene (navn, CVR, adresse, telefon, åbningstider) og ejerens beslutninger til handelsbetingelserne. Fælles for alle webshops. |
| WooCommerce → **Produkter → Webshops** | Én webshop pr. frontend. **Slug = butiks-ID** (`NEXT_PUBLIC_STORE_ID`). |
| Produktet i WooCommerce | Boksen **Webshops**: kryds de webshops af, der sælger produktet. Et produkt kan være i flere. |
| Ordrer | Hver ordre får webshoppens ID (`_wchc_store_id`) og vises i kolonnen **Webshop** i ordrelisten. Stripe-betalingen får `metadata.store_id`. |

Reglerne håndhæves i WooCommerce (Headless Checkout Bridge 1.2):

- Webshoppen viser kun sine egne produkter, kategorier og produktsider. En kategori uden produkter i webshoppen vises ikke. Antallet pr. kategori tælles for hver webshop og opdateres hvert kvarter, så en ny kategori kan være op til 15 minutter om at dukke op.
- Kurv og kasse afviser et produkt, webshoppen ikke sælger ("Produktet sælges ikke i denne webshop."), også hvis nogen sender det direkte til API'et.
- Et butiks-ID, der **ikke** er oprettet som webshop i WooCommerce, sælger alle produkter, som før. En enkelt webshop kræver altså ingen opsætning.
- Et nyt produkt sælges ingen steder, før en webshop er krydset af.

Lageret er fælles: sælger begge webshops samme produkt, trækker de fra samme lager, og WooCommerces lagerreservation gælder på tværs af dem.

## De to webshops

| Webshop | Butiks-ID | DNA | Adresse |
| --- | --- | --- | --- |
| **Fastelavnskostumer.dk** | `piece-dk` | Fastelavn hele året: farverig og familievenlig, konfetti, logo med en kat i tønden, overskrifter i Fredoka. Forsiden tæller ned til fastelavnssøndag. | https://testshop-weld.vercel.app (Vercel-projekt `testshop`) |
| **Halloweenkostumer.dk** | `halloween-kostumer-dk` | Halloween hele året: mørk header og footer (sort, orange og lilla), lyse produkt-, kurv- og kassesider, logo med et lysende græskar, overskrifter i Bebas Neue. Forsiden tæller ned til 31. oktober. | https://testshop-maskerade.vercel.app (Vercel-projekt `testshop-maskerade`) |

Begge sælger hele Guircas sortiment. Det er fremhævningen, der er forskellig:

- **Menu og forside:** hver sin menu, hero, målgruppe-fliser, temaer ("Prinsesser og prinser", "Superhelte" … / "Hekse", "Zombier" …) og produktrækker.
- **Temasider** (`/tema/<slug>`) samler produkter fra kategorier og temaer (WooCommerce-tags), f.eks. "Halloweenkostumer til damer" = Damekostumer, der også ligger i Halloween.
- **Den anden sæson holdes væk** fra forsiden, temasiderne og produktsidernes anbefalinger: Fastelavnsshoppen viser ikke Halloween og jul dér (heller ikke tilbehør med f.eks. flagermus, kranier eller nisser), Halloweenshoppen ikke jul. Produkterne findes stadig i kategorierne og i søgningen.
- **Kategorisider og "Alle produkter"** viser med sorteringen "Anbefalet" shoppens sæson først og resten bagefter (Fastelavn: det, der ikke er Halloween eller jul; Halloween: Halloween først). Ingen varer skjules.
- **18+:** Guircas 37 varer til voksne ("Polterabend (18+)") sælges kun i Halloweenkostumer.dk. De vises med et 18+-mærke og kun i deres kategori og i søgningen, aldrig på forsiden, i anbefalinger eller under "Alle produkter".

Temasider med "også i" og sæsonsorteringen bruger plugin 1.4's kategorifiltre. Med en ældre plugin falder de tilbage til temaer (tags) og almindelig sortering.

### Søgemaskiner: hvert produkt har ét hjem

Begge webshops har de samme ~8.600 produktsider med samme navn, tekst og billeder. Uden hjælp vælger Google selv én kopi pr. produkt, og så kan et heksekostume ende med at rangere som en side på Fastelavnskostumer.dk. Derfor har hvert produkt én **hjemme-webshop** (`homeCategories` i `src/config/store.ts`, `src/lib/home-store.ts`):

- Produkter i **Halloween** (og dens underkategorier) og **18+**-varerne hører hjemme på Halloweenkostumer.dk. Alt andet, også jul, hører hjemme på Fastelavnskostumer.dk.
- Produktsiden peger i begge webshops på hjemme-webshoppens side som den kanoniske (`<link rel="canonical">` og adressen i produktets strukturerede data), og kun hjemme-webshoppens `sitemap.xml` har produktet med.
- En kategori, som en webshop holder ude af menuen og kategori-chipsene (`hidden` og `navHidden` i `merchandising.ts`), peger på kategorisiden i den webshop, der viser den: f.eks. `/kategori/halloween`, `/kategori/halloweenpynt` og `/kategori/blod-og-effekter` i Fastelavnsshoppen → `https://halloweenkostumer.dk/kategori/…`. Viser ingen af dem kategorien, hører den hjemme hos produkternes hjemme-webshop: `/kategori/jul-og-nytaar` og `/kategori/julepynt` i Halloweenshoppen → Fastelavnskostumer.dk. Den står kun i hjemme-webshoppens sitemap. Produkternes hjem ændres ikke af det.
- Produkterne kan stadig købes i begge webshops; det ændrer kun, hvilken side Google viser.

Den anden webshops adresse er `siteUrl` i `src/config/store.ts` (de rigtige domæner). Webshoppens egne sider bruger `NEXT_PUBLIC_SITE_URL`. Indtil domænerne er koblet på, peger kanoniske adresser altså på domæner, der endnu ikke svarer; kobl begge domæner på samtidig.

| Produkt | Fastelavnskostumer.dk | Halloweenkostumer.dk |
| --- | --- | --- |
| Guircas sortiment (8.569 varer, se [IMPORT-GUIRCA.md](IMPORT-GUIRCA.md)) | ✓ | ✓ |
| Guircas varer til 18+ (37 varer i "Polterabend (18+)") | | ✓ |

De fem testprodukter fra opsætningen og en tom kladde ligger i papirkurven i WooCommerce (15-10-2026).

## Ny webshop – trin for trin

1. **Brand:** Tilføj et brand under det nye butiks-ID i `src/config/store.ts` (navn, domæne (`siteUrl`), logo, tekster, farver, skrift, e-mail, sæson, og evt. de kategorier, hvis produkter hører hjemme her (`homeCategories`)). Farverne er designtokens fra `src/app/globals.css`. Tilføj webshoppens menu, forside og temaer i `src/config/merchandising.ts` (ellers bruges sæsonens).
2. **WooCommerce:** Opret webshoppen under **Produkter → Webshops** med butiks-ID'et som slug, og kryds den af på de produkter, den skal sælge. Det kan også gøres via API'et: `PUT /wp-json/wc-headless/v1/shops/{butiks-id}` med `{"name": "…"}` og `PUT /wp-json/wc/v3/products/{id}` med `{"webshops": ["…"]}`.
3. **Vercel:** **Add New → Project** → importér repoet. Sæt miljøvariablerne (se [DEPLOY.md](DEPLOY.md)) med webshoppens egne `NEXT_PUBLIC_STORE_ID`, `NEXT_PUBLIC_SITE_URL`, `STRIPE_WEBHOOK_SECRET` og `CRON_SECRET` (det daglige job trækker og frigiver webshoppens reserverede betalinger). WooCommerce- og Stripe-nøglerne kan være de samme som de andre webshops'.
4. **Stripe:** Opret et webhook-endpoint til `https://<domæne>/api/stripe/webhook` (samme fem hændelser som i [STRIPE.md](STRIPE.md#webhook-påkrævet)) og registrér domænet under **Payment method domains**, så Apple Pay virker. Hvert endpoint får alle kontoens betalinger, men frontend ignorerer betalinger fra andre webshops (`metadata.store_id`).
5. **Domæne:** Tilføj webshoppens domæne i Vercel-projektet, og registrér det også hos Stripe.

## E-mails

Fra plugin 1.4 viser WooCommerces ordre-e-mails den webshop, kunden handlede i: afsendernavn, svaradresse (webshoppens kundeservice), logo (`/email-logo.png`, genereret af hver frontend), farve og navn i emne og tekst. Frontenden sender sit brand med ordren (se [WOOCOMMERCE.md](WOOCOMMERCE.md) §11). Afsenderadressen er WordPress' egen.

## Begrænsninger

- Priser, moms, fragt og rabatkoder er fælles. Forskellige priser pr. webshop understøttes ikke.
