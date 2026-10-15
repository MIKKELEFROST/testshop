# Test

## Automatiserede tests

```bash
npm test                                   # unit-tests (ingen eksterne afhængigheder)
./scripts/local-woocommerce/setup.sh       # starter WordPress 7.1 + WooCommerce 11.1.2 + plugin i Docker
npm run test:integration                   # hele ordre-/betalingsflowet mod den rigtige WooCommerce
WC_HPOS=yes ./scripts/local-woocommerce/setup.sh && npm run test:integration   # samme med HPOS-ordrelager
```

Den lokale testbutik har dansk moms (25 %, priser inkl. moms), en fragtzone "Danmark" (GLS 49 kr., gratis fragt fra 500 kr., afhentning) og fem testprodukter:

| SKU | Produkt | Pris | Lager |
| --- | --- | --- | --- |
| TS-001 | Basis T-shirt | 249 | 25 |
| HUE-001 | Uldhue | 199 → tilbud 149 | 10 |
| TOTE-001 | Lærredsmulepose | 129 | **1** (sidste vare) |
| LYS-001 | Duftlys | 179 | **0** (udsolgt) |
| HOOD | Hættetrøje (S/M/L) | 449 | 5 / 2 / 0 |

Integrationstestene kalder den rigtige WooCommerce via pluginet. Stripe erstattes af en in-memory-fake med samme kontrakt (idempotency keys, annullering, beløbsopdatering og refundering). Stripe-signaturverifikation testes med Stripe SDK'ets egen signaturgenerator. CI (`.github/workflows/ci.yml`) kører lint, typecheck, unit-tests, build og integrationstestene (begge ordrelagre) ved hvert push.

## Testresultater

Kørt 14.–15. oktober 2026 i udviklingsmiljøet. **Bestået** betyder, at testen faktisk er kørt og bestået.

| Krav | Hvordan | Resultat |
| --- | --- | --- |
| **Produkter** hentes korrekt | Integration (quote) + browsertest (Playwright) mod lokal WooCommerce | Bestået |
| Priser matcher WooCommerce (inkl. tilbudspris) | Integration | Bestået |
| Lagerstatus matcher WooCommerce | Integration + browsertest (udsolgt størrelse overstreget, "Kun 2 tilbage") | Bestået |
| **Kurv**: tilføj, ændr antal, fjern, varianter, gem mellem besøg, maks. = lager | Unit (reducer/persistens) + browsertest (Playwright) | Bestået |
| **Checkout**: adressevalidering, fragtvalg, total fra WooCommerce på Betal-knappen | Unit (Zod) + browsertest (Playwright) | Bestået |
| Moms og fragt beregnes korrekt (25 %, fragt momspligtig, gratis fragt-grænse) | Integration | Bestået |
| **Ordre** oprettes i WooCommerce (pending, butiks-ID, lagerreservation) | Integration | Bestået |
| Betaling registreres, ordrestatus "processing", transaktions-ID | Integration (fake Stripe) | Bestået |
| Lageret trækkes præcis én gang | Integration | Bestået |
| Afvist betaling | Integration: ordren forbliver betalbar, ny betaling lykkes | Bestået |
| Afbrudt/annulleret betaling | Integration: ordren annulleres, reservationen frigives | Bestået |
| Gentagen webhook (3 samtidige) | Integration: én "paid", to "already_paid", ét lagertræk, `payment_complete` (og dermed ordremails) kun én gang | Bestået |
| Dobbeltklik på Betal (3 samtidige requests) | Integration: én ordre, én PaymentIntent | Bestået |
| Produkt udsolgt under checkout | Integration: ingen ordre, ingen betaling | Bestået |
| Samtidige køb af sidste vare (4 købere) | Integration: præcis én får varen | Bestået |
| Ændret pris under checkout | Integration: `total_changed`, kunden skal bekræfte den nye total | Bestået |
| WooCommerce utilgængelig | Integration: retryable fejl, ingen betaling, webhook svarer 500 | Bestået |
| Forkert beløb / forkert ordrenøgle / anden butik | Integration | Bestået |
| Betaling efter udløbet reservation, varen solgt | Integration: automatisk refundering, intet oversalg | Bestået |
| Ugyldig/forfalsket webhook-signatur | Unit (rigtig Stripe-signaturverifikation) | Bestået |
| **Rabatkoder**: rabatten i quote, ordre og betaling; ukendt kode og minimumsbeløb afvises med WooCommerces begrundelse; kode begrænset til bestemte e-mails | Integration + browsertest (Playwright, mobil og desktop) + rigtigt køb 15-10-2026 | **Bestået** |
| Rabatkode med brugsgrænse: kunden kan prøve igen efter afvist betaling, andre kan ikke bruge koden imens, forbrug tælles én gang | Integration | Bestået |
| Ubetalt ordre ældre end "Hold lager" genoptages ikke: ny ordre, den gamle og dens PaymentIntent annulleres | Integration | Bestået |
| Pluginet annullerer forladte ubetalte ordrer og frigiver lageret; nye ordrer røres ikke | Integration | Bestået |
| Ordren viser den brugte betalingsmetode (MobilePay, Apple Pay) | Integration | Bestået |
| Afvist betalingsforsøg noteres én gang, selv om det meldes flere gange | Integration | Bestået |
| **Webshops**: hver webshop viser kun sine produkter (også produktsider via slug); delte produkter i begge; quote og ordre afviser andre webshops' produkter; ukendt butiks-ID sælger alt; ordren får webshoppens ID | Integration (`webshops.test.ts`) + browsertest af begge brands mod lokal WooCommerce | Bestået |
| Webshops i WordPress-admin: boks på produktet, kolonne i produktlisten, masseredigering, kolonnen "Webshop" i ordrelisten (HPOS og klassisk) | Browsertest (Playwright) mod lokal WooCommerce | Bestået |
| **Rigtig Stripe-testbetaling** (kort 4242, Vercel-produktion → test.piece.dk) | Manuelt 14-10-2026, se nedenfor | **Bestået** |
| Rigtig 3-D Secure- og afvist-betaling (kort 3155 og 9995) | Manuelt 14-10-2026, se nedenfor | **Bestået** |
| **Forbindelse til test.piece.dk** (WooCommerce 11.2.1, HPOS) | Manuelt | **Bestået** |

