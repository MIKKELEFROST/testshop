# Import af Guirca-produkter

`scripts/guirca/import_guirca.py` læser Guircas produktark (Excel med fanerne GUIRCA og GUIRMA) og opretter varerne i WooCommerce med danske navne, beskrivelser, kategorier, størrelser og priser. Den kan køres igen, når Guirca sender et nyt ark.

## Sådan køres den

Kræver Python 3.11+ og `pip install -r scripts/guirca/requirements.txt` (pandas, openpyxl, requests; numpy og opencv-python-headless bruges kun af `doubles`). WooCommerce-nøglerne læses fra miljøet, f.eks. fra `.env.local`:

```bash
set -a; . ./.env.local; set +a

# 0. Billedtjek (ca. 30 minutter første gang): hvilke af Guircas fotos findes, også dem arket ikke nævner
python3 scripts/guirca/import_guirca.py images PRODUCTS_INFORMATIONS.xlsx --out images.tsv

# 0b. Hovedfotos, der viser varen to gange (ca. en time): skriver src/config/guirca-double-photos.json, som skal committes
python3 scripts/guirca/import_guirca.py doubles PRODUCTS_INFORMATIONS.xlsx --image-status images.tsv

# 1. Oversigt uden at røre WooCommerce: tal i terminalen + guirca-preview.csv (åbner i Excel)
python3 scripts/guirca/import_guirca.py report PRODUCTS_INFORMATIONS.xlsx --out /tmp/guirca --image-status images.tsv

# 2. Plan mod WooCommerce (læser kun): hvor mange oprettes, opdateres og er uændrede
python3 scripts/guirca/import_guirca.py import PRODUCTS_INFORMATIONS.xlsx --dry-run

# 3. Prøv med 100 varer fordelt over kategorierne, uden at vise dem i nogen webshop
python3 scripts/guirca/import_guirca.py import PRODUCTS_INFORMATIONS.xlsx --sample 100 --no-webshop

# 4. Det hele (ca. 15 minutter, målt på test.piece.dk); --log skriver én linje pr. vare
python3 scripts/guirca/import_guirca.py import PRODUCTS_INFORMATIONS.xlsx --image-status images.tsv --log import.jsonl

# 5. Rækkefølgen ved "Anbefalet" (menu_order): først en prøvekørsel, der kun læser, så --apply
python3 scripts/guirca/import_guirca.py order
python3 scripts/guirca/import_guirca.py order --apply

# 6. Unikke navne til varer, der hedder det samme (kun navnet, adresserne bliver)
python3 scripts/guirca/import_guirca.py names --out /tmp/guirca/navne.csv
python3 scripts/guirca/import_guirca.py names --apply

# 7. Varer kun for voksne (18+ og grove varer) kun i Halloweenkostumer.dk: først en prøvekørsel, der kun læser, så --apply
python3 scripts/guirca/import_guirca.py adult
python3 scripts/guirca/import_guirca.py adult --apply
```

`order`, `names` og `adult` skal ikke bruge arket. De læser alle varer i WooCommerce (100 ad gangen, én forespørgsel ad gangen) og skriver intet uden `--apply`. Se "Rækkefølge og ens navne" og "Varer kun for voksne (18+)" nedenfor.

Andre valg: `--codes 78224,19000` (kun bestemte Guirca-numre), `--webshop SLUG,SLUG` (webshops til nye varer, standard `halloween-kostumer-dk,piece-dk`), `--workers` og `--batch` (samtidige forespørgsler og varer pr. forespørgsel), `--image-status FIL` (svarene fra billedtjekket: døde links udelades, og fotos på Guircas server, som arket ikke nævner, kommer med).

Arket skal ikke i Git. Det er Guircas forhandlerdata.

## Reglerne

