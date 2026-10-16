# Stripe

## Nøgler

Stripe Dashboard (slå **Test mode/Sandbox** til) → **Developers → API keys**:

- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` = `pk_test_…`
- `STRIPE_SECRET_KEY` = `sk_test_…`

Brug aldrig `sk_live_`/`pk_live_` i test- eller preview-miljøer.

Under **Settings → Payment methods** vælger du betalingsmetoder (kort, MobilePay, Klarna …). Payment Element viser automatisk dem, der er slået til, og som passer til beløb, valuta og reservation (se nedenfor).

## Webhook (påkrævet)

Webhooken reserverer ordrer (og markerer dem som betalte), også hvis kunden lukker browseren lige efter betalingen, fx i MobilePay-appen.

### På Vercel / offentlig URL

1. **Developers → Webhooks → Add endpoint**
2. Endpoint URL: `https://<din-butik>/api/stripe/webhook`
3. Events:
   - `payment_intent.amount_capturable_updated` (beløbet er reserveret, fra plugin 1.5)
   - `payment_intent.succeeded`
   - `payment_intent.processing`
   - `payment_intent.payment_failed`
   - `payment_intent.canceled`

   Har endpointet allerede de fire andre events, så tilføj `payment_intent.amount_capturable_updated` under **Developers → Webhooks → endpoint → Update details → Select events**. Uden den bliver en reservation kun registreret, når kunden kommer tilbage til bekræftelsessiden, og en ordre, kunden ikke kommer tilbage fra, annulleres efter "Hold lager"-tiden, mens beløbet står reserveret i op til 7 dage.
4. Kopiér **Signing secret** (`whsec_…`) til `STRIPE_WEBHOOK_SECRET`, og redeploy.

### Lokalt med Stripe CLI

```bash
stripe login
stripe listen --forward-to localhost:3000/api/stripe/webhook \
  --events payment_intent.amount_capturable_updated,payment_intent.succeeded,payment_intent.processing,payment_intent.payment_failed,payment_intent.canceled
# kopiér den viste whsec_… til STRIPE_WEBHOOK_SECRET i .env.local og genstart `npm run dev`
```

Uden webhook virker betalingen stadig, når kunden lander på bekræftelsessiden. Siden henter PaymentIntent fra Stripe og reserverer ordren. Webhooken er sikkerhedsnettet for alle andre tilfælde.

## Sådan behandles en webhook

1. Signaturen verificeres på den rå body. Ugyldig signatur giver 400.
2. PaymentIntent hentes **frisk** fra Stripe. Event-indholdet og rækkefølgen bruges ikke til beslutninger.
3. `metadata.store_id` skal matche butikken. Ellers ignoreres eventet, så flere butikker kan dele én Stripe-konto.
4. WooCommerce-pluginet anvender status under en ordrelås. Gentagelser er no-ops.
5. Fejl undervejs giver HTTP 500, og Stripe prøver igen med backoff i op til 3 dage.

## Reservation og træk ved afsendelse

