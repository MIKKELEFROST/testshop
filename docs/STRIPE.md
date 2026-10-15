# Stripe

## Nøgler

Stripe Dashboard (slå **Test mode/Sandbox** til) → **Developers → API keys**:

- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` = `pk_test_…`
- `STRIPE_SECRET_KEY` = `sk_test_…`

Brug aldrig `sk_live_`/`pk_live_` i test- eller preview-miljøer.

Under **Settings → Payment methods** vælger du betalingsmetoder (kort, MobilePay, Klarna …). Payment Element viser automatisk dem, der er slået til, og som passer til beløb og valuta.

## Webhook (påkrævet)

Webhooken markerer ordrer som betalte, også hvis kunden lukker browseren lige efter betaling.

### På Vercel / offentlig URL

1. **Developers → Webhooks → Add endpoint**
2. Endpoint URL: `https://<din-butik>/api/stripe/webhook`
3. Events:
   - `payment_intent.succeeded`
   - `payment_intent.processing`
   - `payment_intent.payment_failed`
   - `payment_intent.canceled`
4. Kopiér **Signing secret** (`whsec_…`) til `STRIPE_WEBHOOK_SECRET`, og redeploy.

### Lokalt med Stripe CLI

```bash
stripe login
stripe listen --forward-to localhost:3000/api/stripe/webhook \
  --events payment_intent.succeeded,payment_intent.processing,payment_intent.payment_failed,payment_intent.canceled
# kopiér den viste whsec_… til STRIPE_WEBHOOK_SECRET i .env.local og genstart `npm run dev`
```

Uden webhook virker betalingen stadig, når kunden lander på bekræftelsessiden. Siden henter PaymentIntent fra Stripe og afslutter ordren. Webhooken er sikkerhedsnettet for alle andre tilfælde.

## Sådan behandles en webhook

1. Signaturen verificeres på den rå body. Ugyldig signatur giver 400.
2. PaymentIntent hentes **frisk** fra Stripe. Event-indholdet og rækkefølgen bruges ikke til beslutninger.
3. `metadata.store_id` skal matche butikken. Ellers ignoreres eventet, så flere butikker kan dele én Stripe-konto.
4. WooCommerce-pluginet anvender status under en ordrelås. Gentagelser er no-ops.
5. Fejl undervejs giver HTTP 500, og Stripe prøver igen med backoff i op til 3 dage.

## Testkort

| Kort | Resultat |
| --- | --- |
| `4242 4242 4242 4242` | Gennemføres |
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

## Refunderinger

Storefronten refunderer kun automatisk i to tilfælde: en dobbeltbetaling, eller en betaling for en vare, der i mellemtiden er udsolgt. Almindelige refunderinger laves i Stripe Dashboard. Ordrens status i WooCommerce opdateres manuelt indtil videre.