| Emne | Regel |
| --- | --- |
| Størrelser | Rækker med samme `CONNECTOR SIZE` (Guircas egen nøgle) bliver ét variabelt produkt med en variant pr. størrelse. Resten bliver simple produkter. |
| Varenumre | Varianter og simple produkter: `GU-` + Guircas varenummer (f.eks. `GU-78225`). Variable produkter: `GU-første-sidste` (f.eks. `GU-78224-78227`). EAN gemmes som GTIN. |
| Navne | Oversat til dansk (`translations/`). Kostumer får målgruppen på: "Mørk enhjørning – kostume til piger". Har to varer samme navn, får de farven på ("…, rød og gul"). Hedder de stadig det samme, får hver den første oplysning, der skiller den ud (se "Ens navne"). |
| Rækkefølge | Nye varer får `menu_order` efter, hvad de er (kostumer først, se "Rækkefølge ved Anbefalet"). `order` placerer dem endeligt. |
| Størrelsesnavne | `7 - 9 YEARS` → "7-9 år", `12 - 18 MONTHS` → "12-18 mdr.", `42 - 44 (L)` → "L (42-44)". Sorteres fra baby til voksen. |
| Pris | Amazons vejledende pris i euro × 7,46, afrundet til nærmeste pris der ender på 9 (mindst 9 kr.). Displays i julearket (GUIRMA) er prissat pr. display og deles med antal stk. |
| Kategorier | Dansk træ: Kostumer (Dame/Herre/Pige/Drenge/Baby/Hunde), Tøj, Tilbehør, Make-up, Pynt og fest, plus sæsonkategorierne Halloween og Jul og nytår. Unisex-kostumer ligger i begge køn. Se `CATEGORY_ORDER` i `rules.py`. |
| Sæsonkategorier | Halloween: et af Guircas Halloween-temaer (Skeletons, Witches, Zombie …) eller en Halloween-kategori (græskar, gravsten …). Jul og nytår: Guircas julesæson (julearket) eller et juletema. Guircas generelle temaer tæller ikke alene på alt: "Halloween" står på hele deres almindelige make-up (ansigtsmaling i alle farver, svampe, pensler, læbestift, øjenvipper), og "Christmas"/"Elf" på alfeører, englevinger og lysegrøn sminke. Dér kræver sæsonen et sæsonord i Guircas navn (f.eks. "ZOMBIE", "BLOOD", "SANTA"). Kostumer, pynt, masker, våben, parykker og blod beholder det generelle "Halloween". Se `GENERIC_HALLOWEEN_THEMES` i `rules.py`. |
| Tags | Guircas temaer på dansk (Pirater, 80'erne, Superhelte og tegnefilm …). Farver og sæsoner bliver ikke tags. |
| Egenskaber | Størrelse (bruges til varianter), Målgruppe og Farve (til filtre senere). |
| Beskrivelse | Bygget af arkets fakta: indhold, størrelser med højde, materiale, farve, mål, lys/lyd/bevægelse, batterier, brandhæmmende/CE og anbefalet alder. |
| Producent (GPSR) | Alle varer har Guircas navn og adresse fra deres sikkerhedsmærkat. Produktsiden linker til mærkaten med advarsler (også på dansk). |
| Billeder | Guircas fotos hentes ikke ind i WordPress. Links gemmes på varen (`_wchc_external_images`), og shoppen viser dem via Vercels billedoptimering. Alle fotos kommer med, også dem arket ikke nævner (se "Billedtjek"), i arkets rækkefølge: hovedfoto, katalogfoto, uden emballage, bagfra, detaljer og emballage. Et hovedfoto (`<nr>.jpg`), der viser varen to gange, udelades, når varen har andre fotos (se "Hovedfotos, der viser varen to gange"). Døde links udelades. For varer med størrelser bruges størrelsen med flest fotos. |
| Lager | Lagerstyring slået fra og "på lager", fordi arket ikke har lagertal. Kommer der en lagerfil fra Guirca, kan importen opdatere lageret. |
| Kladder | Varer uden brugbar pris (mangler eller f.eks. 1.455.985 EUR i arket) bliver kladder med forklaringen i `_wchc_import_issue`. Størrelser uden pris bliver private. |
| Webshop | Alle varer tildeles begge webshops, Halloweenkostumer.dk (`halloween-kostumer-dk`) og Fastelavnskostumer.dk (`piece-dk`). Varer kun for voksne (Guirca-kategorien EROTIC og de grove varer, se "Varer kun for voksne (18+)") sælges kun i Halloweenkostumer.dk (`ADULT_WEBSHOPS` i `rules.py`). De erotiske varer ligger kun i "Polterabend (18+)", uden sæsonkategori; de grove varer beholder deres egne kategorier. |
| Springes over | Butiksdisplays (f.eks. "CHRISTMAS DISPLAY 187 x 30 x 61 CM") og rækker uden navn. |

## Når importen køres igen

- Varer findes igen på Guircas varenumre (`_supplier_article_codes`), så der ikke opstår dubletter. Uændrede varer springes over.
- Pris, EAN, vægt, mål, størrelser, egenskaber, billedlinks og leverandørdata opdateres altid.
- Navn, tekster, kategorier, tags, status, webshops og lagerindstillinger sættes kun, når varen oprettes. Rettelser i WooCommerce overskrives derfor ikke. Med `--overwrite texts,categories` (eller `all`) sættes de igen. Eksisterende varer kun for voksne kommer kun i Halloweenkostumer.dk med `adult`, ikke med importen.
- Bliver en kørsel afbrudt, startes den bare igen. WooCommerce afviser dobbelte varenumre, og importen tjekker, hvad der nåede at blive gemt. Efter en afbrudt forespørgsel venter den først et minut (`--settle`), fordi WooCommerce kan være i gang med at gemme.
- En vare med størrelser, der mangler nogle af sine størrelser i WooCommerce, gennemgås igen, også selvom resten er uændret.
- `menu_order` sættes kun på nye varer; `order` sætter den for alle. Eksisterende varer får nye navne med `names`, ikke med importen.
- Reglen for sæsonkategorier blev strammet 16-10-2026 (se "Reglerne"). Varerne i WooCommerce har stadig de gamle kategorier: efter arket (16-10-2026) mister 151 varer en sæsonkategori, 128 Halloween (111 ansigtsmaling og sminke, 9 glimmer, 8 øjenvipper og negle) og 23 Jul og nytår (alfeører, englevinger, lysegrøn sminke, handsker …). De 128 får derved Fastelavnskostumer.dk som hjemme-webshop og vises i Fastelavnsshoppens temaer. Det gælder først, når kategorierne sættes igen, og det kræver ejerens ja: `import <ark> --overwrite categories --codes <varenumre> --dry-run` viser planen, uden `--dry-run` gemmes den. Varenumrene findes uden WooCommerce: kør `report` med reglerne før og efter (commit'en før og efter ændringen i `rules.py`) og sammenlign kolonnen Kategorier i `guirca-preview.csv`. Planen læser alle varer i WooCommerce (ca. 90 forespørgsler), så kør den ikke, mens webshoppen har travlt.

## Rækkefølge og ens navne

### Rækkefølge ved Anbefalet (`order`)

Shoppens sortering "Anbefalet" følger WooCommerces `menu_order` (laveste først). `order` sætter den for alle varer ud fra deres kategorier (`MERCHANDISING_TIERS` i `rules.py`), og inden for hver gruppe kommer de nyeste først (WooCommerces oprettelsesdato, som importen sætter til Guircas introduktionsår, og ved samme dato det højeste id):

| Gruppe | Kategorier | `menu_order` |
| --- | --- | --- |
| 0 | Kostumer (alle målgrupper) | 0 … |
| 1 | Masker, parykker, skæg og overskæg, hatte og hjelme, al make-up (også blod og effekter) | 100.000 … |
| 2 | Andet tilbehør og tøj | 200.000 … |
| 3 | Pynt og fest (Halloweenpynt, figurer, julepynt …) | 300.000 … |
| 4 | Alt andet: kun Halloween/Jul og nytår, Polterabend (18+), uden kategori | 400.000 … |

En vare i flere kategorier får den bedste gruppe. Sæsonkategorierne tæller ikke, så en maske i både Masker og Halloween er i gruppe 1. Underkategorier uden egen gruppe arver forælderens (Tilbehør › Briller er gruppe 2).

- Kun `menu_order` skrives, med `wc/v3/products/batch` i portioner på højst 50 (`--batch`), én ad gangen og med 2 sekunders pause (`--pause`). En portion, der fejler, sendes igen efter et minut (`--settle`), fordi WooCommerce kan være i gang med at gemme den. Varianter røres ikke.
- Nye varer fra importen får gruppens første nummer (f.eks. 100.000) og står derfor øverst i deres gruppe, indtil `order` køres igen. Kør `order` efter større importer. Den nummererer hele gruppen om, så de fleste varer får et nyt tal.
- Prøvekørslen 15-10-2026: 8.623 varer, heraf 1.952 kostumer, 1.981 masker/parykker/hatte/make-up, 3.256 andet tilbehør og tøj, 1.397 pynt og 37 øvrige. 8.622 ville få ny `menu_order`, fordi ingen havde en endnu.

### Ens navne (`names`)

643 udgivne varer hed det samme som en anden vare (f.eks. tre gange "Kraniemaske, PVC, hvid" til 29, 39 og 49 kr.). Det ligner en prisfejl, og kunden kan ikke se forskel. `names` (og importens navngivning af nye varer) giver hver vare med et delt navn den første oplysning, som ingen af de andre med samme navn har, og som navnet ikke allerede siger:

1. størrelse fra beskrivelsens "Mål: ca. …" (det største mål): "Kraniemaske, PVC, hvid, ca. 23,5 cm"
2. målgruppe: "Mellemlang grøn paryk (i æske), til damer"
3. antal, når teksten nævner det: "…, 12 stk."
4. farve: "…, hvid og sort"
5. ellers Guircas varenummer: "Kraniemaske, PVC, hvid, model 20113"

- Kun udgivne varer sammenlignes (store og små bogstaver tæller ikke). Kun navnet skrives; adressen (slug) og dermed links og Google bliver, som de er. Et nyt navn tager aldrig navnet fra en anden vare; så bruges varenummeret.
- Oplysningerne læses fra det, WooCommerce viser (beskrivelse, Målgruppe, Farve og varenummeret i SKU'en), så rettelser i WooCommerce tæller med. Det giver de samme navne, som importen giver nye varer.
- `--out navne.csv` skriver alle omdøbninger (id, varenr., navn nu, nyt navn), så de kan tjekkes i Excel før `--apply`. Kør `names` igen, når kladder er blevet udgivet.
- Prøvekørslen 15-10-2026: 283 navne delt af 643 udgivne varer. 132 får størrelsen, 17 målgruppen og 494 Guircas varenummer (især kostumer og parykker, hvor arket ikke har andre forskelle).

## Varer kun for voksne (18+)

Guirca lægger sine sexspil, sit undertøj og sine sado-varer i kategorien EROTIC (37 varer), men de fleste grove polterabend-gags andre steder: "Penisforklæde" i Tøj, "Oppustelige bryster" i Gadgets og sjov, kostumet "Sexlegetøj" i Herrekostumer og en "Amputeret penis" i Halloweenpynt. De er også kun for voksne (`is_crude` i `rules.py`), når

- det danske navn nævner kønsorganer, bryster eller brystvorter, sex, sexlegetøj, kondomer, sæd, nøgenhed eller bondage, eller siger noget groft (`CRUDE_NAME`: "penis", "testikler", "bryster", "brystvorte", "kondom", "sædcelle", "sexlegetøj", "sexman", "fuck", "dick", "nøgen", "åben gylp", "med overraskelse", "bondage", "erotisk"),
- indholdet i beskrivelsen er en penis eller testikler (`CRUDE_CONTENT`: "Indhold: hætte, heldragt og penis." på hingsten, hulemanden, bananen …),
- eller Guircas varenummer står i `CRUDE_ARTICLES`: varer, hvis fotos er grove, uden at navnet siger det (penisformet konfetti, en kokkehue og en kat formet som kønsorganer, en bedstemor og et juleforklæde med nøgen krop, og polterabend-pokalerne "Mister Sex" med en penis og "Miss Sexy" med en nøgen pin-up, så parret følges ad). For en vare med størrelser er det det laveste nummer, som SKU'en starter med.

Ordene tæller kun, hvor de betyder det: "kæmpenisse" har "penis" indeni, et "skjortebryst" er et skjorteforstykke og en "brystplade" en rustning, polstrede bryster i drag- og livredderkostumer tæller ikke, "sexet" (sexet politibetjent, sexet kanin) er almindelige voksenkostumer, og "sex" alene er et slogan (vifte "Sea, Sex & Sun", 27502, kun påtrykt tekst). Reglen ser på de danske tekster, fordi `adult` kun har dem i WooCommerce. Importen og `adult` finder derfor de samme varer.

Ejerens beslutning 16-10-2026: varer kun for voksne sælges kun i Halloweenkostumer.dk, aldrig i Fastelavnskostumer.dk (`ADULT_WEBSHOPS` i `rules.py`). Ellers er de som andre varer: de er udgivne (kladder kun af de sædvanlige grunde, f.eks. uden brugbar pris), Guircas erotiske varer ligger i "Polterabend (18+)" uden sæsonkategori, og de grove varer beholder de kategorier, reglerne giver dem (f.eks. Herrekostumer, Tøj, Halloween eller Jul og nytår). `adult` gør det samme for varerne i WooCommerce: hver vare kun for voksne, som en anden webshop også (eller kun) sælger, får Halloweenkostumer.dk som eneste webshop. Kun feltet Webshops skrives, i portioner på højst 50 som `order`; status og kategorier røres ikke, og en vare uden webshop (sælges ingen steder) forbliver uden. Udskriften viser hver vare med id, status, navn, kategorier, webshops nu → efter og grunden.

- Prøvekørslen 16-10-2026: 8.623 varer læst, 85 kun for voksne, alle udgivne. De 37 i "Polterabend (18+)" sælges allerede kun i Halloweenkostumer.dk og er uændrede. De 48 grove varer sælges i begge webshops og får kun Halloweenkostumer.dk: 35 efter navnet, 6 efter indholdet (kostumerne Hingst, Homo erectus, Glad banan, Skjult budskab, Stretching-gymnast og Big Drag) og 7 efter varenummeret (begge pokaler med). 19 af dem er herrekostumer, 4 er i Halloween (latexlem, krog med testikler, amputeret penis, skelet med penis) og 4 i Jul og nytår (tre juleforklæder og brystvortecovers); de beholder deres kategorier. Arket giver de samme 85 (`report`: "Kun 18+ … 85"). Ikke kørt med `--apply` endnu.
- I Halloweenkostumer.dk har kun varerne i "Polterabend (18+)" et 18+-mærke og holdes ude af forsiden, anbefalingerne og "Alle produkter" (se [MULTISHOP.md](MULTISHOP.md)). De grove varer i andre kategorier vises som andre varer dér. Efter `adult --apply` er deres hjemme-webshop (kanonisk adresse og sitemap) Halloweenkostumer.dk, fordi kun den sælger dem, også dem i Herrekostumer, Tøj og Jul og nytår.
- Ikke med (sjove, men ikke grove): sjove underbukser og mankinier med dyr eller frugt foran (f.eks. 17189, 17191, 18292-18298, 27758, 27772, 27787-27789, 41143, 42512, 42513), kostumer med en slange, et stik eller en kasse foran (89059, 86807, 86108), forklæder og kostumer med påtrykt undertøj (18194, 41139, 79640) og de sexede voksenkostumer. Skal en af dem med, så tilføj varenummeret til `CRUDE_ARTICLES`.
- Skal en vare kun for voksne også sælges i Fastelavnskostumer.dk, så tag den først ud af reglen (f.eks. et varenummer i `CRUDE_ARTICLES`), ellers fjerner næste `adult --apply` webshoppen igen. Kryds derefter webshoppen af på varen i WooCommerce.

## Oversættelser

`translations/families.json` (kostume- og tøjfamilier uden målgruppe), `names.json` (øvrige varer) og `vocabulary.json` (indhold, materialer, farver, temaer). Nøglen er Guircas engelske tekst. Ret en oversættelse i filen, og kør importen med `--overwrite texts --force` for de berørte varer (f.eks. med `--codes`). Nye varer i et senere ark mangler oversættelse og bliver kladder med "Mangler dansk navn", indtil de er oversat.

## Billedtjek

Guirca har op til 21 fotos pr. vare på `marketing.guirca.com/<nr>/<nr><ending>.jpg` (hovedfotoet `<nr>.jpg`, og `_01` … `_20` for katalog, bagfra, detaljer, emballage osv., se `IMAGE_COLUMNS` i `rules.py`). Arket nævner ofte kun nogle af dem. Kommandoen `images` spørger Guircas server (HEAD) om alle arkets links og alle 21 navne for hver vare og skriver svarene i en TSV-fil (url, HTTP-status, indholdstype):

- En afbrudt kørsel fortsætter, hvor den slap: links, der allerede har et svar i filen, spørges ikke igen. Brug en ny fil for at spørge om alt igen (f.eks. når Guirca har lagt nye fotos op).
- 404 tæller som død. Timeouts og serverfejl tæller som "intet svar" og spørges igen næste gang. Arkets egne links uden svar beholdes.
- Første kørsel (15-10-2026): 265.073 links, 63.049 fotos fandtes, heraf 5.544 som arket ikke nævnte. 2.402 varer fik flere fotos (i alt 3.910), og kun 49 varer har stadig ét foto, fordi Guirca kun har ét.

## Hovedfotos, der viser varen to gange

Guircas hovedfoto (`<nr>.jpg`) er ofte en collage, der viser varen to gange: et udsnit med det samme foto igen i mindre format i et hjørne eller ved siden af, eller varen på en model ved siden af varen alene, dens emballage eller en display. Et sådant hovedfoto udelades, når varen har andre fotos, så det næste foto (normalt katalogfotoet) bliver det første. Enkeltfotos og stemningsbilleder beholdes, og et hovedfoto, der er varens eneste foto, beholdes altid.

- **Kostumer:** hovedfotoet er altid et udsnit med det samme foto nederst i venstre hjørne. Det udelades, når kostumets katalogfoto (`<nr>_01.jpg`, hele kostumet) findes. Det er en fast regel, som også gælder nye kostumer.
- **Andre varer:** kommandoen `doubles` henter hvert hovedfoto og de to fotos efter det og skriver Guirca-numrene på dem, der viser varen to gange, i `src/config/guirca-double-photos.json` (`codes`). Dem, den overser, men som er fundet ved at se på fotoene, står i samme fil under `by_eye`, og de bliver stående, når `doubles` køres igen. Importen (`rules.py`) og shoppen (`src/lib/woocommerce/mappers.ts`) læser begge lister, så shoppen udelader fotoet med det samme, også på varer, der blev importeret før. Kør `doubles` igen, når Guirca sender et nyt ark eller nye fotos, og commit filen. Et hovedfoto, der skal med alligevel, fjernes fra listen i hånden.
- Sådan genkendes det (`photos.py`, OpenCV): fotoet indeholder en skaleret kopi af sig selv (SIFT-punkter, som én skalering på 1,3-6 gange fører fra én del af fotoet til en anden), eller et af varens andre fotos står i det som et felt ved siden af andet indhold på en hvid baggrund. En vare, der er sat ind i et stemningsbillede, tæller ikke.
- Afprøvet på 68 håndsorterede hovedfotos af tilbehør og pynt: alle 9 med det samme foto to gange og 30 af 34 collager blev fundet, og ingen af de 25 enkeltfotos og stemningsbilleder blev udeladt. Den overser især collager, hvor varen på modellen er set fra en anden vinkel end varen alene. En collage, der ikke genkendes, beholder blot sit hovedfoto, til den kommer på `by_eye`.
- Første kørsel (16-10-2026): `doubles` fandt 3.994 af 7.176 hovedfotos (uden kostumer med katalogfoto). I en stikprøve på 48 af dem viste 47 varen to gange (det sidste var en emballage med et lille foto af modellen). De 3.182, den ikke fandt, blev gennemset to gange uafhængigt på kontaktark, og ved uenighed i stor størrelse: 753 af dem viser også varen to gange (mest varen på en model ved siden af varen alene), og de står under `by_eye`. I alt udelades 4.747 hovedfotos.

## Billeder og Vercel

Guircas fotos er 2.500 px og op til 1 MB. Shoppen viser dem kun gennem Next.js' billedoptimering, så kunderne får små WebP-filer, og optimerede billeder gemmes i 31 dage. På Vercels Hobby-plan er der 5.000 billedtransformationer om måneden. Når de er brugt, viser shoppen en neutral pladsholder i stedet for nye billeder til næste måned. En rigtig shop skal alligevel på Pro (Hobby er kun til ikke-kommercielt brug), og dér koster det ca. 0,05 USD pr. 1.000 billeder.

I WooCommerce-admin har varerne ingen udvalgt billede, fordi billederne ligger hos Guirca. Skal billederne ind i WordPress (f.eks. til Google Shopping), kan importen udvides til at hente dem. Det fylder ca. 1 MB pr. billede.

## Tests

`python3 -m unittest discover -s scripts/guirca` (kører også i CI; `python3 -m pytest scripts/guirca` virker også) tester størrelser, priser, navne og unikke navne, kategorier, varer kun for voksne (reglen for grove varer, kategorier, status og webshops, og `adult`), rækkefølgen ved Anbefalet, beskrivelser, samling af størrelser og billedtjekkets regler (fotos, arket ikke nævner, koder med mellemrum, svar uden status).