Efter danske regler må et betalingskort som udgangspunkt først debiteres, når varen sendes. Shoppen **reserverer** derfor beløbet, når kunden betaler, og **trækker** det, når ordren markeres *Gennemført* i WooCommerce (se [WOOCOMMERCE.md](WOOCOMMERCE.md#12-reservation-og-træk-ved-afsendelse)).

- PaymentIntents oprettes med `capture_method: "manual"`, og Payment Element og Apple Pay/Google Pay-knapperne har `captureMethod: "manual"` (de skal passe sammen). Stripe viser så kun betalingsmetoder, der kan reserveres: kort, Apple Pay, Google Pay og Link, MobilePay, Klarna, PayPal, Revolut Pay og Amazon Pay. iDEAL, Bancontact, SEPA, Swish, TWINT, bankoverførsel m.fl. kan ikke og vises ikke.
- **Reservationens levetid** (Stripe, oktober 2026): onlinekortbetalinger 7 dage (Visa, Mastercard, American Express, Discover), og Stripe annullerer som standard en reservation, der ikke er trukket, 7 dage efter oprettelsen. MobilePay er en kortbetaling (7 dage), Klarna 28 dage, PayPal 10 dage (Stripe forlænger selv med 10). Shoppen advarer efter 5 dage.
- Reservationen registreres ved `payment_intent.amount_capturable_updated` (og på bekræftelsessiden): ordren står som *Afventer* med noten "Betalingen er reserveret og trækkes, når ordren sendes".
- **Træk:** når ordren er *Gennemført*, beder pluginet shoppen om at trække beløbet (`POST /api/payments/settle`). Shoppen læser ordren i WooCommerce og PaymentIntent i Stripe og trækker ordrens beløb minus refunderinger (`amount_to_capture`; resten frigives). Idempotency key pr. PaymentIntent, beløb og forsøg: samme forsøg kan aldrig trække to gange. Derefter står ordren som betalt med transaktions-ID og betalingsdato.
- **Frigivelse:** annulleres, refunderes eller fejler ordren, før den er sendt, annullerer shoppen PaymentIntent. Kunden betaler ingenting.
- **Udløbet** (Stripe annullerer selv en reservation): noteres på ordren, og butikken får en mail.
- **Dagligt sikkerhedsnet:** `/api/cron/settle-payments` (Vercel Cron) trækker og frigiver det, WordPress ikke kunne melde, og advarer om reservationer ældre end 5 dage. Se [DEPLOY.md](DEPLOY.md#træk-ved-afsendelse-cron_secret-og-callbacks).
- **Træk ikke selv i Stripe Dashboard** (Capture), før ordren er sendt. Gør du det alligevel, registreres ordren som betalt (*Behandler*).
- Ordrer betalt før denne ændring (trukket med det samme) behandles som før. Med et plugin før 1.5 kan WooCommerce ikke holde en reservation: så trækker shoppen beløbet med det samme, som før.
- **Kortudtog:** mange banker viser en reservation som en "afventende" postering. Den forsvinder, når beløbet trækkes eller frigives.

## Testkort

| Kort | Resultat |
| --- | --- |
| `4242 4242 4242 4242` | Reserveres (trækkes, når ordren markeres *Gennemført*) |
| `4000 0025 0000 3155` | Kræver 3-D Secure (godkend i pop-up) |
| `4000 0000 0000 9995` | Afvises (utilstrækkelige midler) |
| `4000 0000 0000 0002` | Afvises (generic decline) |

Brug enhver fremtidig udløbsdato, en vilkårlig CVC og et vilkårligt postnummer.

## Apple Pay og Google Pay ("Hurtig betaling")

Øverst i kassen viser Stripes Express Checkout Element knapperne Apple Pay og Google Pay. Kunden vælger adresse, fragt og e-mail i sin Wallet. Shoppen beregner pris, fragt og rabat i WooCommerce for den valgte adresse og opretter ordren gennem samme `/api/checkout` som formularen. Apple Pay og Google Pay vises derfor ikke også i betalingsfeltet længere nede.

- **Registrér domænet** i Stripe under **Settings → Payment method domains**, både i testtilstand og i live-tilstand. Det gælder hvert domæne, f.eks. `testshop-weld.vercel.app` og senere `piece.dk`. `testshop-weld.vercel.app` er registreret i testtilstand. Previews (`*-git-*.vercel.app`) er ikke registreret og viser derfor ikke knapperne.
- Knapperne står på `always`. Apple Pay vises derfor også i Chrome på Mac, hvor kunden betaler ved at scanne med sin iPhone, og før kunden har et kort i Wallet. Apple Pay vises aldrig på Windows og Android. Der vises Google Pay i stedet, hvor det er understøttet.
- I testtilstand kan du bruge dit rigtige kort i Wallet. Stripe trækker ingen penge.
- Ordren får betalingsmetoden "Apple Pay (Stripe)" eller "Google Pay (Stripe)".

## Kortudtog og kvitteringer

Begge butikker deler én Stripe-konto. Hver betaling sender derfor butikkens eget suffiks til kortudtoget (`statementDescriptorSuffix` i `src/config/store.ts`: `FASTELAVN` og `HALLOWEEN`). Stripe sætter det efter kontoens forkortede beskrivelse, så kunden ser fx `PREFIX* HALLOWEEN`.

- Sæt den forkortede beskrivelse (2–10 tegn) under **Settings → Business → Public details → Shortened descriptor**, i live-tilstand. Vælg en neutral tekst, der passer til begge butikker. Prefix, `* ` og suffiks må højst være 22 tegn tilsammen. Suffikset er højst 10 tegn, så det altid passer.
- Sæt også det offentlige firmanavn og support-e-mailen samme sted. MobilePay viser kontoens navn.
- Storefronten sender ikke `receipt_email` med betalingen, og der oprettes ingen Stripe-kunde. Stripe sender derfor ingen egen kvittering med kontoens navn. Kunden får WooCommerces ordrebekræftelse med butikkens navn.

## Refunderinger

Før ordren er sendt, er der intet at refundere: annullér ordren i WooCommerce, så frigives reservationen. Kan en del af ordren ikke sendes, så refundér den del i WooCommerce (**Refunder** → **Refunder manuelt**), før ordren markeres *Gennemført*: så trækkes kun resten.

Storefronten refunderer kun automatisk, når en betaling ikke kan beholdes: en dobbeltbetaling, en betaling for en vare, der i mellemtiden er udsolgt, eller et træk, der nåede at ske, efter ordren blev annulleret. En ekstra reservation frigives i stedet. Almindelige refunderinger efter afsendelse laves i Stripe Dashboard. Ordrens status i WooCommerce opdateres manuelt indtil videre.
