# Arkitektur

```
 Browser ──► Next.js (Vercel) ──────────────► WooCommerce (WordPress)
   │           │  Server Components             • REST API v3: produkter, kategorier
   │           │  /api/checkout/quote ─────────► • wc-headless/v1 (pluginet):
   │           │  /api/checkout ───────────────►     quote, ordrer, betalingsstatus
   │           │  /api/stripe/webhook ─────────►
   │           │  /api/payments/settle ◄──────── ordren er sendt / annulleret (træk / frigiv)
   │           │  /api/cron/settle-payments ───► dagligt sikkerhedsnet (Vercel Cron)
   │           ▼
   └──► Stripe.js (Payment Element) ◄──► Stripe ──webhook──► /api/stripe/webhook
```

## Ansvarsfordeling

| | Autoritativ kilde |
| --- | --- |
| Produkter, varianter, priser, tilbud, lager, moms, fragt, ordrer, ordrestatus | **WooCommerce** |
| Betaling, betalingsoplysninger (kort-data), betalingsstatus | **Stripe** |
| Præsentation, kurv (kun *hvad* kunden vil have), checkout-UX | **Next.js** |

Browseren bestemmer aldrig en pris. Kurven i `localStorage` indeholder kun produkt-ID, variant-ID og antal, plus den pris kunden så, til visning. Alle beløb beregnes af WooCommerce.

## Hvorfor et lille WordPress-plugin?

WooCommerce REST API v3 alene kan ikke levere et sikkert flow:

1. **Moms og fragt for en kurv uden at oprette en ordre.** Fragtmetoder som "gratis fragt over X kr." er bundet til WooCommerces *kurv*. Pluginet bygger en rigtig WooCommerce-kurv i en isoleret, ikke-gemt session og returnerer WooCommerces egne totaler.
2. **Lagerreservation ved samtidige køb.** REST-oprettede ordrer reserverer ikke lager, så to kunder kan købe den sidste vare. Pluginet opretter ordren via `WC_Checkout::create_order()`, som udløser WooCommerces egen `ReserveStock` (atomisk SQL med `FOR UPDATE`).
3. **Idempotens og samtidighed.** Én ordre pr. checkout-session og én PaymentIntent pr. ordre. Det sikres med databaselåse (`GET_LOCK`) og compare-and-set.

Pluginet implementerer **ikke** sin egen lager- eller momslogik. Lagertræk sker kun i WooCommerce core (`payment_complete()` / statusskift), som selv beskytter mod dobbelt træk.

## Ordre-livscyklus

