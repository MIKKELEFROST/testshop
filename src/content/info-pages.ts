/**
 * Danish information and legal pages for the costume webshops (Fastelavnskostumer.dk and
 * Halloweenkostumer.dk), which share this codebase. Content only: the pages, components and
 * routes that show it live elsewhere.
 *
 * DRAFT, NOT LEGAL ADVICE: the texts are drafts based on the general Danish rules for web shops
 * (forbrugeraftaleloven, købeloven, GDPR/databeskyttelsesloven, bogføringsloven and the cookie
 * rules). The owner should have them reviewed, e.g. by a lawyer, before the shops go live.
 *
 * Tokens. They are filled in when the page is shown. The owner enters the company details in
 * src/config/company.ts:
 *   {firma}         company name
 *   {cvr}           CVR number
 *   {adresse}       company address
 *   {telefon}       phone number
 *   {email}         customer service email
 *   {åbningstider}  customer service opening hours
 *   {shop}          the shop's name, e.g. "Fastelavnskostumer.dk"
 *   {fri_fragt}     free shipping threshold, e.g. "599 kr."
 *   {returadresse}  return address
 *
 * Owner decisions are tokens too, filled in from src/config/company.ts:
 *   {returfragt}         who pays the return shipping (handelsbetingelser, fortrydelsesret)
 *   {uafhentede_pakker}  what happens with unclaimed parcels (fragt-og-levering)
 *   {prismatch_dage}     days after a purchase that the price match applies (prismatch)
 *   {svartid}            the answer time for emails (kontakt)
 *
 * Text format: links are written as [link text](/path), [link text](mailto:{email}) or
 * [link text](https://…). There is no other markup.
 */
export type InfoBlock =
  | { type: "p"; text: string }
  | { type: "list"; items: string[] }
  | { type: "steps"; items: string[] } // numbered
  | { type: "table"; head: string[]; rows: string[][] };

export type InfoSection = { heading: string; blocks: InfoBlock[] };

export type InfoPage = {
  slug: string;
  title: string;
  /** Meta description, max ~155 characters. */
  description: string;
  /** One or two sentences shown under the title. */
  intro: string;
  sections: InfoSection[];
};

const RETURFRAGT = "{returfragt}";

const EMAIL_LINK = "[{email}](mailto:{email})";

const SELLING_POINTS: InfoBlock = {
  type: "list",
  items: [
    "Lynhurtig 1-dags levering – bestil før kl. 19",
    "Fri fragt ved {fri_fragt}",
    "30 dages returret",
    "100% prismatch",
    "+500.000 glade kunder",
    "Bedømt som Fremragende – +30.000 femstjernede anmeldelser",
  ],
};

