# Flere webshops på samme WooCommerce

Flere frontends (f.eks. piece.dk og halloween-kostumer.dk) deler **én WooCommerce**: samme produkter, lager, kunder og ordrer, samme Stripe-konto. Hver webshop har sit eget domæne, sit eget design og sin egen kasse, og sælger kun de produkter, den har fået tildelt.

## Sådan hænger det sammen

| Hvor | Hvad |
| --- | --- |
| Vercel | Ét projekt pr. webshop, alle fra samme GitHub-repo. Forskellen er miljøvariablerne, især `NEXT_PUBLIC_STORE_ID`. |
| `src/config/store.ts` | Webshoppens brand: navn, tekster og farver, valgt ud fra `NEXT_PUBLIC_STORE_ID`. |
| WooCommerce → **Produkter → Webshops** | Én webshop pr. frontend. **Slug = butiks-ID** (`NEXT_PUBLIC_STORE_ID`). |
| Produktet i WooCommerce | Boksen **Webshops**: kryds de webshops af, der sælger produktet. Et produkt kan være i flere. |
| Ordrer | Hver ordre får webshoppens ID (`_wchc_store_id`) og vises i kolonnen **Webshop** i ordrelisten. Stripe-betalingen får `metadata.store_id`. |

Reglerne håndhæves i WooCommerce (Headless Checkout Bridge 1.2):

- Webshoppen viser kun sine egne produkter, kategorier og produktsider. En kategori uden produkter i webshoppen vises ikke. Antallet pr. kategori tælles for hver webshop og opdateres hvert kvarter, så en ny kategori kan være op til 15 minutter om at dukke op.
- Kurv og kasse afviser et produkt, webshoppen ikke sælger ("Produktet sælges ikke i denne webshop."), også hvis nogen sender det direkte til API'et.
- Et butiks-ID, der **ikke** er oprettet som webshop i WooCommerce, sælger alle produkter, som før. En enkelt webshop kræver altså ingen opsætning.
- Et nyt produkt sælges ingen steder, før en webshop er krydset af.

Lageret er fælles: sælger begge webshops samme produkt, trækker de fra samme lager, og WooCommerces lagerreservation gælder på tværs af dem.

## Testopsætningen

| Webshop | Butiks-ID | Brand | Adresse |
| --- | --- | --- | --- |
| piece.dk (test) | `piece-dk` | Hverdag | https://testshop-weld.vercel.app (Vercel-projekt `testshop`) |
| halloween-kostumer.dk (test) | `halloween-kostumer-dk` | Maskerade | https://testshop-maskerade.vercel.app (Vercel-projekt `testshop-maskerade`) |

| Produkt | Hverdag | Maskerade |
| --- | --- | --- |
| Guircas sortiment (8.569 varer, se [IMPORT-GUIRCA.md](IMPORT-GUIRCA.md)) | ✓ | ✓ |
| Guircas varer til 18+ (37 varer i "Polterabend (18+)") | | |

De fem testprodukter fra opsætningen og en tom kladde ligger i papirkurven i WooCommerce (15-10-2026).

## Ny webshop – trin for trin

1. **Brand:** Tilføj et brand under det nye butiks-ID i `src/config/store.ts` (navn, tekster, farver). Farverne er designtokens fra `src/app/globals.css`.
2. **WooCommerce:** Opret webshoppen under **Produkter → Webshops** med butiks-ID'et som slug, og kryds den af på de produkter, den skal sælge. Det kan også gøres via API'et: `PUT /wp-json/wc-headless/v1/shops/{butiks-id}` med `{"name": "…"}` og `PUT /wp-json/wc/v3/products/{id}` med `{"webshops": ["…"]}`.
3. **Vercel:** **Add New → Project** → importér repoet. Sæt miljøvariablerne (se [DEPLOY.md](DEPLOY.md)) med webshoppens egne `NEXT_PUBLIC_STORE_ID`, `NEXT_PUBLIC_SITE_URL` og `STRIPE_WEBHOOK_SECRET`. WooCommerce- og Stripe-nøglerne kan være de samme som de andre webshops'.
4. **Stripe:** Opret et webhook-endpoint til `https://<domæne>/api/stripe/webhook` (samme fire hændelser som i [STRIPE.md](STRIPE.md)) og registrér domænet under **Payment method domains**, så Apple Pay virker. Hvert endpoint får alle kontoens betalinger, men frontend ignorerer betalinger fra andre webshops (`metadata.store_id`).
5. **Domæne:** Tilføj webshoppens domæne i Vercel-projektet, og registrér det også hos Stripe.

## Begrænsninger

- WooCommerces e-mails (ordrebekræftelse osv.) kommer fra WordPress og har samme afsender og design for alle webshops.
- Priser, moms, fragt og rabatkoder er fælles. Forskellige priser pr. webshop understøttes ikke.