```
 Kunde trykker "Betal"
   │
   ▼
 POST /api/checkout                         (same-origin, rate limit, Zod)
   │  sender kurv + adresse + fragtmetode + rabatkoder + "den total kunden så"
   ▼
 Plugin: POST /orders  (lås pr. checkout-session)
   • bygger WooCommerce-kurv → priser, lager, rabatkoder, moms, fragt beregnes af WooCommerce
   • rabatkode afvist? → 409 coupon_invalid + ny quote med begrundelsen
   • total ≠ den kunden så? → 409 total_changed + ny quote (kunden skal bekræfte)
   • udsolgt? → 409/422 (ingen ordre)
   • opretter/genoptager ÉN ordre "pending" pr. session + reserverer lager (60 min*)
     og rabatkoder med brugsgrænse. Er sessionens ordre ældre end 60 min*, annulleres
     den, og der oprettes en ny.
   ▼
 Next.js: sikrer ÉN PaymentIntent pr. ordre for præcis ordretotalen
   • idempotency key = ordre + nøgle + beløb  → ingen dubletter ved retries
   • eksisterende PaymentIntent genbruges / beløb opdateres
   • tilknyttes ordren med compare-and-set (parallelle klik giver samme betaling)
   ▼
 Browser: stripe.confirmPayment() (kortdata går direkte til Stripe, 3-D Secure)
   │  capture_method "manual": beløbet RESERVERES kun (requires_capture)
   ▼
 Stripe webhook  ──►  /api/stripe/webhook (signatur verificeres på rå body)
 Retur-URL       ──►  /ordre/bekraeftelse (hurtig vej, samme kode)
   • PaymentIntent hentes FRISK fra Stripe (event-data og URL stoles ikke på)
   • Plugin: POST /orders/{id}/payment (lås pr. ordre, ordrenøgle kræves)
       authorized → beløb + valuta tjekkes → betalingsmetode gemmes → "on-hold"
                   → WooCommerce trækker lager én gang, frigiver reservation, sender mails
                   (intet betalt endnu; shoppens callback-adresse + ordrens token gemmes)
       succeeded  → betalt (trukket, eller en ordre fra før reservationen: payment_complete())
       processing → "on-hold" (lager trækkes, async betalingsmetoder)
       failed     → note på ordren (én gang pr. forsøg), ordren forbliver betalbar
       canceled   → "cancelled" → reservation frigives / lager gendannes
   ▼
 Bekræftelsesside: ordrenummer, "beløbet er reserveret", varer, levering. Kurven tømmes, ny session.
   ▼
 Butikken markerer ordren "Gennemført" (sendt) · eller "Annulleret"
   ▼
 Plugin → POST /api/payments/settle {ordre, nøgle, token}   (eller det daglige /api/cron/settle-payments)
   • token = HMAC(STRIPE_SECRET_KEY, webshop + ordre + nøgle) tjekkes; svar 202, arbejdet sker bagefter
   • ordren læses igen i WooCommerce og PaymentIntent i Stripe
       Gennemført → capture(ordrens beløb − refunderinger), idempotency key pr. forsøg
                    → succeeded → transaktions-ID, betalingsdato, "Betalingen er trukket"
                    → afvist/udløbet → capture_failed/canceled → "on-hold", note, mail til butikken
                      (betalt på anden vis: ordrehandling → "manual", ordren kan forblive Gennemført)
       Annulleret → PaymentIntent annulleres → canceled → "Reservationen er frigivet"
   • dagligt job: advarer også om sendte ordrer, der et døgn senere ikke er trukket
```

\* Bruger WooCommerces indstilling "Hold lager (minutter)". Er den tom, reserverer pluginet i 15 minutter. Pluginet annullerer selv ubetalte headless-ordrer efter "Hold lager"-tiden (60 minutter, hvis den er tom), og en ordre ældre end det genoptages ikke, men erstattes af en ny.

## Garantier og hvordan de opnås

| Krav | Mekanisme |
| --- | --- |
| Ingen dobbeltordrer | Checkout-session-ID (httpOnly-cookie) → én ordre pr. session. Lås + fingerprint giver idempotent replay. |
| Ingen dobbeltbetalinger | Én PaymentIntent pr. ordre (Stripe idempotency key + compare-and-set i WooCommerce). Klientside dobbeltklik-spærre. En betaling, der alligevel ankommer til en allerede betalt eller erstattet ordre, **refunderes automatisk** (en reservation frigives). |
| Intet dobbelt lagertræk | Kun WooCommerce core trækker lager (`_order_stock_reduced`). Betalingshændelser behandles under ordrelås, og ordren genindlæses fra databasen efter låsen. |
| Idempotente webhooks | PaymentIntent hentes frisk. Statusmaskinen i pluginet gør gentagelser til no-ops. Rækkefølgen af events er ligegyldig. |
| Trukket ved afsendelse, aldrig to gange | Beløbet reserveres ved køb (`capture_method: manual`) og trækkes, når ordren er *Gennemført*. Callback og dagligt job er kun et signal: ordre og PaymentIntent læses igen, Stripe accepterer ét træk pr. reservation, og idempotency key pr. PaymentIntent, beløb og forsøg. Kun shoppen kan lave ordrens token. Annulleret før afsendelse → reservationen frigives. |
| Samtidige køb af sidste vare | WooCommerce `ReserveStock` (atomisk). Testet med 4 parallelle købere: præcis én får varen. |
| Pris ændret under checkout | Serveren sammenligner WooCommerces nye total med den, kunden så. Ved forskel → ny quote, og kunden skal trykke Betal igen. |
| Manipulation af priser | Klienten sender ingen priser. Zod fjerner ukendte felter. Beløbet til Stripe = WooCommerce-ordrens total. Webhook tjekker beløb og valuta. |
| Afbrudt betaling | Ordren forbliver "pending" med reservation. WooCommerce annullerer den automatisk efter hold-perioden. Kommer pengene alligevel bagefter, genåbnes ordren, hvis lageret er der, ellers refunderes. |
| WooCommerce nede | Katalog: de sidst hentede data vises videre (en fejlet opdatering kasseres). Er intet hentet endnu, vises en venlig fejlbesked, som kun caches i 30 sek. Checkout: ingen betaling oprettes (503). Webhook: 500, så Stripe prøver igen i op til 3 dage. |