/** Pages shared by both shops. "om-os" is in OM_OS below, per shop. */
export const INFO_PAGES: InfoPage[] = [
  {
    slug: "handelsbetingelser",
    title: "Handelsbetingelser",
    description:
      "Handelsbetingelser for {shop}: priser, betaling, levering, 30 dages returret, fortrydelsesret, reklamation og klagemuligheder.",
    intro: "Her kan du læse de betingelser, der gælder, når du handler hos {shop}. Har du spørgsmål, er du altid velkommen til at kontakte os.",
    sections: [
      {
        heading: "Sælger",
        blocks: [
          { type: "p", text: "{shop} drives af:" },
          { type: "list", items: ["{firma}", "{adresse}", "CVR-nr.: {cvr}", "Telefon: {telefon}", `E-mail: ${EMAIL_LINK}`] },
          {
            type: "p",
            text: "Betingelserne gælder for alle køb på {shop}, når du handler som forbruger. Aftalen indgås på dansk.",
          },
        ],
      },
      {
        heading: "Priser og moms",
        blocks: [
          { type: "p", text: "Alle priser er i danske kroner (DKK) og inklusive 25 % moms." },
          {
            type: "p",
            text: "Fragten kommer oveni og afhænger af den leveringsform, du vælger. Du ser den samlede pris inklusive fragt i kassen, før du betaler. Se priserne under [Fragt og levering](/fragt-og-levering).",
          },
          {
            type: "p",
            text: "Finder du den samme vare billigere i en anden dansk webshop, matcher vi prisen. Læs mere om [100% prismatch](/prismatch).",
          },
          {
            type: "p",
            text: "Vi tager forbehold for åbenlyse fejl i priser og varebeskrivelser. Opdager vi en åbenlys fejl efter din bestilling, kontakter vi dig. Hvis købet bliver annulleret, får du alle pengene tilbage.",
          },
        ],
      },
      {
        heading: "Varer og produktinformation",
        blocks: [
          {
            type: "p",
            text: "Vi gør vores bedste for at vise varerne korrekt. Farver kan dog se lidt anderledes ud på din skærm end i virkeligheden.",
          },
          {
            type: "p",
            text: "Tilbehør, der ses på produktbillederne – fx paryk, sko eller rekvisitter – følger kun med, hvis det står i varebeskrivelsen.",
          },
        ],
      },
      {
        heading: "Bestilling og aftale",
        blocks: [
          { type: "p", text: "Sådan bestiller du:" },
          {
            type: "steps",
            items: [
              "Læg varerne i kurven.",
              "Gå til kassen, og udfyld dine oplysninger.",
              "Vælg leveringsform og betalingsmetode.",
              "Kontrollér din ordre. Du kan rette fejl i kurven og i kassen, indtil du betaler.",
              "Gennemfør betalingen.",
            ],
          },
          {
            type: "p",
            text: "Når betalingen er gennemført, sender vi en ordrebekræftelse til din e-mail. Aftalen er indgået, når vi har sendt ordrebekræftelsen.",
          },
          {
            type: "p",
            text: "Tjek ordrebekræftelsen, og kontakt os hurtigst muligt, hvis noget er forkert. Har du ikke fået den, så kig i dit spamfilter – og skriv ellers til os.",
          },
          {
            type: "p",
            text: "Vi gemmer din ordre. De gældende betingelser kan du altid læse her på siden. Vi anbefaler, at du gemmer eller udskriver dem.",
          },
          {
            type: "p",
            text: "Er en vare mod forventning udsolgt, efter du har bestilt, kontakter vi dig. Kan vi ikke levere varen, får du pengene for den tilbage.",
          },
        ],
      },
      {
        heading: "Betaling",
        blocks: [
          {
            type: "p",
            text: "Du betaler sikkert med kort eller mobil betaling. Betalingen behandles af Stripe, som lever op til betalingskortbranchens sikkerhedsstandard (PCI DSS). Vi ser aldrig dine kortoplysninger.",
          },
          { type: "p", text: "Afhængigt af din enhed kan du betale med:" },
          { type: "list", items: ["Visa", "Mastercard", "MobilePay", "Apple Pay", "Google Pay"] },
          { type: "p", text: "Beløbet trækkes, når du gennemfører bestillingen. Vi bekræfter din ordre på e-mail." },
          {
            type: "p",
            text: "Fortryder du købet, eller får du medhold i en reklamation, betaler vi pengene tilbage til det betalingsmiddel, du brugte.",
          },
        ],
      },
      {
        heading: "Levering",
        blocks: [
          {
            type: "p",
            text: "Vi leverer kun i Danmark – til pakkeshop eller til døren. Du vælger selv fragtfirma og leveringsform i kassen. Vi leverer ikke til Færøerne og Grønland.",
          },
          {
            type: "p",
            text: "Bestiller du på en hverdag (mandag–fredag) før kl. 19, sender vi din ordre samme dag. Bestillinger efter kl. 19, i weekenden og på helligdage sender vi den næste hverdag. Vi kan ikke love en bestemt leveringsdato, da selve leveringen sker hos fragtfirmaet.",
          },
          {
            type: "p",
            text: "Varen er vores ansvar, indtil du har modtaget den. Læs mere om priser, sporing og uafhentede pakker under [Fragt og levering](/fragt-og-levering).",
          },
        ],
      },
      {
        heading: "Fortrydelsesret og 30 dages returret",
        blocks: [
          {
            type: "p",
            text: "Som forbruger har du 14 dages fortrydelsesret efter forbrugeraftaleloven. Hos os får du 30 dages returret, som gælder på samme vilkår. Fristen regnes fra den dag, du modtager varen.",
          },
          {
            type: "p",
            text: `Giv os besked på ${EMAIL_LINK}, før fristen udløber. Send derefter varen retur senest 14 dage efter, at du har givet besked.`,
          },
          { type: "p", text: RETURFRAGT },
          {
            type: "p",
            text: "Forseglede hygiejnevarer som make-up og ansigtsmaling kan ikke returneres, når forseglingen er brudt. Læs hele vejledningen, undtagelserne og standardfortrydelsesformularen under [Returret og fortrydelse](/fortrydelsesret).",
          },
        ],
      },
      {
        heading: "Reklamation",
        blocks: [
          {
            type: "p",
            text: "Du har 24 måneders reklamationsret efter købeloven. Det betyder, at du kan klage over fejl og mangler, der var til stede, da du modtog varen, i op til 24 måneder fra levering. Viser en fejl sig inden for det første år efter levering, formodes den at have været der fra starten, medmindre andet kan påvises.",
          },
          {
            type: "p",
            text: "Du skal klage inden for rimelig tid, efter du har opdaget fejlen. Klager du inden for 2 måneder, er det altid rettidigt.",
          },
          { type: "p", text: "Sådan reklamerer du:" },
          {
            type: "steps",
            items: [
              `Skriv til os på ${EMAIL_LINK} med dit ordrenummer.`,
              "Beskriv fejlen, og vedhæft gerne billeder.",
              "Vi svarer dig og fortæller, hvordan du sender varen til os, hvis det er nødvendigt. Vent med at sende varen, til du har hørt fra os.",
            ],
          },
          {
            type: "p",
            text: "Er reklamationen berettiget, reparerer eller ombytter vi varen, giver et afslag i prisen eller betaler pengene tilbage – afhængigt af situationen og reglerne i købeloven. Vi dækker dine rimelige udgifter til returfragt.",
          },
          {
            type: "p",
            text: "Reklamationsretten dækker ikke almindeligt slid eller skader, der skyldes forkert brug, uheld eller vask i strid med vaskeanvisningen.",
          },
        ],
      },
      {
        heading: "Klagemuligheder",
        blocks: [
          {
            type: "p",
            text: `Er du utilfreds med dit køb, så kontakt os først på ${EMAIL_LINK}. Vi vil gerne finde en løsning sammen med dig.`,
          },
          {
            type: "p",
            text: "Finder vi ikke en løsning, kan du klage til Nævnenes Hus. Klagen behandles først af Center for Klageløsning, som hjælper dig og os med at finde en løsning. Lykkes det ikke, kan sagen gå videre til Forbrugerklagenævnet. Du klager via [naevneneshus.dk](https://www.naevneneshus.dk).",
          },
        ],
      },
      {
        heading: "Persondata",
        blocks: [
          {
            type: "p",
            text: "Vi behandler kun de oplysninger, der er nødvendige for at levere din ordre og hjælpe dig. Læs mere i vores [privatlivspolitik](/privatlivspolitik) og [cookiepolitik](/cookiepolitik).",
          },
        ],
      },
      {
        heading: "Varer mærket 18+",
        blocks: [
          {
            type: "p",
            text: "Varer, der er mærket 18+, sælges kun til kunder, der er fyldt 18 år. Når du bestiller en vare mærket 18+, bekræfter du, at du er fyldt 18 år.",
          },
          {
            type: "p",
            text: "Har vi grund til at tro, at køberen er under 18 år, kan vi annullere ordren og betale beløbet tilbage.",
          },
        ],
      },
      {
        heading: "Force majeure",
        blocks: [
          {
            type: "p",
            text: "Vi er ikke ansvarlige for forsinkelser eller manglende levering, der skyldes forhold uden for vores kontrol. Det kan fx være krig, naturkatastrofer, ekstremt vejr, epidemier, strejke, brand, nedbrud hos fragtfirmaer eller leverandører eller offentlige påbud.",
          },
          {
            type: "p",
            text: "Kan vi ikke levere, har du altid ret til at hæve købet og få pengene tilbage. Dine ufravigelige rettigheder som forbruger påvirkes ikke.",
          },
        ],
      },
      {
        heading: "Ændringer af betingelserne",
        blocks: [
          {
            type: "p",
            text: "Vi kan ændre disse betingelser. Ændringer gælder kun for køb, der foretages, efter ændringen er offentliggjort her på siden. Dit køb er altid omfattet af de betingelser, der gjaldt, da du bestilte.",
          },
        ],
      },
    ],
  },

  {
    slug: "fortrydelsesret",
    title: "Returret og fortrydelse",
    description:
      "30 dages returret hos {shop}. Sådan fortryder og returnerer du, hvornår du får pengene tilbage – og standardfortrydelsesformularen.",
    intro: "Fortryder du dit køb, eller passer kostumet ikke? Hos os har du 30 dages returret – mere end de 14 dage, loven kræver.",
    sections: [
      {
        heading: "Kort fortalt",
        blocks: [
          {
            type: "list",
            items: [
              "Du har 30 dages returret fra den dag, du modtager varen.",
              `Giv os besked på ${EMAIL_LINK} inden for fristen.`,
              "Send varen retur senest 14 dage efter, at du har givet besked.",
              "Send kostumer retur ubrugte, med mærker på og så vidt muligt i den originale emballage.",
              "Du får pengene tilbage senest 14 dage efter din besked. Vi kan dog vente, til vi har fået varen retur.",
              "Forseglede hygiejnevarer kan ikke returneres, når forseglingen er brudt.",
            ],
          },
        ],
      },
      {
        heading: "Din fortrydelsesret efter loven: 14 dage",
        blocks: [
          {
            type: "p",
            text: "Når du handler på nettet som forbruger, har du 14 dages fortrydelsesret efter forbrugeraftaleloven. Du kan fortryde uden at give en grund.",
          },
          {
            type: "p",
            text: "Fristen udløber 14 dage efter den dag, hvor du – eller en anden, du har udpeget (ikke fragtfirmaet) – får varen i fysisk besiddelse. Har du bestilt flere varer i én ordre, og bliver de leveret hver for sig, regnes fristen fra den dag, du modtager den sidste vare.",
          },
          {
            type: "p",
            text: "Udløber fristen på en helligdag, en lørdag, grundlovsdag, juleaftensdag eller nytårsaftensdag, forlænges den til den følgende hverdag.",
          },
        ],
      },
      {
        heading: "Vores 30 dages returret",
        blocks: [
          {
            type: "p",
            text: "Hos {shop} forlænger vi fristen fra 14 til 30 dage. Returretten gælder på samme vilkår som fortrydelsesretten – du har bare længere tid. Fristen regnes på samme måde: fra den dag, du modtager varen.",
          },
          { type: "p", text: "Den forlængede returret er et tilbud fra os. Den begrænser ikke dine rettigheder efter loven." },
        ],
      },
      {
        heading: "Sådan giver du besked",
        blocks: [
          {
            type: "p",
            text: `Skriv til os på ${EMAIL_LINK}, før fristen udløber. Skriv dit ordrenummer, og hvilke varer du vil sende retur.`,
          },
          {
            type: "p",
            text: "Du kan bruge standardfortrydelsesformularen nederst på siden, men det er ikke et krav. Det vigtigste er, at det tydeligt fremgår, at du vil fortryde købet.",
          },
          {
            type: "p",
            text: "Det er ikke nok at nægte at modtage pakken eller lade være med at hente den. Du skal give os besked.",
          },
        ],
      },
      {
        heading: "Sådan returnerer du – trin for trin",
        blocks: [
          {
            type: "steps",
            items: [
              `Giv os besked på ${EMAIL_LINK} inden for 30 dage fra den dag, du modtog varen.`,
              "Pak varen forsvarligt – gerne i den originale emballage – og læg en seddel med dit ordrenummer i pakken.",
              "Send pakken til: {returadresse}",
              "Send pakken senest 14 dage efter, at du har givet os besked. Brug en forsendelse med sporing, og gem kvitteringen, til du har fået dine penge.",
              "Når vi har modtaget varen, betaler vi pengene tilbage til det betalingsmiddel, du brugte.",
            ],
          },
        ],
      },
      {
        heading: "Returfragt",
        blocks: [
          { type: "p", text: RETURFRAGT },
          {
            type: "p",
            text: "Er varen defekt, eller har vi sendt en forkert vare, betaler vi returfragten. Læs om reklamation i vores [handelsbetingelser](/handelsbetingelser).",
          },
        ],
      },
      {
        heading: "Varens stand",
        blocks: [
          {
            type: "p",
            text: "Du må gerne prøve kostumet på, som du ville gøre i en butik. Send det retur ubrugt, med mærker på og så vidt muligt i den originale emballage. Det må altså ikke have været vasket eller brugt til fest.",
          },
          {
            type: "p",
            text: "Du hæfter for en eventuel forringelse af varens værdi, som skyldes, at du har håndteret varen mere, end hvad der er nødvendigt for at fastslå dens art, egenskaber og funktion. I så fald kan vi trække værdiforringelsen fra det beløb, du får tilbage.",
          },
        ],
      },
      {
        heading: "Undtagelser: hygiejnevarer",
        blocks: [
          {
            type: "p",
            text: "Nogle varer kan af hygiejniske eller sundhedsmæssige årsager ikke returneres, når forseglingen eller emballagen er brudt. Det gælder, når det fremgår af varen eller produktsiden, fx:",
          },
          {
            type: "list",
            items: [
              "Make-up og ansigtsmaling",
              "Kunstige tænder og gebisser",
              "Kunstige negle og vipper",
              "Masker, der bæres direkte mod ansigtet",
            ],
          },
          {
            type: "p",
            text: "Forseglede hygiejnevarer kan ikke returneres, når de er åbnet. Uåbnede varer med ubrudt forsegling kan du returnere som alle andre varer.",
          },
        ],
      },
      {
        heading: "Tilbagebetaling",
        blocks: [
          {
            type: "p",
            text: "Fortryder du købet, betaler vi alle betalinger tilbage, som vi har modtaget fra dig. Det gælder også fragten for den billigste standardlevering, vi tilbyder. Har du valgt en dyrere leveringsform, fx levering til døren, betaler vi ikke forskellen tilbage.",
          },
          { type: "p", text: "Sender du kun en del af ordren retur, får du pengene tilbage for de varer, du returnerer." },
          {
            type: "p",
            text: "Vi betaler pengene tilbage hurtigst muligt og senest 14 dage efter den dag, vi har modtaget din besked om, at du vil fortryde. Vi bruger det samme betalingsmiddel, som du brugte ved købet, medmindre du udtrykkeligt har aftalt andet med os. Du betaler ikke gebyrer for tilbagebetalingen.",
          },
          {
            type: "p",
            text: "Vi kan vente med at betale tilbage, til vi har modtaget varen, eller til du har vist dokumentation for, at du har sendt den – alt efter hvad der sker først.",
          },
          { type: "p", text: "Har varen fået en værdiforringelse, trækker vi den fra beløbet. Se \"Varens stand\" ovenfor." },
        ],
      },
      {
        heading: "Bytte til en anden størrelse eller vare",
        blocks: [
          {
            type: "p",
            text: "Vi bytter ikke direkte. Vil du have en anden størrelse, en anden farve eller et helt andet kostume, så send varen retur som beskrevet ovenfor, og læg en ny ordre.",
          },
          {
            type: "p",
            text: "Skal du bruge kostumet til en bestemt dag, så bestil den nye størrelse med det samme. Så får du den hurtigst muligt, og vi betaler pengene for den returnerede vare tilbage, når vi har modtaget den.",
          },
          { type: "p", text: "I tvivl om størrelsen? Se vores [størrelsesguide](/stoerrelsesguide)." },
        ],
      },
      {
        heading: "Standardfortrydelsesformular",
        blocks: [
          {
            type: "p",
            text: `Vil du bruge formularen, så kopiér teksten ind i en e-mail, udfyld den, og send den til ${EMAIL_LINK}. Skriv gerne også dit ordrenummer, så vi hurtigt kan finde din ordre.`,
          },
          { type: "p", text: "(Denne formular udfyldes og returneres kun, hvis fortrydelsesretten gøres gældende)" },
          {
            type: "list",
            items: [
              "Til {firma}, {adresse}, {email}:",
              "Jeg/vi (*) meddeler herved, at jeg/vi (*) ønsker at gøre den fortrydelsesret gældende, der gælder for min/vores (*) købsaftale om følgende varer (*)/levering af følgende tjenesteydelser (*):",
              "Bestilt den (*)/modtaget den (*):",
              "Forbrugerens/forbrugernes navn:",
              "Forbrugerens/forbrugernes adresse:",
              "Forbrugerens/forbrugernes underskrift (kun hvis formularens indhold meddeles på papir):",
              "Dato:",
            ],
          },
          { type: "p", text: "(*) Det ikke-relevante udstreges." },
        ],
      },
    ],
  },

  {
    slug: "fragt-og-levering",
    title: "Fragt og levering",
    description:
      "Lynhurtig 1-dags levering: bestil før kl. 19 på hverdage, så sender vi samme dag. Pakkeshop fra 39 kr. og fri fragt ved {fri_fragt}.",
    intro: "Bestil på en hverdag før kl. 19, så sender vi din ordre samme dag. Du vælger selv, om pakken skal til en pakkeshop eller helt hjem til døren.",
    sections: [
      {
        heading: "Leveringsformer og priser",
        blocks: [
          { type: "p", text: "Du vælger fragtfirma og leveringsform i kassen. Alle priser er inklusive moms." },
          {
            type: "list",
            items: [
              "PostNord til nærmeste pakkeshop: 39 kr.",
              "GLS til nærmeste pakkeshop: 39 kr.",
              "DAO til nærmeste pakkeshop: 39 kr.",
              "DAO levering til døren: 49 kr.",
              "GLS levering til døren: 59 kr.",
            ],
          },
        ],
      },
      {
        heading: "Fri fragt ved {fri_fragt}",
        blocks: [
          {
            type: "p",
            text: "Handler du for mindst {fri_fragt}, er levering til pakkeshop gratis – uanset om du vælger PostNord, GLS eller DAO.",
          },
          { type: "p", text: "Vælger du levering til døren, betaler du den normale pris for den." },
        ],
      },
      {
        heading: "Lynhurtig 1-dags levering – bestil før kl. 19",
        blocks: [
          {
            type: "list",
            items: [
              "Bestiller du mandag–fredag før kl. 19, sender vi din ordre samme dag.",
              "Bestiller du på en hverdag efter kl. 19, sender vi den næste hverdag.",
              "Bestiller du i weekenden eller på en helligdag, sender vi den næste hverdag.",
            ],
          },
          {
            type: "p",
            text: "Herefter er det fragtfirmaet, der leverer pakken – som regel allerede hverdagen efter. Vi kan ikke love en bestemt leveringsdato, da leveringstiden afhænger af fragtfirmaet.",
          },
          {
            type: "p",
            text: "Skal du bruge kostumet til en bestemt dag, så bestil i god tid – især op til fastelavn og halloween, hvor fragtfirmaerne har travlt.",
          },
        ],
      },
      {
        heading: "Vi leverer i Danmark",
        blocks: [
          {
            type: "p",
            text: "Vi leverer kun til adresser og pakkeshops i Danmark. Vi sender ikke til Færøerne, Grønland eller udlandet.",
          },
        ],
      },
      {
        heading: "Følg din pakke",
        blocks: [
          {
            type: "p",
            text: "Når din pakke er sendt, får du en e-mail eller sms fra fragtfirmaet med et link, så du kan følge den. Fragtfirmaet giver dig også besked, når pakken er klar til afhentning eller på vej til dig.",
          },
          { type: "p", text: "Har du ikke fået en besked? Kig i dit spamfilter, eller [kontakt os](/kontakt) med dit ordrenummer." },
        ],
      },
      {
        heading: "Uafhentede pakker",
        blocks: [
          {
            type: "p",
            text: "Henter du ikke pakken inden for pakkeshoppens afhentningsfrist, sender fragtfirmaet den retur til os. Fristen står i beskeden fra fragtfirmaet.",
          },
          {
            type: "p",
            text: "Når pakken er kommet retur, betaler vi pengene for varerne tilbage. {uafhentede_pakker}",
          },
          { type: "p", text: "Vil du hellere have pakken sendt igen, så [kontakt os](/kontakt), så finder vi en løsning." },
        ],
      },
      {
        heading: "Er pakken beskadiget?",
        blocks: [
          {
            type: "p",
            text: "Tjek pakken, når du modtager den. Er den tydeligt beskadiget, så tag billeder af pakken og indholdet.",
          },
          {
            type: "p",
            text: `Kontakt os hurtigst muligt på ${EMAIL_LINK} med dit ordrenummer og billederne. Skader fra transporten er vores ansvar, og vi sørger for en løsning – fx en ny vare eller pengene tilbage.`,
          },
          { type: "p", text: "Opdager du først skaden senere, har du stadig din reklamationsret." },
        ],
      },
      {
        heading: "Mangler der noget i pakken?",
        blocks: [
          {
            type: "p",
            text: `Mangler der en vare, eller har du fået en forkert vare, så skriv til os på ${EMAIL_LINK} med dit ordrenummer. Så retter vi fejlen hurtigst muligt.`,
          },
        ],
      },
    ],
  },

  {
    slug: "privatlivspolitik",
    title: "Privatlivspolitik",
    description:
      "Sådan behandler {shop} dine personoplysninger: hvad vi gemmer, hvorfor, hvem vi deler dem med, hvor længe – og dine rettigheder.",
    intro: "Vi passer godt på dine oplysninger. Vi indsamler kun det, vi har brug for til at levere din ordre og hjælpe dig – og vi sender ingen nyhedsbreve og laver ingen profilering.",
    sections: [
      {
        heading: "Dataansvarlig",
        blocks: [
          {
            type: "p",
            text: "{firma} er dataansvarlig for behandlingen af de personoplysninger, vi modtager om dig på {shop}.",
          },
          { type: "list", items: ["{firma}", "{adresse}", "CVR-nr.: {cvr}", `E-mail: ${EMAIL_LINK}`, "Telefon: {telefon}"] },
        ],
      },
      {
        heading: "Oplysninger, vi behandler",
        blocks: [
          { type: "p", text: "Når du bestiller, behandler vi:" },
          {
            type: "list",
            items: ["Navn", "Adresse", "E-mail", "Telefonnummer", "Hvad du har bestilt", "Om betalingen er gennemført"],
          },
          { type: "p", text: "Vi får aldrig dine kortoplysninger. De går direkte til vores betalingsudbyder, Stripe." },
          { type: "p", text: "Skriver du til kundeservice, behandler vi de oplysninger, du giver os i din henvendelse." },
          {
            type: "p",
            text: "Når du besøger webshoppen, behandler vores hostingudbyder tekniske oplysninger som din IP-adresse og browsertype. Det er nødvendigt for at kunne vise siden og beskytte den mod misbrug. Vi bruger ikke oplysningerne til at genkende eller følge dig.",
          },
          {
            type: "p",
            text: "Din indkøbskurv og din favoritliste gemmes i din egen browser – ikke hos os. Indholdet af kurven får vi først, når du går til kassen. Læs mere i vores [cookiepolitik](/cookiepolitik).",
          },
          {
            type: "p",
            text: "Du har ikke pligt til at give os oplysningerne. Men uden navn, adresse og kontaktoplysninger kan vi ikke levere din ordre.",
          },
        ],
      },
      {
        heading: "Formål og retsgrundlag",
        blocks: [
          {
            type: "table",
            head: ["Formål", "Oplysninger", "Retsgrundlag"],
            rows: [
              [
                "Levere din ordre, herunder betaling og forsendelse",
                "Navn, adresse, e-mail, telefon, ordreindhold og betalingsstatus",
                "Opfyldelse af aftalen med dig (GDPR artikel 6, stk. 1, litra b)",
              ],
              [
                "Bogføring",
                "Ordre- og betalingsoplysninger",
                "Retlig forpligtelse efter bogføringsloven (artikel 6, stk. 1, litra c)",
              ],
              [
                "Kundeservice, returnering og reklamation",
                "Dine henvendelser og ordreoplysninger",
                "Opfyldelse af aftalen (artikel 6, stk. 1, litra b) og vores legitime interesse i at kunne besvare dig (artikel 6, stk. 1, litra f)",
              ],
              [
                "Drift og sikkerhed af webshoppen",
                "Tekniske oplysninger som IP-adresse og browsertype",
                "Vores legitime interesse i en sikker webshop, der virker (artikel 6, stk. 1, litra f)",
              ],
            ],
          },
        ],
      },
      {
        heading: "Betaling",
        blocks: [
          {
            type: "p",
            text: "Betalinger behandles af Stripe, som lever op til betalingskortbranchens sikkerhedsstandard (PCI DSS). Stripe modtager de oplysninger, der er nødvendige for at gennemføre og sikre betalingen. Vi ser aldrig dit kortnummer.",
          },
          {
            type: "p",
            text: "Stripe er selvstændig dataansvarlig for at sikre betalingen og forebygge svindel. Læs mere i Stripes privatlivspolitik på [stripe.com/privacy](https://stripe.com/privacy).",
          },
          {
            type: "p",
            text: "Betaler du med MobilePay, Apple Pay eller Google Pay, behandler udbyderen også oplysninger efter sine egne vilkår.",
          },
        ],
      },
      {
        heading: "Hvem vi deler oplysningerne med",
        blocks: [
          {
            type: "p",
            text: "Vi sælger aldrig dine oplysninger. Vi deler dem kun med de virksomheder, der hjælper os med at drive webshoppen og levere din ordre:",
          },
          {
            type: "list",
            items: [
              "Vores webhotel, hvor ordresystemet (WooCommerce) kører, og hvor dine ordrer gemmes.",
              "Vercel, som hoster webshoppen.",
              "Stripe, som behandler betalingen.",
              "Det fragtfirma, du vælger (PostNord, GLS eller DAO). Fragtfirmaet får dit navn, din adresse, dit telefonnummer og din e-mail, så det kan levere pakken og give dig besked undervejs.",
              "Vores e-mailudbyder, som sender ordrebekræftelser og håndterer vores e-mails med kundeservice.",
            ],
          },
          {
            type: "p",
            text: "Webhotellet, Vercel og vores e-mailudbyder er databehandlere. De må kun behandle oplysningerne på vores vegne og efter vores instruks.",
          },
          { type: "p", text: "Vi videregiver også oplysninger, hvis loven kræver det, fx til offentlige myndigheder." },
        ],
      },
      {
        heading: "Overførsel til lande uden for EU",
        blocks: [
          {
            type: "p",
            text: "Vercel behandler oplysninger i EU og USA. Overførslen til USA sker på grundlag af EU-Kommissionens standardkontraktbestemmelser, som skal sikre, at dine oplysninger er beskyttet lige så godt som i EU.",
          },
          { type: "p", text: "Stripe kan også overføre oplysninger til lande uden for EU. Det er beskrevet i Stripes privatlivspolitik." },
        ],
      },
      {
        heading: "Hvor længe vi gemmer oplysningerne",
        blocks: [
          {
            type: "list",
            items: [
              "Ordreoplysninger gemmer vi i 5 år fra udgangen af det regnskabsår, ordren hører til – altså det indeværende regnskabsår plus 5 år. Det kræver bogføringsloven.",
              "E-mails med kundeservice gemmer vi i 2 år.",
              "Tekniske oplysninger fra dit besøg gemmes kun, så længe det er nødvendigt for drift og sikkerhed.",
            ],
          },
          { type: "p", text: "Derefter sletter vi oplysningerne." },
        ],
      },
      {
        heading: "Ingen nyhedsbreve og ingen profilering",
        blocks: [
          {
            type: "p",
            text: "Vi sender ikke nyhedsbreve og bruger ikke dine oplysninger til markedsføring. Vi laver ingen profilering af dig.",
          },
        ],
      },
      {
        heading: "Cookies",
        blocks: [
          {
            type: "p",
            text: "Vi bruger ingen cookies til statistik, markedsføring eller sporing. Læs mere i vores [cookiepolitik](/cookiepolitik).",
          },
        ],
      },
      {
        heading: "Dine rettigheder",
        blocks: [
          { type: "p", text: "Efter databeskyttelsesforordningen (GDPR) har du en række rettigheder:" },
          {
            type: "list",
            items: [
              "Ret til indsigt: Du kan få at vide, hvilke oplysninger vi har om dig, og få en kopi af dem.",
              "Ret til berigtigelse: Du kan få rettet forkerte oplysninger.",
              "Ret til sletning: Du kan få slettet dine oplysninger, medmindre vi skal gemme dem, fx efter bogføringsloven.",
              "Ret til begrænsning: Du kan i visse tilfælde få begrænset vores behandling af dine oplysninger.",
              "Ret til dataportabilitet: Du kan få de oplysninger, du har givet os, i et almindeligt, maskinlæsbart format.",
              "Ret til indsigelse: Du kan gøre indsigelse mod behandling, der sker på grundlag af vores legitime interesse.",
            ],
          },
          {
            type: "p",
            text: `Skriv til os på ${EMAIL_LINK}, hvis du vil bruge dine rettigheder. Vi svarer senest inden for en måned.`,
          },
        ],
      },
      {
        heading: "Klage til Datatilsynet",
        blocks: [
          {
            type: "p",
            text: "Er du utilfreds med, hvordan vi behandler dine oplysninger, kan du klage til Datatilsynet på [datatilsynet.dk](https://www.datatilsynet.dk). Du er også altid velkommen til at kontakte os først.",
          },
        ],
      },
      {
        heading: "Ændringer",
        blocks: [
          {
            type: "p",
            text: "Vi opdaterer privatlivspolitikken, hvis vi ændrer måden, vi behandler oplysninger på. Den nyeste version står altid her på siden.",
          },
        ],
      },
    ],
  },

  {
    slug: "cookiepolitik",
    title: "Cookiepolitik",
    description:
      "{shop} bruger ingen cookies til statistik eller markedsføring. Se, hvad der gemmes i din browser, og hvorfor.",
    intro: "Kort fortalt: Vi bruger ingen cookies til statistik, markedsføring eller sporing. Derfor ser du heller ikke et cookiebanner hos os.",
    sections: [
      {
        heading: "Hvad er cookies?",
        blocks: [
          {
            type: "p",
            text: "En cookie er en lille tekstfil, som en hjemmeside gemmer i din browser. Lignende teknologier, fx browserens lokale lager (localStorage), fungerer på samme måde, og reglerne om cookies gælder for dem alle.",
          },
          {
            type: "p",
            text: "Efter de danske cookieregler må en hjemmeside gerne gemme oplysninger, der er strengt nødvendige for at levere en tjeneste, du selv har bedt om – fx en indkøbskurv. Til alt andet skal hjemmesiden først have dit samtykke.",
          },
        ],
      },
      {
        heading: "Det gemmes i din browser",
        blocks: [
          {
            type: "table",
            head: ["Hvad", "Formål", "Fra", "Hvor længe"],
            rows: [
              [
                "Indkøbskurv (localStorage)",
                "Husker de varer, du har lagt i kurven",
                "{shop}",
                "Til du tømmer kurven eller sletter dine browserdata",
              ],
              [
                "Favoritliste (localStorage)",
                "Husker de varer, du har gemt som favoritter",
                "{shop}",
                "Til du fjerner dem eller sletter dine browserdata",
              ],
              [
                "Betalingscookies, fx __stripe_mid og __stripe_sid",
                "Sikker betaling og forebyggelse af svindel. Sættes først, når du går til kassen",
                "Stripe",
                "__stripe_mid: 1 år. __stripe_sid: 30 minutter",
              ],
              [
                "YouTube – kun hvis du afspiller en video",
                "Afspilning af produktvideoer",
                "YouTube (Google)",
                "Efter YouTubes egne regler",
              ],
            ],
          },
        ],
      },
      {
        heading: "Indkøbskurv og favoritter",
        blocks: [
          {
            type: "p",
            text: "Din indkøbskurv og din favoritliste gemmes i din egen browser (localStorage) – ikke hos os. Indholdet af kurven får vi først, når du går til kassen.",
          },
          { type: "p", text: "Det er strengt nødvendigt for, at kurven og favoritlisten virker, og kræver derfor ikke samtykke." },
        ],
      },
      {
        heading: "Betaling med Stripe",
        blocks: [
          {
            type: "p",
            text: "Når du går til kassen, indlæses Stripes betalingsløsning. Stripe sætter cookies, der er strengt nødvendige for at gennemføre betalingen sikkert og forebygge svindel. De kræver derfor ikke samtykke.",
          },
          {
            type: "p",
            text: "Stripe er selvstændig dataansvarlig for disse cookies. Læs mere på [stripe.com/privacy](https://stripe.com/privacy).",
          },
        ],
      },
      {
        heading: "Produktvideoer fra YouTube",
        blocks: [
          {
            type: "p",
            text: "Nogle produkter har en video fra YouTube. Vi bruger YouTubes udvidede privatlivstilstand (youtube-nocookie.com), og der indlæses intet fra YouTube, før du selv trykker på afspil.",
          },
          {
            type: "p",
            text: "Når du afspiller en video, gælder YouTubes egne vilkår, og YouTube kan gemme oplysninger i din browser. Læs mere i Googles privatlivspolitik på [policies.google.com/privacy](https://policies.google.com/privacy).",
          },
        ],
      },
      {
        heading: "Derfor ser du ikke et cookiebanner",
        blocks: [
          {
            type: "p",
            text: "Vi bruger kun det, der er strengt nødvendigt for, at webshoppen virker, eller som du selv aktivt beder om. Derfor skal vi ikke bede om dit samtykke.",
          },
          {
            type: "p",
            text: "Begynder vi en dag at bruge cookies til statistik eller markedsføring, beder vi om dit samtykke først. Så vil du se en tydelig samtykkeanmodning, hvor du også kan sige nej.",
          },
        ],
      },
      {
        heading: "Sådan sletter du data i din browser",
        blocks: [
          {
            type: "p",
            text: "Du kan altid slette cookies og lokalt gemte data i din browsers indstillinger. Bemærk, at din indkøbskurv og din favoritliste så bliver tømt.",
          },
          { type: "p", text: "Blokerer du cookies og lokal lagring, virker kurven og betalingen måske ikke." },
        ],
      },
      {
        heading: "Spørgsmål",
        blocks: [
          {
            type: "p",
            text: `Har du spørgsmål om cookies eller dine oplysninger, så skriv til os på ${EMAIL_LINK}. Læs også vores [privatlivspolitik](/privatlivspolitik).`,
          },
        ],
      },
    ],
  },

  {
    slug: "prismatch",
    title: "100% prismatch",
    description:
      "Finder du samme vare billigere i en anden dansk webshop, matcher vi prisen – inklusive fragt. Se betingelserne for 100% prismatch.",
    intro: "Du skal ikke betale mere hos os. Finder du den samme vare billigere i en anden dansk webshop, matcher vi prisen – inklusive fragt.",
    sections: [
      {
        heading: "Sådan virker det",
        blocks: [
          {
            type: "p",
            text: "Har du fundet den samme vare til en lavere pris i en anden dansk webshop, giver vi dig samme pris. Vi sammenligner den samlede pris inklusive fragt.",
          },
          { type: "p", text: "Prismatch gælder både, før du køber, og op til {prismatch_dage} dage efter dit køb." },
        ],
      },
      {
        heading: "Sådan gør du",
        blocks: [
          {
            type: "steps",
            items: [
              "Find varen i en anden dansk webshop.",
              `Send os et link til varen på ${EMAIL_LINK}. Har du allerede købt varen hos os, så skriv også dit ordrenummer.`,
              "Vi tjekker prisen og vender tilbage til dig hurtigst muligt.",
              "Før køb giver vi dig samme pris på din ordre. Efter køb betaler vi forskellen tilbage til det betalingsmiddel, du brugte.",
            ],
          },
        ],
      },
      {
        heading: "Betingelser",
        blocks: [
          {
            type: "list",
            items: [
              "Varen skal være præcis den samme: samme producent, model, farve og størrelse.",
              "Varen skal være på lager i den anden webshop.",
              "Den anden webshop skal være dansk og sælge til kunder i Danmark.",
              "Prisen skal være synlig for alle og gælde, når vi tjekker den.",
            ],
          },
        ],
      },
      {
        heading: "Det gælder ikke",
        blocks: [
          { type: "p", text: "Prismatch gælder ikke for:" },
          {
            type: "list",
            items: [
              "Ophørsudsalg og rydningssalg",
              "Auktioner og sælgere på markedspladser, fx brugtsalg",
              "Medlemspriser og mængde- eller pakkepriser, fx 3 for 2",
              "Åbenlyse prisfejl",
            ],
          },
        ],
      },
      {
        heading: "Spørgsmål?",
        blocks: [{ type: "p", text: `Skriv til os på ${EMAIL_LINK}, eller se andre måder at [kontakte os](/kontakt) på.` }],
      },
    ],
  },

  {
    slug: "kontakt",
    title: "Kontakt og kundeservice",
    description:
      "Kontakt kundeservice hos {shop} på e-mail eller telefon. Se åbningstider, adresse og CVR-nr. – og hvad du skal skrive med.",
    intro: "Har du spørgsmål til en vare, en størrelse eller din ordre? Vores danske kundeservice hjælper dig gerne.",
    sections: [
      {
        heading: "Skriv til os",
        blocks: [
          { type: "p", text: `E-mail: ${EMAIL_LINK}` },
          { type: "p", text: "Vi svarer på e-mails {svartid}." },
        ],
      },
      {
        heading: "Ring til os",
        blocks: [
          { type: "p", text: "Telefon: {telefon}" },
          { type: "p", text: "Åbningstider: {åbningstider}" },
        ],
      },
      {
        heading: "Det skal du skrive med",
        blocks: [
          { type: "p", text: "Så kan vi hjælpe dig hurtigere:" },
          {
            type: "list",
            items: [
              "Dit ordrenummer – det står i ordrebekræftelsen",
              "Dit navn og den e-mail, du bestilte med",
              "Hvad din henvendelse handler om",
              "Billeder, hvis en vare er defekt eller beskadiget",
              "Et link til varen, hvis du spørger om prismatch",
            ],
          },
        ],
      },
      {
        heading: "Måske finder du svaret her",
        blocks: [
          {
            type: "list",
            items: [
              "[Fragt og levering](/fragt-og-levering)",
              "[Returret og fortrydelse](/fortrydelsesret)",
              "[Størrelsesguide](/stoerrelsesguide)",
              "[Ofte stillede spørgsmål](/faq)",
            ],
          },
        ],
      },
      {
        heading: "Virksomhedsoplysninger",
        blocks: [
          { type: "list", items: ["{firma}", "{adresse}", "CVR-nr.: {cvr}"] },
          {
            type: "p",
            text: "Skal du sende en vare retur, så brug returadressen under [Returret og fortrydelse](/fortrydelsesret).",
          },
        ],
      },
    ],
  },

  {
    slug: "faq",
    title: "Ofte stillede spørgsmål",
    description:
      "Svar på de mest stillede spørgsmål om levering, fragt, retur, størrelser, betaling og prismatch hos {shop}.",
    intro: "Her finder du svar på det, vores kunder oftest spørger om. Finder du ikke svaret, er du altid velkommen til at kontakte os.",
    sections: [
      {
        heading: "Hvor hurtigt får jeg min ordre?",
        blocks: [
          {
            type: "p",
            text: "Bestiller du på en hverdag før kl. 19, sender vi din ordre samme dag. Herefter leverer fragtfirmaet den – som regel allerede hverdagen efter. Læs mere under [Fragt og levering](/fragt-og-levering).",
          },
        ],
      },
      {
        heading: "Hvad koster fragten?",
        blocks: [
          {
            type: "p",
            text: "Levering til nærmeste pakkeshop med PostNord, GLS eller DAO koster 39 kr. Levering til døren koster 49 kr. med DAO og 59 kr. med GLS.",
          },
        ],
      },
      {
        heading: "Hvornår er der fri fragt?",
        blocks: [{ type: "p", text: "Handler du for mindst {fri_fragt}, er levering til pakkeshop gratis." }],
      },
      {
        heading: "Hvordan følger jeg min pakke?",
        blocks: [
          {
            type: "p",
            text: "Når pakken er sendt, får du en e-mail eller sms fra fragtfirmaet med et link, så du kan følge den.",
          },
        ],
      },
      {
        heading: "Jeg har ikke fået en ordrebekræftelse. Hvad gør jeg?",
        blocks: [
          {
            type: "p",
            text: `Kig først i dit spamfilter. Er den ikke der, så skriv til os på ${EMAIL_LINK} med dit navn og den e-mail, du bestilte med – så tjekker vi din ordre.`,
          },
        ],
      },
      {
        heading: "Kan jeg returnere min ordre?",
        blocks: [
          {
            type: "p",
            text: "Ja, du har 30 dages returret fra den dag, du modtager varen. Se, hvordan du gør, under [Returret og fortrydelse](/fortrydelsesret).",
          },
        ],
      },
      {
        heading: "Kan jeg bytte til en anden størrelse?",
        blocks: [
          {
            type: "p",
            text: "Vi bytter ikke direkte. Send varen retur, og læg en ny ordre på den størrelse, du ønsker – så får du den hurtigst muligt. Pengene for den returnerede vare får du tilbage, når vi har modtaget den.",
          },
        ],
      },
      {
        heading: "Hvilken størrelse skal mit barn have?",
        blocks: [
          {
            type: "p",
            text: "Vælg efter barnets højde frem for alder. Ved børnekostumer står der som regel en højde ved størrelsen, fx 5-6 år (123 cm). Se mere i vores [størrelsesguide](/stoerrelsesguide).",
          },
        ],
      },
      {
        heading: "Jeg er mellem to størrelser – hvad gør jeg?",
        blocks: [
          {
            type: "p",
            text: "Vælg den største. Kostumer er beregnet til at blive båret over tyndt tøj, så lidt ekstra plads er en fordel.",
          },
        ],
      },
      {
        heading: "Hvordan kan jeg betale?",
        blocks: [
          {
            type: "p",
            text: "Du kan betale med Visa, Mastercard, MobilePay, Apple Pay og Google Pay. Hvilke muligheder du ser i kassen, afhænger af din enhed.",
          },
        ],
      },
      {
        heading: "Kan jeg betale med MobilePay?",
        blocks: [{ type: "p", text: "Ja. Vælg MobilePay i kassen, og godkend betalingen i MobilePay-appen." }],
      },
      {
        heading: "Er det sikkert at handle hos jer?",
        blocks: [
          {
            type: "p",
            text: "Ja. Betalingen behandles sikkert af Stripe (PCI DSS), og vi ser aldrig dine kortoplysninger. Du har 30 dages returret, og vi er bedømt som Fremragende med +30.000 femstjernede anmeldelser.",
          },
        ],
      },
      {
        heading: "Hvad er 100% prismatch?",
        blocks: [
          {
            type: "p",
            text: "Finder du den samme vare billigere i en anden dansk webshop, matcher vi prisen inklusive fragt. Send os et link, og læs betingelserne under [100% prismatch](/prismatch).",
          },
        ],
      },
      {
        heading: "Hvordan vasker jeg et kostume?",
        blocks: [
          {
            type: "p",
            text: "Følg altid vaskeanvisningen i kostumet. De fleste kostumer skal håndvaskes i koldt vand og må ikke komme i tørretumbleren.",
          },
        ],
      },
      {
        heading: "Er kostumerne brandhæmmende og CE-mærkede?",
        blocks: [
          {
            type: "p",
            text: "Børnekostumer er CE-mærkede efter EU's regler for legetøjssikkerhed. Men kostumer er ikke brandsikre, så hold altid afstand til åben ild som stearinlys, græskarlygter og bål.",
          },
        ],
      },
      {
        heading: "Hvad betyder 18+ ved en vare?",
        blocks: [
          {
            type: "p",
            text: "Varer mærket 18+ er kun for voksne og sælges kun til kunder, der er fyldt 18 år. Når du bestiller en vare mærket 18+, bekræfter du, at du er fyldt 18 år.",
          },
        ],
      },
    ],
  },

  {
    slug: "stoerrelsesguide",
    title: "Størrelsesguide",
    description:
      "Find den rigtige størrelse: sådan måler du, børnestørrelser efter højde, voksenstørrelser og gode råd, hvis du er mellem to størrelser.",
    intro: "Et kostume skal sidde godt, så man kan lege, danse og feste i det. Her kan du se, hvordan du måler, og hvordan størrelserne hænger sammen.",
    sections: [
      {
        heading: "Kort fortalt",
        blocks: [
          {
            type: "list",
            items: [
              "Børn: Vælg efter højde frem for alder.",
              "Voksne: Mål bryst, talje og hofte, og sammenlign med størrelsestabellen.",
              "Mellem to størrelser? Vælg den største.",
              "Kostumer er beregnet til at blive båret over tyndt tøj.",
            ],
          },
        ],
      },
      {
        heading: "Sådan måler du",
        blocks: [
          {
            type: "p",
            text: "Brug et blødt målebånd, og mål over tyndt tøj. Hold målebåndet tæt til kroppen, men ikke stramt. Børn måles på samme måde.",
          },
          {
            type: "list",
            items: [
              "Højde: Stå uden sko med ryggen mod en væg, og mål fra gulvet til toppen af hovedet.",
              "Brystvidde: Mål hele vejen rundt om den bredeste del af brystet, lige under armhulerne.",
              "Taljevidde: Mål rundt om den smalleste del af livet – som regel lidt over navlen.",
              "Hoftevidde: Mål rundt om den bredeste del af hofter og bagdel.",
              "Hovedomkreds: Mål rundt om hovedet lige over øjenbrynene og ørerne. Det er målet, der gælder for hatte, parykker og masker.",
            ],
          },
        ],
      },
      {
        heading: "Børnestørrelser",
        blocks: [
          {
            type: "p",
            text: "Børnekostumer har leverandørens størrelser efter alder med en højde i parentes, fx 5-6 år (123 cm). Det er højden, der tæller: Børn på samme alder kan være meget forskellige i størrelsen.",
          },
          {
            type: "table",
            head: ["Størrelse", "Barnets højde (ca.)"],
            rows: [
              ["12-18 mdr.", "80 cm"],
              ["18-24 mdr.", "88 cm"],
              ["2-3 år", "100 cm"],
              ["3-4 år", "109 cm"],
              ["5-6 år", "123 cm"],
              ["7-9 år", "137 cm"],
              ["10-12 år", "151 cm"],
              ["14-16 år", "171 cm"],
            ],
          },
          {
            type: "p",
            text: "Højden kan variere lidt fra kostume til kostume. Den præcise højde står ved størrelsen på produktsiden. Enkelte varer har andre aldersintervaller, fx 3-5 år eller 9-12 år.",
          },
          { type: "p", text: "Er dit barn tæt på at vokse ud af en størrelse, så vælg den næste." },
        ],
      },
      {
        heading: "Voksenstørrelser",
        blocks: [
          {
            type: "p",
            text: "Voksenkostumer har størrelser som S, M, L og XL. Tallet i parentes er den europæiske tøjstørrelse, fx L (42-44). Dame- og herrestørrelser følger hver sin skala, så tallene er forskellige:",
          },
          {
            type: "table",
            head: ["Størrelse", "Damer", "Herrer"],
            rows: [
              ["S", "S (36-38)", "S (46-48)"],
              ["M", "M (38-40)", "M (48-50)"],
              ["L", "L (42-44)", "L (52-54)"],
              ["XL", "XL (44-46)", "XL (54-56)"],
              ["XXL", "–", "XXL (56-58)"],
            ],
          },
          {
            type: "p",
            text: "Nogle kostumer findes i kombinerede størrelser som S-M eller M-L, der dækker to størrelser. Unisex-kostumer følger enten dame- eller herreskalaen – se tallet i parentes på produktsiden.",
          },
          { type: "p", text: "Har en vare ikke et størrelsesvalg, findes den kun i én størrelse." },
        ],
      },
      {
        heading: "Mellem to størrelser?",
        blocks: [
          {
            type: "p",
            text: "Vælg den største. Kostumer er beregnet til at blive båret over tyndt tøj, og et kostume, der er lidt for stort, er nemmere at have på end et, der strammer.",
          },
          {
            type: "p",
            text: "Skal kostumet bruges udendørs med varmt tøj under, så vælg også hellere en størrelse større. Til børn giver det samtidig plads til at vokse.",
          },
        ],
      },
      {
        heading: "Hatte, parykker og masker",
        blocks: [
          {
            type: "p",
            text: "Hatte, parykker og masker findes som regel i én størrelse til voksne eller til børn. Står der et mål i varebeskrivelsen, så sammenlign det med hovedomkredsen.",
          },
        ],
      },
      {
        heading: "Leverandørens størrelsesguide på produktsiden",
        blocks: [
          {
            type: "p",
            text: "Mange kostumer har leverandørens egen størrelsestabel. Du finder den via linket \"Størrelsesguide\" ved størrelsesvalget på produktsiden.",
          },
          {
            type: "p",
            text: "Tabellen gælder for netop det kostume, så brug den, når den findes. Sammenlign dine mål med tabellen, og vælg den største størrelse, hvis du er i tvivl.",
          },
        ],
      },
      {
        heading: "Stadig i tvivl?",
        blocks: [
          {
            type: "p",
            text: `Skriv til os på ${EMAIL_LINK} med et link til varen og dine mål, så hjælper vi dig med at vælge. Og husk, at du altid har [30 dages returret](/fortrydelsesret).`,
          },
        ],
      },
    ],
  },
];