Alt andet er kørt mod en rigtig WooCommerce 11.1.2 lokalt.

### Rigtigt testkøb 14-10-2026

Købt på `https://testshop-weld.vercel.app` med kort 4242. Tjekket i Vercels request-statistik og via WooCommerce REST API:

- Ordre #23 (1 × Superheltekappe, 179 kr.): PaymentIntent tilknyttet, noten "Betaling gennemført via Stripe", status *Behandler* (senere sat manuelt til *Gennemført*), transaktions-ID `pi_…`.
- Lageret faldt én gang (12 → 11). "Behandler ordre" og "Ny ordre" blev sendt én gang hver.
- `/api/checkout` 200, `/api/stripe/webhook` 200 (signatur verificeret), `/ordre/bekraeftelse` 200.
- De første forsøg fejlede med `503`, fordi `STRIPE_SECRET_KEY` i Vercel indeholdt et ugyldigt tegn (`Invalid character in header content ["Authorization"]`). Det blev rettet ved at indsætte nøglen igen. Miljøvariabler trimmes nu, og loggen viser den underliggende årsag.
- Ordre #21 (715 kr.) og #22 (179 kr.) blev oprettet under de fejlede forsøg og står som *Afventer betaling*. Der blev ikke trukket penge for dem. #22 og #23 har hver sit checkout-ID, så kurven blev betalt i en ny browsersession (for eksempel et nyt inkognitovindue). En ny session giver altid en ny ordre.
- **3-D Secure** (`4000 0025 0000 3155`), ordre #28: godkendt i Stripes dialog og betalt 9 sekunder efter oprettelsen. Lageret faldt én gang (11 → 10), og mails blev sendt én gang.
- **Afvist kort** (`4000 0000 0000 9995`), ordre #29: noten "Betalingsforsøg afvist: card_declined". Ordren står fortsat som *Afventer betaling* med sin PaymentIntent, så kunden kan prøve igen med et andet kort. Lageret er ikke trukket.
- **Afvist kort og derefter betalt**, ordre #30: kortet blev afvist kl. 21:38:59 og samme ordre blev betalt kl. 21:39:22 med samme PaymentIntent (ingen ny ordre, ingen ny PaymentIntent). Lageret faldt én gang (10 → 7).
- **Dobbeltklik på Betal**, ordre #31: én ordre, én PaymentIntent, ét lagertræk (20 → 18). Vercel modtog kun én `POST /api/checkout`, så knappen stoppede de ekstra klik allerede i browseren. Idempotensen på serveren er dækket af integrationstesten.
- **Prisændring under checkout**, ordre #32: prisen blev ændret fra 99 til 119 kr. i WooCommerce, mens kassen var åben. Ordren og betalingen blev på 119 kr. Kassen hentede den nye pris, før der blev trykket Betal, så `total_changed` (409) blev ikke udløst i denne test. Den gren er dækket af integrationstesten.
- Klarna og Amazon Pay er slået fra i Stripe, så kun kort tilbydes.
- **Åbent punkt:** Confirmation-siden loggede to gange `WooCommerce is unreachable` (18:28 og 21:01 dansk tid). Der var ingen konsekvens for ordrerne. Loggen viser nu den underliggende netværksfejl, så årsagen kan findes, hvis det sker igen.
- WooCommerce annullerede først den ubetalte ordre #29 næste morgen kl. 07:38, cirka 12½ time efter fristen på 60 minutter, fordi WooCommerces oprydning kun kører, når siden får besøg. Plugin 1.1 rydder selv op og er installeret (se nedenfor).
- MobilePay-købet (#22) genbrugte en ubetalt ordre fra tidligere på dagen og fik derfor dens nummer og dato. Plugin 1.1 opretter en ny ordre i stedet, når den gamle er ældre end "Hold lager"-tiden.

### Rigtigt testkøb 15-10-2026 (plugin 1.1)

Plugin 1.1.0 er installeret på test.piece.dk, og shoppen kører commit `d61c8a5` i produktion. Tjekket via WooCommerce REST API og Stripe API:

- `/status` viser version 1.1.0 og rabatkoder slået til. Oprydningen af ubetalte ordrer kørte første gang kl. 11:13 og er planlagt hvert kvarter.
- En ukendt kode afvises med WooCommerces danske tekst: *Kupon "…" kan ikke anvendes, fordi den ikke findes.*
- Ordre #42 med kuponen `TEST10` (10 %): Piratkostume 299 kr. + Superheltekappe 179 kr. − rabat 47,80 kr. + DAO til Døren 49 kr. = **479,20 kr.** (heraf moms 95,84 kr.). Stripe trak præcis 479,20 kr.
- Ordren viser betalingsmetoden "Visa-kort (Stripe)" i stedet for den faste tekst fra før.
- Lageret faldt én gang (Piratkostume 10 → 9, Superheltekappe 6 → 5). "Behandler ordre" og "Ny ordre" blev sendt én gang hver.
- Kuponen er talt som brugt én gang og registreret på kundens e-mail.

### To webshops live 15-10-2026 (plugin 1.2)

Plugin 1.2.0 på test.piece.dk. Webshops oprettet: `piece-dk` (Hverdag, https://testshop-weld.vercel.app) og `halloween-kostumer-dk` (Maskerade, https://testshop-maskerade.vercel.app). Fordeling: Piratkostume og Superheltekappe i begge, Prinsessekostume kun i Hverdag, Halloweenmaske og Heksehat kun i Maskerade.

| Tjek | Resultat |
| --- | --- |
| Hverdag viser Pirat, Prinsesse, Superhelt og kun kategorien Kostumer | Bestået |
| Maskerade viser Pirat, Superhelt, Halloweenmaske, Heksehat og kategorierne Kostumer (2) og Tilbehør (2) | Bestået |
| Produktside for en vare fra den anden webshop giver "ikke fundet" (begge veje) | Bestået |
| Kassen i Hverdag afviser Heksehat, og Maskerade afviser Prinsessekostume ("Produktet sælges ikke i denne webshop.") | Bestået |
| Delt vare (Piratkostume) kan købes i begge: quote 348,00 kr. inkl. DAO-fragt i Maskerade | Bestået |
| Maskeradens domæne registreret til Apple Pay/Google Pay i Stripe (test), eget webhook-endpoint | Gjort |

## Manuel testplan (rigtig Stripe + test.piece.dk)

Forudsætninger: pluginet er installeret, `.env.local` er udfyldt, og `stripe listen` kører, eller webhooken er oprettet i Stripe.

1. **Status:** `curl -u KEY:SECRET https://test.piece.dk/wp-json/wc-headless/v1/status` skal returnere plugin-version og `"currency":"DKK"`.
2. **Produkter:** Forsiden viser produkter. Priser og lager matcher WooCommerce-admin.
3. **Kurv:** Læg to varer i kurven, ændr antal, fjern én, og genindlæs siden. Kurven skal være bevaret.
4. **Checkout:** Indtast et ugyldigt postnummer (fejl skal vises), og ret det. Fragtmetoder og moms vises.
5. **Betaling OK:** Betal med `4242 4242 4242 4242`. Du skal lande på bekræftelsessiden med "Tak for din ordre". Ordren i WooCommerce skal stå som *Behandler* med transaktions-ID `pi_…`, og lageret skal være faldet med det købte antal.
6. **3-D Secure:** `4000 0025 0000 3155` → godkend → betalt.
7. **Afvist:** `4000 0000 0000 9995` → fejlbesked i checkout. Ordren skal stadig være *Afventer betaling* med en note. Betal derefter med 4242 → betalt.
8. **Dobbeltklik:** Klik hurtigt flere gange på Betal. Der må kun være én ordre og én betaling i Stripe.
9. **Pris ændres:** Åbn checkout, ret prisen i WooCommerce, og tryk Betal. Du skal se beskeden "Prisen er ændret …" og den nye total.
10. **Udsolgt:** Sæt lager til 0 i WooCommerce, mens varen ligger i kurven. Kurv og checkout skal vise "udsolgt", og Betal skal være spærret.
11. **Gentagen webhook:** I Stripe Dashboard → Webhooks → event → **Resend**. Ordrenoter og lager må ikke ændre sig.
12. **Rabatkode:** Opret en kupon (Marketing → Kuponer, f.eks. 10 %). Indtast en forkert kode i kassen: der skal stå en begrundelse. Indtast den rigtige: rabatten vises i oversigten og på Betal-knappen. Betal. Ordren skal have kuponen og den rabatterede total, og Stripe skal have trukket samme beløb.
13. **Betalingsmetode:** Betal med MobilePay. Ordren skal vise "MobilePay (Stripe)" som betalingsmetode.
14. **Oprydning:** `/status` viser `unpaid_orders.last_cleanup`. En ubetalt ordre skal være annulleret senest et kvarter efter "Hold lager"-tiden.