## Sikkerhed

- API-nøgler og Stripe secret key bruges kun i server-kode (`import "server-only"`). Fejlbeskeder og logs indeholder aldrig nøgler, request-bodies eller kundedata.
- Plugin-endpoints kræver WooCommerce-API-nøgle (read/write) for en bruger med `manage_woocommerce`. Ordre-endpoints kræver desuden ordrenøglen.
- API-routes: same-origin-tjek (CSRF), kun `application/json`, maks. body-størrelse, Zod-validering og rate limiting pr. IP (in-memory pr. instans; brug Vercel Firewall eller Upstash ved rigtig trafik).
- Stripe-webhooks verificeres med `constructEvent` på den rå body.
- `/api/payments/settle` (WordPress → shoppen) kræver ordrens token: HMAC-SHA256 med `STRIPE_SECRET_KEY` af webshop, ordre-ID og ordrenøgle, sammenlignet i konstant tid. Kaldet trækker eller frigiver aldrig ud fra sit eget indhold: ordren læses igen i WooCommerce og betalingen i Stripe. `/api/cron/settle-payments` kræver `Authorization: Bearer $CRON_SECRET`.
- Sikkerhedsheaders: HSTS, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`. En Content-Security-Policy med nonces er ikke slået til i prototypen.
- Produktbeskrivelser fra WordPress vises som ren tekst. Der injiceres ingen HTML.

## Caching

- Katalogdata hentes med `'use cache: remote'` + `cacheLife('minutes')` + tags: én cache, som alle Vercels serverinstanser deler, så WordPress kun spørges én gang pr. levetid og ikke af hver ny instans. WooCommerce-produktwebhooks (`/api/revalidate`) og betalte ordrer invaliderer cachen.
- Svarer WooCommerce ikke, kaster læsningen en fejl inde i cachen (`lib/woocommerce/cache.ts`). Så gemmer Next.js intet, og den sidste gode version vises videre, også af sider og `sitemap.xml`, der genopbygges i baggrunden. Den venlige fejlbesked vises kun, når der ikke er noget i cachen. Under `next build` caches fejlen i stedet i 30 sek. (Next.js stopper ellers buildet), så et build uden adgang til WooCommerce stadig lykkes.
- WordPress-værten afviser for mange samtidige forespørgsler med HTTP 508 ("Resource Limit Is Reached"). Derfor sender hver serverinstans højst 4 læsninger ad gangen (`lib/woocommerce/client.ts`; en læsning, der har ventet 5 sek. på en plads, giver op), og menuens antal pr. kategori hentes i ét kald (plugin 1.4) i stedet for ét pr. kategori. En læsning prøves højst én gang til efter 508/429 og slet ikke efter en timeout. Ender en læsning med 508/429, timeout eller ingen forbindelse, spørger instansen ikke WooCommerce om læsninger i 30 sek. (dobbelt så længe, op til 2 min., hvis værten stadig er nede; derefter én prøvelæsning). Cachede sider vises videre imens. Skrivninger (pristilbud, ordrer) holdes aldrig tilbage.
- Pristilbuddet (`/api/checkout/quote`) beregnes højst to gange pr. kurv og adresse under et nedbrud: serveren sender det kun igen, når forbindelsen blev afbrudt, og har en timeout på 6 sek.; browseren spørger selv én gang til efter `Retry-After` (+ tilfældig spredning), når værten var optaget (508/429) eller der ikke var forbindelse. En timeout prøves kun igen med kundens "Prøv igen". Holder browseren op med at vente (kunden skriver videre), afbrydes serverens kald også.
- Produktlister, kategorier og søgning hentes 30 varer ad gangen (`?side=2`), så rækkerne går op med 5, 3 og 2 kort. Sorteringen vælges med `?sorter=` (Anbefalet, Nyeste, Mest populære, Pris). "Anbefalet" følger WooCommerces menurækkefølge (`menu_order`, som Guirca-importen sætter: kostumer først, så masker, parykker, hatte og blod, andet tilbehør og pynt, nyeste først inden for hver). Kategorisider og "Alle produkter" viser desuden shoppens sæson først (`getSeasonalProducts`: to forespørgsler med plugin 1.4's kategorifiltre, sæsonens del side for side og resten med `offset`, så hver vare kommer én gang). Kategoriernes antal tælles pr. webshop med én lille forespørgsel pr. kategori (fejler en, bruges WooCommerces eget antal) og caches i et kvarter.
- **Filtre** på kategori-, tema- og "Alle produkter"-sider (`lib/listing-filters.ts`, `lib/woocommerce/filters.ts`): størrelse (`?str=`), pris (`?pris=`: under 100, 100-250, 250-500, over 500 kr.) og "Kun på lager" (`?lager=ja`). Størrelserne er WooCommerce-egenskaben `pa_storrelse`, samlet i grupper: børn efter alder (en størrelse står under hver alder, den passer til, så "3-6 år" også findes under "5-6 år"), voksne efter bogstav (dame- og herrestørrelser sammen) og skostørrelser. Hver liste tilbyder kun de størrelser (mindst 3 varer), prisintervaller og lagerfilteret, den har brug for. Det tælles i ét kald til WooCommerces Store API pr. liste, som caches i en time (kan det ikke læses, tilbydes alle). De filtrerede varer hentes med de almindelige cachede produktkald (`attribute`/`attribute_term`, `min_price`/`max_price`, `stock_status`), også med sæsonen først og skjulte kategorier. Filtrene står i URL'en som sorteringen, følger med sidelinks og sorteringen, og filtrerede sider har `noindex, follow` og samme canonical som den ufiltrerede side. Store skærme viser filtrene som rækker over varerne; mobil og tablet har knappen "Filtrér" med antal valgte, som åbner et ark nedefra (`<dialog>`), hvor valgene anvendes samlet med "Vis varer". Valgte filtre vises som knapper med × og "Ryd alle".
- Produktbilleder: WooCommerces egne billeder, ellers leverandørens fotos, som en import har linket til (meta `_wchc_external_images`, kun fra værterne i `src/config/images.ts`). Et Guirca-hovedfoto (`<nr>.jpg`), der viser varen to gange, springes over, når varen har andre fotos: et kostumes hovedfoto, når kostumets katalogfoto (`<nr>_01.jpg`) er der, og andre varers, når deres Guirca-nummer står i `src/config/guirca-double-photos.json` (se [IMPORT-GUIRCA.md](IMPORT-GUIRCA.md#hovedfotos-der-viser-varen-to-gange)). Det gælder også varer, der blev importeret før. Alle billeder går gennem Next.js' billedoptimering og caches i 31 dage. Fejler et billede, vises en pladsholder.
- Lager og priser på produktsider er informative. Kurv og checkout henter altid friske tal fra WooCommerce.

## Produktkort og produktside

- **Produktkort** (`components/products/product-card.tsx`): hvide kort på en lys baggrund (`bg-canvas`), billedet vist helt, rabatmærke (`-20 %`, kendes kun for simple produkter), videomærke, 18+-mærke, favorit-hjerte, antal størrelser, stor pris i farven `price` og lagerstatus. 5 pr. række på computer, 3 på tablet og 2 på mobil.
- **Produktside** (`app/(shop)/produkter/[slug]`):
  - Galleri med video. Billederne swipes ét ad gangen med en tæller (2/4), og miniaturerne følger med. Et tryk på billedet åbner det i fuld skærm, hvor man kan zoome med to fingre, swipe eller bruge pilene (også piletasterne); Esc lukker. YouTube-videoer (`_wchc_videos`) indlæses først, når kunden trykker afspil, og i YouTubes privatlivstilstand (youtube-nocookie.com).
  - Pris med "Spar X kr." og lagerstatus. Størrelsesknapperne viser kropshøjden, når beskrivelsen har den ("Størrelser: 3-4 år (109 cm) …", se `lib/product-text.ts`).
  - Under knappen står webshoppens løfter og foldbare afsnit med beskrivelse, størrelser, levering og retur samt produktsikkerhed.
  - På mobil kommer en købsbjælke frem, når man har scrollet forbi knappen, og den glider væk, når footeren kommer frem, så den ikke dækker firmaoplysningerne. Uden valgt størrelse ruller bjælken op til størrelserne.
- **Relevant tilbehør og Lignende produkter** (`getRelatedProducts`, `lib/woocommerce/related.ts`):
  - Tilbehør er varer i kategorierne fra `ACCESSORY_CATEGORY_SLUGS` (Tilbehør og Make-up) med et af produktets temaer (tags). Er der for få, bruges tilbehør fra produktets øvrige kategorier.
  - Den anden sæson holdes ude: ingen varer fra webshoppens skjulte kategorier og, i Fastelavnsshoppen, ingen med f.eks. "flagermus", "kranie" eller "nisse" i navnet (`offSeasonWords` i `config/merchandising.ts`; Guirca giver mange af dem temaet "Dyr"). Er produktet selv fra den anden sæson (et halloweenkostume, et skelet), får det sin egen slags.
  - Rækken viser én af hver slags (hat, paryk, maske …), før der kommer to af samme slags.
  - Lignende produkter er produkter fra produktets mest specifikke kategori, og dem med samme temaer kommer først.
  - Begge foretrækker produktets målgruppe. Børnevarer til voksenkostumer og omvendt kommer sidst.
- **Løfter (USP'er)** står i `config/usps.ts` og er fælles for webshops: baren øverst, rækken over footeren og 2 × 2-boksen på produktsiden. Beløbet for fri fragt (`{fri_fragt}`) læses fra WooCommerce ("Fri fragt fra" på fragtmetoderne, `lib/woocommerce/shipping.ts`). Løfter om fri fragt udelades, hvis ingen metode har det. Kurven viser, hvor meget der mangler til fri fragt.
- **Trustpilot** (`config/trustpilot.ts`, `components/marketing/trustbox.tsx`): Trustpilots egne TrustBoxe med webshoppens rigtige bedømmelse under løfterækken på forsiden, under løfterne på produktsiden (i stedet for teksten "Bedømt som Fremragende"), i kurven og kassens ordreoversigt og i footeren, men ikke på ordrebekræftelsen: dens adresse har ordrens nøgle, og Trustpilot får adressen på hver side med en TrustBox (`FooterTrustBox`; siden sender også kun sit origin som referrer). Trustpilots kode (`div.trustpilot-widget` med `data-*` og linket til profilsiden) og deres script, som hentes én gang, når siden er færdig (`next/script` `lazyOnload`); en TrustBox, der kommer til ved navigation i browseren, indlæses med `Trustpilot.loadFromElement`. Uden business unit ID og profilside vises ingen og hentes intet. Cookie- og privatlivspolitikken har tekster, der kun vises med TrustBoxe (`trustbox: true` i `content/info-pages.ts`). Se [DEPLOY.md](DEPLOY.md#trustpilot-trustboxe).

## Forside, menu, søgning og favoritter

- **Merchandising** (`config/merchandising.ts`) er webshoppens egen opbygning: menu med dropdowns (`components/layout/nav-menu.tsx`, på mobil en skuffe), forsidens hero med nedtælling til sæsonens dag (`lib/seasons.ts`: påske, fastelavn, halloween og danske helligdage), målgruppe-fliser, temafliser og produktrækker uden gentagelser, og temasiderne `/tema/<slug>` (`lib/woocommerce/collections.ts`). De valgte fotos til hero og fliser hentes med én lille forespørgsel pr. vare (kun fotos, ingen størrelser) og caches en time (`getProductPhoto`).
- **Søgeforslag** (`components/layout/search-box.tsx` → `GET /api/search?q=`): kategorier, temaer og produkter med foto og pris, mens kunden skriver. Piletaster og Enter virker, Tab forlader feltet og lukker listen, og en skærmlæser får antallet af forslag læst op; uden JavaScript er det en almindelig formular til `/soeg`.
- **Dansk søgning** (`lib/search.ts`): WooCommerce finder kun varer, der indeholder ordene, som de er skrevet. Webshoppens egen højtid udelades derfor ("halloweenmaske" → "maske", "halloween paryk" → "paryk" i Halloweenshoppen, "fastelavnskostume" → "kostume" i Fastelavnsshoppen), og kendte flertalsformer søges som grundform ("masker" → "maske", som også finder alle "masker"). Finder søgningen intet, prøves varianter i rækkefølge: webshoppens egne synonymer ("kattekonge" → "konge krone", "kunstigt blod" → "blod"), sammensatte ord delt ("zombiemaske" → "zombie maske") og ord uden endelse ("vampyrerne" → "vampyr"), højst 4 forsøg på `/soeg` og 2 pr. tastetryk i forslagene. `/soeg` prøver varianterne med forslagenes ene læsning (ofte allerede i cachen) og henter kun den, der finder noget, i fuld længde. Siden skriver "Viser resultater for …". Inden for hver side kommer varer med ordet i navnet først, derefter sæsonens, så dem, hvor ordet står alene. `/soeg` har sortering og viser passende kategorier og temaer som knapper (kategorier, som webshoppen holder ude af menuen, tæller halvt: "pynt" viser Pynt og fest før Julepynt, men "jule pynt" viser Julepynt først). Finder den intet, vises webshoppens temafliser og eksempelord.
- **Favoritter** (`lib/favorites`): produkt-ID'er i kundens browser (localStorage, pr. webshop). Hjertet på kort og produktside, ikonet i headeren og `/favoritter`, der henter friske priser via `GET /api/products?ids=`.
- **Afsendelsesnedtælling** (`components/marketing/dispatch-countdown.tsx`, `lib/delivery.ts`): "Bestil inden 3 t 12 min – så sender vi i dag" på hverdage før kl. 19 (dansk tid, ikke helligdage), ellers kun løftet. Der loves ingen leveringsdato. Vises på produktsiden, i kurven og kurvskuffen.
- **Informationssider** (`content/info-pages.ts`, vist af `components/content/info-page.tsx`): handelsbetingelser, returret, fragt, privatliv, cookies, prismatch, kontakt, FAQ, størrelsesguide og "Om os" (pr. webshop). Tekstens `{tokens}` fyldes ud fra `config/company.ts` og webshoppen. Pladsholdere i [klammer] fremhæves med gult, indtil ejeren har udfyldt dem.
- **SEO:** kanoniske adresser (hvert produkt peger på sin hjemme-webshop, altid en webshop, der sælger det, se [MULTISHOP.md](MULTISHOP.md); side 2, 3 … af en liste er hver sin side med "– side 2" i titlen), `sitemap.xml` (forside, temaer, kategorier, produkter og informationssider, som har deres kanoniske adresse i denne webshop; produkterne hentes 100 ad gangen, tre sider samtidig), `robots.txt`, beskrivelser til søgeresultaterne bygget af navn, pris, tekst, størrelser og løfter (`lib/meta-description.ts`), JSON-LD for produkter (pris, lager, EAN; sælgeren er hjemme-webshoppen), brødkrummer på produkt-, kategori- og temasider, butikken med søgning og FAQ. Søgemaskiner får sidens metadata før siden (`htmlLimitedBots` i `next.config.ts`, også Googlebot), så et ukendt produkt, en ukendt kategori eller et tema og en side efter den sidste svarer 404. Kan WooCommerce ikke læses, svarer siden stadig 200 med fejlbeskeden: en 5xx kræver en fejl i metadata, og så afslutter Next.js 16.4 ikke svaret til søgemaskinen. Favicon, hjemmeskærmsikon, delingsbillede og e-mail-logo (`/email-logo.png`) tegnes af koden ud fra brandet (`lib/brand-images.tsx`, skrifterne ligger i `assets/fonts`).

## Flere webshops

Se [MULTISHOP.md](MULTISHOP.md).

- Én kodebase, ét Vercel-projekt pr. webshop. `NEXT_PUBLIC_STORE_ID` vælger brand (navn, logo, farver, skrift og sæson i `src/config/store.ts`, sat som designtokens fra `globals.css`), merchandising og webshop i WooCommerce.
- Produktfordelingen ligger i WooCommerce (taksonomien "Webshops" fra pluginet). Kataloget hentes med `wchc_shop`, og `/quote` og `/orders` afviser produkter, webshoppen ikke sælger. Reglen håndhæves altså i backenden, ikke kun i frontenden.
- Hver ordre får `_wchc_store_id`, og hver PaymentIntent får `metadata.store_id`. Webhooks for andre webshops' betalinger ignoreres, så alle webshops kan dele én Stripe-konto og én WooCommerce.
- Data- og checkoutlaget (`lib/woocommerce`, `lib/checkout`) er uafhængigt af UI'et.