/** "Om os" per store ID ("piece-dk" = Fastelavnskostumer.dk, "halloween-kostumer-dk" = Halloweenkostumer.dk). */
export const OM_OS: Record<string, InfoPage> = {
  "piece-dk": {
    slug: "om-os",
    title: "Om os",
    description:
      "{shop} er en dansk webshop med kostumer til børn og voksne – fastelavn hele året. Ca. 8.600 varer og lynhurtig levering.",
    intro: "Hos {shop} er det fastelavn hele året. Vi elsker at klæde ud – og vi hjælper dig med at finde kostumet, der får både store og små til at stråle.",
    sections: [
      {
        heading: "Glæden ved at klæde sig ud",
        blocks: [
          {
            type: "p",
            text: "Der er noget helt særligt ved at tage et kostume på. På et øjeblik bliver man prinsesse, pirat, superhelt eller en lille løve. Fantasien får frit spil, og grinene kommer helt af sig selv.",
          },
          {
            type: "p",
            text: "Vi har kostumer til fastelavn, karneval, temafester, fødselsdage og alle de andre dage, hvor man har lyst til at være en anden for en stund.",
          },
        ],
      },
      {
        heading: "Slå katten af tønden",
        blocks: [
          {
            type: "p",
            text: "Fastelavn er en af de bedste traditioner, vi har. Børnene klæder sig ud, tager køllen i hånden og slår løs på tønden, til slikket vælter ud. Traditionen tro bliver den, der slår hul på tønden, kattedronning – og den, der slår det sidste stykke ned, bliver kattekonge.",
          },
          {
            type: "p",
            text: "Bagefter venter fastelavnsbollerne – med flødeskum, creme eller glasur. Vi sørger for kostumerne, så I kan koncentrere jer om festen.",
          },
        ],
      },
      {
        heading: "Trygge og behagelige kostumer til børn",
        blocks: [
          {
            type: "p",
            text: "Et godt børnekostume skal kunne tåle leg. Det skal være nemt at tage på og rart at have på hele dagen.",
          },
          {
            type: "p",
            text: "Vores børnekostumer er CE-mærkede efter EU's regler for legetøjssikkerhed. Børnestørrelserne er angivet med både alder og højde, så du nemt kan finde den rigtige størrelse i vores [størrelsesguide](/stoerrelsesguide).",
          },
          {
            type: "p",
            text: "Kostumerne er beregnet til at blive båret over tyndt tøj. Skal festen foregå udenfor i februar, så vælg en størrelse større – så er der plads til en varm trøje indenunder.",
          },
        ],
      },
      {
        heading: "Et stort udvalg",
        blocks: [
          {
            type: "p",
            text: "Vi har ca. 8.600 varer: kostumer til damer, herrer, piger, drenge og babyer – og alt det, der gør udklædningen komplet. Parykker, hatte, masker, sværd og rekvisitter, make-up og ansigtsmaling og pynt til festen.",
          },
        ],
      },
      {
        heading: "En dansk webshop",
        blocks: [
          {
            type: "p",
            text: "Vi er en dansk webshop med dansk lager og dansk kundeservice. Bestiller du på en hverdag før kl. 19, sender vi din ordre samme dag.",
          },
          SELLING_POINTS,
          {
            type: "p",
            text: "Har du spørgsmål, så [skriv til os](/kontakt). Vi hjælper gerne med alt fra størrelser til gode idéer til kostumer.",
          },
        ],
      },
    ],
  },

  "halloween-kostumer-dk": {
    slug: "om-os",
    title: "Om os",
    description:
      "{shop} er en dansk webshop med kostumer, masker, effektmake-up og uhyggelig pynt – halloween hele året. Ca. 8.600 varer.",
    intro: "Hos {shop} er det halloween hele året. Vi lever for gys og stemning – og for de kostumer, der får gæsterne til at gyse eller skrige af grin.",
    sections: [
      {
        heading: "Halloween hele året",
        blocks: [
          {
            type: "p",
            text: "For os er halloween ikke kun én aften i oktober. Det er gyserfilmaftenen, temafesten, det hjemsøgte hus i haven og maskeraden, hvor ingen kan genkende hinanden.",
          },
          {
            type: "p",
            text: "Vil du være vampyr, zombie, heks eller noget, der er meget værre? Så finder du det hos os.",
          },
        ],
      },
      {
        heading: "Uhygge fra top til tå",
        blocks: [
          {
            type: "p",
            text: "Et rigtig godt kostume kræver de rigtige detaljer. Vi har masker, parykker, hatte, falske hugtænder, våben og rekvisitter – og blod og effektmake-up til sår, ar og et ligbleg ansigt.",
          },
          { type: "p", text: "Med lidt teaterblod og den rette maske bliver selv den sødeste nabo til et monster." },
        ],
      },
      {
        heading: "Sæt stemningen",
        blocks: [
          {
            type: "p",
            text: "Uhyggen sidder ikke kun i kostumet. Med gravsten, skeletter, kranier, græskar og uhyggelig pynt forvandler du stuen, haven eller festlokalet til et sted, gæsterne sent glemmer.",
          },
          {
            type: "p",
            text: "Og når børnene skal ud og sige \"slik eller ballade\", har vi også det, de skal bruge.",
          },
        ],
      },
      {
        heading: "Til hele familien – og nogle kun til voksne",
        blocks: [
          {
            type: "p",
            text: "Vi har kostumer til både børn og voksne. Vores børnekostumer er CE-mærkede efter EU's regler for legetøjssikkerhed, og i vores [størrelsesguide](/stoerrelsesguide) finder du den rigtige størrelse efter højde.",
          },
          {
            type: "p",
            text: "Nogle kostumer er kun for voksne. De er mærket 18+ og sælges kun til kunder, der er fyldt 18 år.",
          },
          {
            type: "p",
            text: "Husk, at kostumer ikke er brandsikre. Hold afstand til stearinlys og græskarlygter, så festen kun bliver uhyggelig på den gode måde.",
          },
        ],
      },
      {
        heading: "Et stort udvalg",
        blocks: [
          {
            type: "p",
            text: "Vi har ca. 8.600 varer: kostumer til damer, herrer, piger, drenge og babyer, tilbehør, make-up og pynt til festen. Så er der noget for alle – fra det let uhyggelige til det helt grufulde.",
          },
        ],
      },
      {
        heading: "En dansk webshop",
        blocks: [
          {
            type: "p",
            text: "Vi er en dansk webshop med dansk lager og dansk kundeservice. Bestiller du på en hverdag før kl. 19, sender vi din ordre samme dag – så du hurtigt er klar til festen.",
          },
          SELLING_POINTS,
          {
            type: "p",
            text: "Har du spørgsmål, så [skriv til os](/kontakt). Vi hjælper gerne med alt fra størrelser til det helt rigtige gys.",
          },
        ],
      },
    ],
  },
};
