# Test

## Automatiserede tests

```bash
npm test                                   # unit-tests (ingen eksterne afhængigheder)
python3 -m unittest discover -s scripts/guirca   # importreglerne for Guircas produktark
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

Integrationstestene kalder den rigtige WooCommerce via pluginet. Stripe erstattes af en in-memory-fake med samme kontrakt (idempotency keys, annullering, beløbsopdatering, reservation og træk, afvist træk, udløbet reservation og refundering). Til reservation og træk ved afsendelse (`capture-at-shipment.test.ts`) melder WordPress sendte og annullerede ordrer over HTTP til en server i testprocessen (`host.docker.internal`, port `SETTLE_TEST_PORT`, standard 3234), som kører shoppens rigtige `/api/payments/settle`. Den lokale testbutik gemmer mails i stedet for at sende dem (`scripts/local-woocommerce/local-test-hooks.php`), så testene kan tælle dem. Stripe-signaturverifikation testes med Stripe SDK'ets egen signaturgenerator. CI (`.github/workflows/ci.yml`) kører lint, typecheck, unit-tests (også importreglerne), build og integrationstestene (begge ordrelagre) ved hvert push.

## Testresultater

Kørt 14.–16. oktober 2026 i udviklingsmiljøet. **Bestået** betyder, at testen faktisk er kørt og bestået.

| Krav | Hvordan | Resultat |
| --- | --- | --- |
| **Produkter** hentes korrekt | Integration (quote) + browsertest (Playwright) mod lokal WooCommerce | Bestået |
| Priser matcher WooCommerce (inkl. tilbudspris) | Integration | Bestået |
| Lagerstatus matcher WooCommerce | Integration + browsertest (udsolgt størrelse overstreget, "Kun 2 tilbage") | Bestået |
| **Kurv**: tilføj, ændr antal, fjern, varianter, gem mellem besøg, maks. = lager | Unit (reducer/persistens) + browsertest (Playwright) | Bestået |
| **Checkout**: adressevalidering, fragtvalg, total fra WooCommerce på Betal-knappen | Unit (Zod) + browsertest (Playwright) | Bestået |
| Moms og fragt beregnes korrekt (25 %, fragt momspligtig, gratis fragt-grænse, "Fri fragt fra" på fast sats: ved beløbet, under det og efter rabat, også på ordren og betalingen) | Integration | Bestået |
| **Ordre** oprettes i WooCommerce (pending, butiks-ID, lagerreservation) | Integration | Bestået |
| Betaling registreres, ordrestatus "processing", transaktions-ID | Integration (fake Stripe) | Bestået |
| **Reservation** (plugin 1.5): PaymentIntent med `capture_method: manual`; bekræftelsessiden og to webhooks samtidig → én "authorized", ordren *Afventer* uden transaktions-ID og betalingsdato, betalingsmetoden gemt, lageret trukket én gang, noten én gang, kundens *Afventer*-mail (med "reserveret … trækkes først, når vi sender" og fortrydelsesretten) og *Ny ordre* én gang hver | Integration (`capture-at-shipment.test.ts`), begge ordrelagre, 16-10-2026 | Bestået |
| **Træk ved afsendelse**: ordren markeres *Gennemført* (to gange samtidig) → WordPress kalder shoppen → ét træk → transaktions-ID, betalingsdato, "Betalingen er trukket"; gentaget callback, webhook for trækket, *Gennemført* igen og det daglige job trækker ikke igen; efter en refundering trækkes kun resten | Integration, begge ordrelagre | Bestået |
| Callback uden gyldigt token (forfalsket, en anden ordres, den anden webshops, mangler) afvises (401/400), intet trækkes | Integration + unit (`settle.test.ts`, route-test) | Bestået |
| Annulleret før afsendelse: reservationen frigives, WooCommerce lægger varerne på lager igen, gentaget webhook noteres ikke igen | Integration, begge ordrelagre | Bestået |
| Afvist træk: ordren tilbage til *Afventer*, note, mail til butikken; *Gennemført* igen giver et nyt forsøg (ny idempotency key), som lykkes | Integration + unit | Bestået |
| Udløbet reservation: note og mail én gang, ordren venter; sendes den alligevel, trækkes intet, og ordren går tilbage til *Afventer* | Integration + unit | Bestået |
| Dagligt job (`/api/cron/settle-payments`, `POST /payments/sweep`): trækker *Gennemført* og frigiver annullerede ordrer, som WordPress ikke kunne melde (shoppen svarede 404), advarer én gang om reservationer ældre end 5 dage (note og én mail), kræver `CRON_SECRET` | Integration + unit | Bestået |
| Ordre betalt før reservationen (trukket med det samme) markeres *Gennemført*: ingen callback, intet træk, ingen ændring | Integration, begge ordrelagre | Bestået |
| Plugin før 1.5 (kender ikke "authorized"): shoppen trækker beløbet med det samme som før | Unit (`service.test.ts`) | Bestået |
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
| Kategorifiltre: `wchc_in_category` giver kun produkter i alle kategorierne, `wchc_not_in_category` udelader produkter i en af dem, `wchc_in_any_category` giver produkter i mindst én (alle også via underkategori), alene og sammen med `category`, `tag` og webshop; "sæson først" + "resten" giver hele kategorien præcis én gang; ikke-numeriske ID'er ignoreres | Integration (`webshops.test.ts`) | Bestået |
| Antal pr. kategori pr. webshop i ét kald (`category-counts`): samme tal som REST-filteret `category`, underkategorier medregnet, også for et butiks-ID uden webshop; tælles igen efter papirkurv, gendannelse, planlagt udgivelse (`wp_publish_post`) og ny eller slettet webshop; en optælling, som en ændring overlappede, gemmes ikke | Integration (`webshops.test.ts`) | Bestået |
| Sæson først på kategorisider: rigtig rækkefølge og sideinddeling over grænsen mellem de to dele, almindelig liste ved anden sortering, i sæsonens egne kategorier og med ældre plugin | Unit (`collections.test.ts`) | Bestået |
| Filtre på produktlister: størrelser grupperet (børn efter alder, voksne efter bogstav, sko), prisintervaller, filtrene i URL'en og tilbage i links; kun størrelser og priser, listen har (mindst 3 varer), alle når Store API ikke svarer; filtrene sendt til WooCommerce som `attribute`/`attribute_term`, `min_price`/`max_price` og `stock_status` | Unit (`listing-filters.test.ts`, `filters.test.ts`, `products.test.ts`) + browsertest mod test.piece.dk (Playwright, 390 og 1440 px) | Bestået |
| Datoer: påske, fastelavn (7. februar 2027), halloween, nedtælling, danske helligdage, sommer- og vintertid; afsendelsesnedtælling kun på hverdage før kl. 19 | Unit (`seasons.test.ts`, `delivery.test.ts`) | Bestået |
| Favoritter, søgeforslag (navnetræf først, kategorier og temaer), informationssidernes tekster (kun kendte felter, links til sider der findes, ingen glemte [klammer]) og merchandising (alle links til temasider findes) | Unit | Bestået |
| **Ordremails pr. webshop**: ordren gemmer webshoppens brand, og ugyldige felter droppes; kundens mail har webshoppens afsendernavn, Svar til, emne, overskrift, sidefod, logo og farve; *Ny ordre* nævner webshoppen og har stadig kunden som Svar til; `{store_email}` er webshoppens e-mail; kundens *Behandler* og *Afventer* (HTML og ren tekst) har fortrydelsesretten, returadresse, returfragt, sælger og hele standardfortrydelsesformularen (samme ordlyd som siden), *Ny ordre* har dem ikke, og manglende felter udelades; en ordre uden brand får mails som før, også lige efter en med | Integration (`checkout-flow.test.ts`, mails fanget med `pre_wp_mail`) | Bestået |
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

### Guirca-import 15-10-2026

Guircas ark `5_PRODUCTS_INFORMATIONS_1.xlsx`: 12.642 rækker i to faner (GUIRCA 11.203, GUIRMA 1.439), heraf 20 varenumre i begge, så 12.622 varer. Importeret med `scripts/guirca/import_guirca.py` (se [IMPORT-GUIRCA.md](IMPORT-GUIRCA.md)).

| Trin | Resultat |
| --- | --- |
| Rapport | 8.623 produkter: 2.283 med størrelser (6.274 størrelser) og 6.340 uden. Sprunget over: 5 butiksdisplays og 3 rækker uden navn. 17 kladder på grund af prisfejl i arket. 37 varer er kun 18+ og har ingen webshop. |
| Billedtjek | 59.037 billedlinks, 1.528 døde (404) udeladt. 2 varer har ingen billeder. |
| Pilot | 100 varer fordelt over kategorierne, uden webshop: oprettet på 12 sekunder uden fejl. Variant- og simpelt produkt tjekket via REST, siderne tjekket i browseren. |
| Fuld import | 8.511 oprettet og 103 opdateret (pilotvarerne og de 4 testvarer) på 13,7 minutter. Én forespørgsel blev afbrudt af netværket. Dens 9 varer blev meldt "ikke gemt", men WooCommerce gemte dem alligevel. Importen venter nu, før den tjekker. |
| Genkørsel | 0 oprettet, 0 opdateret, 8.623 uændrede. Ingen dubletter, og alle varer med størrelser har alle størrelser. |
| WooCommerce bagefter | 8.629 produkter (8.611 udgivet, 18 kladder), 2.284 variable. Maskerade sælger 8.573 varer, Hverdag stadig 3. |
| Maskerade (preview af `ed1538f`) | "Alle produkter" viser 8.573 varer på 358 sider. Kostumer har 1.939 varer og 6 underkategorier, Pigekostumer 477 og Halloween 2.437. Søgning på "heks" giver 137 varer. Produktsiden har størrelser, brødkrummer, størrelsesguide og link til sikkerhedsmærkaten. Ingen JavaScript-fejl og ingen vandret scroll på mobil og desktop. |

En build lavet midt under importen viste den gamle menu, indtil kategoricachen blev fornyet (højst 15 minutter). Brug derfor en build fra efter importen.

### Fragt og fri fragt 15-10-2026 (plugin 1.3)

Zonen "Danmark" på test.piece.dk, i kassens rækkefølge: PostNord, GLS og DAO "– nærmeste pakkeshop" til 39 kr. med fri fragt fra 599 kr., DAO til Døren 49 kr. og GLS til Døren 59 kr. (alle inkl. moms).

| Tjek (quote via pluginet og live-kassen i Maskerade) | Resultat |
| --- | --- |
| 1 hekseparyk (89 kr.) | Pakkeshop 39 kr., PostNord valgt, i alt 128 kr. |
| 7 hekseparykker (623 kr.) | Pakkeshop "Gratis", til døren 49/59 kr., i alt 623 kr. Det samme i live-kassen: Levering "Gratis". Ingen JavaScript-fejl. |
| 7 hekseparykker med `TEST10` (560,70 kr.) | Under 599 kr. efter rabat, så pakkeshop koster 39 kr. igen, i alt 599,70 kr. |
| WooCommerces REST API for fragtmetoderne | Med plugin 1.3.0 skrev REST API'et PHP-advarslen "Undefined array key wchc_free_from" ind i JSON-svaret, fordi metoderne var gemt før feltet fandtes. Rettet på test.piece.dk ved at gemme feltet på alle fem metoder. Plugin 1.3.1 gør det selv for gamle fragtmetoder. |

### Produktkort, produktside og begge webshops 15-10-2026

Testprodukterne fra opsætningen ligger i papirkurven, og alle Guirca-varer (undtagen de 37 til 18+) sælges nu af begge webshops: 8.569 varer i Hverdag og 8.569 i Maskerade. En prøvekørsel af importen bagefter planlagde 0 ændringer.

Browsertest (Playwright) mod en lokal build af Maskerade på test.piece.dk:

| Tjek | Resultat |
| --- | --- |
| Kategoriside, computer (1440 px) | 5 kort pr. række og 30 varer pr. side. Kortene har rabat- og videomærke, antal størrelser, stor pris og "På lager". |
| Kategori- og produktside, mobil (390 px) | 2 kort pr. række og ingen vandret scroll. |
| Relevant tilbehør (nonnekostume) | Korsvedhæng, glorie, præstehue, englevinger, ansigtsglimmer, korstatovering og hyrdestav. Lignende produkter: andre nonnekostumer. |
| Relevant tilbehør (enhjørningekostume til piger) | Enhjørningesæt til børn, hårextension med enhjørning, enhjørningebriller og skelettilbehør |
| Størrelser | Børnekostumer viser højden under størrelsen (3-4 år · 109 cm …), og linket til størrelsesguiden står over knapperne. |
| Købsbjælke på mobil | Skjult ved start og vises, når man har scrollet forbi knappen. Uden valgt størrelse ruller den op og viser "Vælg størrelse først." |
| Kurv | "Køb for 460,00 kr. mere, så får du fri fragt til pakkeshop" med bjælke ved 139 kr. i kurven. Beløbet læses fra WooCommerce (599 kr.). |
| Løfter | Baren øverst, rækken over footeren og 2 × 2-boksen på produktsiden viser "599 kr." fra WooCommerce. |
| JavaScript-fejl | Ingen |

### Fastelavnskostumer.dk og Halloweenkostumer.dk 15-10-2026

Browsertest (Playwright) mod lokale builds af begge webshops på test.piece.dk (plugin 1.3.1 live; 1.4 testet lokalt):

| Tjek | Resultat |
| --- | --- |
| Forside, Fastelavn (1440 px og 390 px) | Konfettistribe, logo med kat i tønden, "Fastelavn er søndag 7. februar · om 115 dage", hero med tre kostumefotos, målgruppe-fliser, 8 temaer og 4 rækker uden halloween- og julevarer og uden gentagelser. Ingen vandret scroll. |
| Forside, Halloween (1440 px og 390 px) | Mørk header og footer, græskarlogo, "Halloween er lørdag 31. oktober · om 16 dage", nattehimmel med måne og flagermus, temaerne Hekse … Horror-klovne, "Pynt huset" uden julepynt. |
| Menu | Dropdown åbner ved hover og klik, Esc lukker. Mobilmenuen åbner, foldes ud og lukker, når et link vælges (→ /kategori/pigekostumer). |
| Søgeforslag ("prinsesse") | Temaet "Prinsesser og prinser" øverst, derefter 6 produkter med foto og pris. Pil ned + Enter åbner det valgte produkt. |
| Favoritter | Hjertet på produktsiden gemmer varen, headeren viser "Favoritter, 1", og /favoritter viser varen med frisk pris. |
| Sortering | "Pris: lav til høj" på Pigekostumer giver 49, 59, 59, 59 kr. først. |
| Produktside → kurv → kasse (mobil) | Hjerte ved "Læg i kurv", afsendelseslinjen, kurvskuffe med "Køb for 550,00 kr. mere …" og afsendelseslinjen, kassen med webshoppens logo. Ingen JavaScript-fejl. |
| Informationssider | Handelsbetingelser m.fl. med webshoppens navn og e-mail; firmaoplysninger, der mangler, er fremhævet med gult. |
| Favicon, hjemmeskærmsikon, delingsbillede, e-mail-logo | Genereret pr. webshop (200, image/png). |
| `sitemap.xml` / `robots.txt` | 8.643 adresser i Fastelavn-shoppen / kurv, kasse, søgning, favoritter og API er udelukket. |
| 18+ | 37 varer i Halloweenkostumer.dk (8.606 i alt), 0 i Fastelavnskostumer.dk (8.569). |
| Billeder | Ølflaske – kostume til herrer: 3 fotos (86865, _01, _02), før 1. 80'er-kasket (kode med mellemrum i arket): 5, før 0. |

## Manuel testplan (rigtig Stripe + test.piece.dk)

Forudsætninger: pluginet er installeret, `.env.local` er udfyldt, og `stripe listen` kører, eller webhooken er oprettet i Stripe.

1. **Status:** `curl -u KEY:SECRET https://test.piece.dk/wp-json/wc-headless/v1/status` skal returnere plugin-version og `"currency":"DKK"`.
2. **Produkter:** Forsiden viser produkter. Priser og lager matcher WooCommerce-admin.
3. **Kurv:** Læg to varer i kurven, ændr antal, fjern én, og genindlæs siden. Kurven skal være bevaret.
4. **Checkout:** Indtast et ugyldigt postnummer (fejl skal vises), og ret det. Fragtmetoder og moms vises.
5. **Betaling OK:** Betal med `4242 4242 4242 4242`. Du skal lande på bekræftelsessiden med "Tak for din ordre" og "Vi har reserveret … Beløbet trækkes først, når vi sender din ordre". Ordren i WooCommerce skal stå som *Afventer* med noten "Betalingen er reserveret og trækkes, når ordren sendes", lageret skal være faldet med det købte antal, og betalingen står som *Uncaptured* i Stripe.
5a. **Afsendelse:** Markér ordren *Gennemført*. Inden for få sekunder: noten "Betalingen er trukket", transaktions-ID `pi_…`, og betalingen står som *Succeeded* i Stripe. Markér den *Gennemført* igen: intet nyt træk.
5b. **Annullering:** Betal en ny ordre, og sæt den til *Annulleret*. Noten "Reservationen … er frigivet", betalingen står som *Canceled* i Stripe, og lageret er lagt tilbage.
5c. **Dagligt job:** `curl -H "Authorization: Bearer $CRON_SECRET" https://<webshop>/api/cron/settle-payments` svarer med tal (fx `"listed":0`).
6. **3-D Secure:** `4000 0025 0000 3155` → godkend → reserveret.
7. **Afvist:** `4000 0000 0000 9995` → fejlbesked i checkout. Ordren skal stadig være *Afventer betaling* med en note. Betal derefter med 4242 → reserveret.
8. **Dobbeltklik:** Klik hurtigt flere gange på Betal. Der må kun være én ordre og én betaling i Stripe.
9. **Pris ændres:** Åbn checkout, ret prisen i WooCommerce, og tryk Betal. Du skal se beskeden "Prisen er ændret …" og den nye total.
10. **Udsolgt:** Sæt lager til 0 i WooCommerce, mens varen ligger i kurven. Kurv og checkout skal vise "udsolgt", og Betal skal være spærret.
11. **Gentagen webhook:** I Stripe Dashboard → Webhooks → event → **Resend**. Ordrenoter og lager må ikke ændre sig.
12. **Rabatkode:** Opret en kupon (Marketing → Kuponer, f.eks. 10 %). Indtast en forkert kode i kassen: der skal stå en begrundelse. Indtast den rigtige: rabatten vises i oversigten og på Betal-knappen. Betal. Ordren skal have kuponen og den rabatterede total, og Stripe skal have trukket samme beløb.
13. **Betalingsmetode:** Betal med MobilePay. Ordren skal vise "MobilePay (Stripe)" som betalingsmetode.
14. **Oprydning:** `/status` viser `unpaid_orders.last_cleanup`. En ubetalt ordre skal være annulleret senest et kvarter efter "Hold lager"-tiden.
