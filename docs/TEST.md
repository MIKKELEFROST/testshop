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

Kørt 14. oktober 2026 i udviklingsmiljøet. **Bestået** betyder, at testen faktisk er kørt og bestået.

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
| **Rigtig Stripe-testbetaling** (Payment Element, 3-D Secure) | Manuelt, se nedenfor | **Ikke kørt** |
| **Forbindelse til test.piece.dk** | Manuelt | **Ikke kørt** |

De to sidste er ikke kørt, fordi udviklingsmiljøets netværkspolitik blokerede `test.piece.dk`, `api.stripe.com` og `js.stripe.com`. Alt andet er kørt mod en rigtig WooCommerce 11.1.2 lokalt.

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
