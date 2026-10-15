# Import af Guirca-produkter

`scripts/guirca/import_guirca.py` læser Guircas produktark (Excel med fanerne GUIRCA og GUIRMA) og opretter varerne i WooCommerce med danske navne, beskrivelser, kategorier, størrelser og priser. Den kan køres igen, når Guirca sender et nyt ark.

## Sådan køres den

Kræver Python 3.11+ og `pip install -r scripts/guirca/requirements.txt` (pandas, openpyxl, requests). WooCommerce-nøglerne læses fra miljøet, f.eks. fra `.env.local`:

```bash
set -a; . ./.env.local; set +a

# 1. Oversigt uden at røre WooCommerce: tal i terminalen + guirca-preview.csv (åbner i Excel)
python3 scripts/guirca/import_guirca.py report PRODUCTS_INFORMATIONS.xlsx --out /tmp/guirca

# 2. Plan mod WooCommerce (læser kun): hvor mange oprettes, opdateres og er uændrede
python3 scripts/guirca/import_guirca.py import PRODUCTS_INFORMATIONS.xlsx --dry-run

# 3. Prøv med 100 varer fordelt over kategorierne, uden at vise dem i nogen webshop
python3 scripts/guirca/import_guirca.py import PRODUCTS_INFORMATIONS.xlsx --sample 100 --no-webshop

# 4. Det hele (ca. 15 minutter på test.piece.dk); --log skriver én linje pr. vare
python3 scripts/guirca/import_guirca.py import PRODUCTS_INFORMATIONS.xlsx --log import.jsonl
```

Andre valg: `--codes 78224,19000` (kun bestemte Guirca-numre), `--webshop SLUG` (standard `halloween-kostumer-dk`), `--workers` og `--batch` (samtidige forespørgsler og varer pr. forespørgsel), `--image-status FIL` (udelad døde billedlinks fundet ved et billedtjek).

Arket skal ikke i Git. Det er Guircas forhandlerdata.

## Reglerne

| Emne | Regel |
| --- | --- |
| Størrelser | Rækker med samme `CONNECTOR SIZE` (Guircas egen nøgle) bliver ét variabelt produkt med en variant pr. størrelse. Resten bliver simple produkter. |
| Varenumre | Varianter og simple produkter: `GU-` + Guircas varenummer (f.eks. `GU-78225`). Variable produkter: `GU-første-sidste` (f.eks. `GU-78224-78227`). EAN gemmes som GTIN. |
| Navne | Oversat til dansk (`translations/`). Kostumer får målgruppen på: "Mørk enhjørning – kostume til piger". Har to varer samme navn, får de farven på ("…, rød og gul"). |
| Størrelsesnavne | `7 - 9 YEARS` → "7-9 år", `12 - 18 MONTHS` → "12-18 mdr.", `42 - 44 (L)` → "L (42-44)". Sorteres fra baby til voksen. |
| Pris | Amazons vejledende pris i euro × 7,46, afrundet til nærmeste pris der ender på 9 (mindst 9 kr.). Displays i julearket (GUIRMA) er prissat pr. display og deles med antal stk. |
| Kategorier | Dansk træ: Kostumer (Dame/Herre/Pige/Drenge/Baby/Hunde), Tøj, Tilbehør, Make-up, Pynt og fest, plus sæsonkategorierne Halloween og Jul og nytår. Unisex-kostumer ligger i begge køn. Se `CATEGORY_ORDER` i `rules.py`. |
| Tags | Guircas temaer på dansk (Pirater, 80'erne, Superhelte og tegnefilm …). Farver og sæsoner bliver ikke tags. |
| Egenskaber | Størrelse (bruges til varianter), Målgruppe og Farve (til filtre senere). |
| Beskrivelse | Bygget af arkets fakta: indhold, størrelser med højde, materiale, farve, mål, lys/lyd/bevægelse, batterier, brandhæmmende/CE og anbefalet alder. |
| Producent (GPSR) | Alle varer har Guircas navn og adresse fra deres sikkerhedsmærkat. Produktsiden linker til mærkaten med advarsler (også på dansk). |
| Billeder | Guircas fotos hentes ikke ind i WordPress. Links gemmes på varen (`_wchc_external_images`), og shoppen viser dem via Vercels billedoptimering. Døde links udelades. Se nedenfor. |
| Lager | Lagerstyring slået fra og "på lager", fordi arket ikke har lagertal. Kommer der en lagerfil fra Guirca, kan importen opdatere lageret. |
| Kladder | Varer uden brugbar pris (mangler eller f.eks. 1.455.985 EUR i arket) bliver kladder med forklaringen i `_wchc_import_issue`. Størrelser uden pris bliver private. |
| Webshop | Alle varer tildeles Maskerade (`halloween-kostumer-dk`). Erotiske varer (Guirca-kategorien EROTIC) kommer i "Polterabend (18+)" uden webshop. |
| Springes over | Butiksdisplays (f.eks. "CHRISTMAS DISPLAY 187 x 30 x 61 CM") og rækker uden navn. |

## Når importen køres igen

- Varer findes igen på Guircas varenumre (`_supplier_article_codes`), så der ikke opstår dubletter. Uændrede varer springes over.
- Pris, EAN, vægt, mål, størrelser, egenskaber, billedlinks og leverandørdata opdateres altid.
- Navn, tekster, kategorier, tags, status, webshops og lagerindstillinger sættes kun, når varen oprettes. Rettelser i WooCommerce overskrives derfor ikke. Med `--overwrite texts,categories` (eller `all`) sættes de igen.
- Bliver en kørsel afbrudt, startes den bare igen. WooCommerce afviser dobbelte varenumre, og importen tjekker, hvad der nåede at blive gemt. Efter en afbrudt forespørgsel venter den først et minut (`--settle`), fordi WooCommerce kan være i gang med at gemme.
- En vare med størrelser, der mangler nogle af sine størrelser i WooCommerce, gennemgås igen, også selvom resten er uændret.

## Oversættelser

`translations/families.json` (kostume- og tøjfamilier uden målgruppe), `names.json` (øvrige varer) og `vocabulary.json` (indhold, materialer, farver, temaer). Nøglen er Guircas engelske tekst. Ret en oversættelse i filen, og kør importen med `--overwrite texts --force` for de berørte varer (f.eks. med `--codes`). Nye varer i et senere ark mangler oversættelse og bliver kladder med "Mangler dansk navn", indtil de er oversat.

## Billeder og Vercel

Guircas fotos er 2.500 px og op til 1 MB. Shoppen viser dem kun gennem Next.js' billedoptimering, så kunderne får små WebP-filer, og optimerede billeder gemmes i 31 dage. På Vercels Hobby-plan er der 5.000 billedtransformationer om måneden. Når de er brugt, viser shoppen en neutral pladsholder i stedet for nye billeder til næste måned. En rigtig shop skal alligevel på Pro (Hobby er kun til ikke-kommercielt brug), og dér koster det ca. 0,05 USD pr. 1.000 billeder.

I WooCommerce-admin har varerne ingen udvalgt billede, fordi billederne ligger hos Guirca. Skal billederne ind i WordPress (f.eks. til Google Shopping), kan importen udvides til at hente dem. Det fylder ca. 1 MB pr. billede.

## Tests

`python3 -m unittest discover -s scripts/guirca` (kører også i CI) tester størrelser, priser, navne, kategorier, beskrivelser og samling af størrelser.
