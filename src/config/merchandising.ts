/**
 * What each shop puts first: its menu, its front page, its theme pages (collections) and its
 * own texts for the categories. Both shops sell every product; this is only what they show
 * and in which order, so each one feels like a Fastelavn shop or a Halloween shop.
 *
 * Categories are WooCommerce category slugs, themes are WooCommerce tag names (as the Guirca
 * import names them, e.g. "Pirater").
 */

import { storeConfig } from "./store";

/**
 * A theme page at /tema/<slug>: products in any of `categories` (none: every category), that
 * are also in every category of `alsoIn`, and that have one of `themes`.
 */
export type Collection = {
  slug: string;
  title: string;
  /** Shown under the title, and the page's description for search engines. */
  intro: string;
  categories?: string[];
  /**
   * "Also in" needs plugin 1.4 (`wchc_in_category`); with an older plugin these themes are
   * used instead, so the page still shows the right kind of products.
   */
  alsoIn?: string[];
  alsoInFallbackThemes?: string[];
  themes?: string[];
  /** The product (slug) whose photo the theme's tile shows; else the first costume on the page. */
  tileProduct?: string;
  /**
   * The page search engines should show instead, when this theme page lists the same products
   * as a category page and only exists for a front page row (e.g. "/kategori/tilbehoer").
   * Links to the theme go there too.
   */
  canonical?: string;
};

export type NavLink = { label: string; href: string };

/**
 * A menu item. Its dropdown has the groups given here, or else the subcategories of
 * `subcategoriesOf` (a category slug).
 */
export type NavItem = NavLink & { groups?: { title: string; links: NavLink[] }[]; subcategoriesOf?: string };

/** A tile on the front page; the photo is the first photo of `product` (a product slug), when given. */
export type Tile = NavLink & { product?: string };

export type HomePage = {
  hero: {
    title: string;
    text: string;
    primary: NavLink;
    secondary: NavLink;
    /** Product slugs whose photos fill the hero (two or three). */
    products: string[];
  };
  audiences: { title: string; tiles: Tile[] };
  themes: { title: string; collections: string[] };
  rows: { title: string; intro?: string; href: string; collection: string }[];
  guide: { title: string; text: string; tips: { title: string; text: string; icon: GuideIcon }[]; link: NavLink };
};

/** The icon next to a tip in the front page guide. */
export type GuideIcon = "ruler" | "shirt" | "sparkles" | "mask" | "house";

export type Merchandising = {
  /**
   * Categories kept off the shop's front page and theme pages (e.g. Halloween in the Fastelavn
   * shop). Their products are still in their categories and in search.
   */
  hidden: string[];
  /**
   * Subcategories left out of the menu's dropdowns and the category chips (e.g. Halloweenpynt
   * in the Fastelavn shop), like the hidden categories. Their pages still work and are in search,
   * but search engines are sent to the shop that shows them (see categoryHomeStore in lib/home-store.ts).
   */
  navHidden: string[];
  /**
   * Product-page recommendations ("Relevant tilbehør", "Lignende produkter") leave out products
   * named like this, besides the hidden categories: Guirca files many bat, skull and Santa
   * items under neutral themes such as "Dyr", outside the Halloween and Christmas categories.
   * Not for products that are off-season themselves (a skeleton costume keeps its skulls).
   */
  offSeasonWords?: RegExp;
  /**
   * The order of category pages and "Alle produkter" (with the default sorting): the
   * season's products first, then the rest. "in": products in these categories first;
   * "out": products outside them first. Nothing is left out. Needs plugin 1.4.
   */
  seasonFirst: { categories: string[]; prefer: "in" | "out" };
  nav: NavItem[];
  home: HomePage;
  /** The overview of all theme pages at /tema: the themes, then the other theme pages. */
  themesPage: { intro: string; themesTitle: string; moreTitle: string };
  collections: Collection[];
  /** The shop's own introduction to a category (slug -> text), above its products. */
  categoryIntros: Record<string, string>;
};

const HALLOWEEN_THEMES = [
  "Skeletter",
  "Hekse",
  "Vampyrer",
  "Djævle og dæmoner",
  "Spøgelser",
  "Zombie",
  "De Dødes Dag",
  "Varulv",
  "Voodoo",
  "Lil Monsters",
  "Gotisk",
];

const CHILDREN = ["pigekostumer", "drengekostumer", "babykostumer"];
const ADULTS = ["damekostumer", "herrekostumer"];

const fastelavn: Merchandising = {
  hidden: ["halloween", "jul-og-nytaar"],
  navHidden: ["halloweenpynt", "figurer-og-animatronics", "slik-eller-ballade", "julepynt", "blod-og-effekter"],
  // "\bjul": Christmas words (jul, julemand, juletræ …) but not "hjul" or "skjult".
  offSeasonWords: /halloween|flagermus|edderkop|kranie|skelet|zombie|spindelv|nisse|\bjul/i,
  seasonFirst: { categories: ["halloween", "jul-og-nytaar"], prefer: "out" },
  nav: [
    {
      label: "Børn",
      href: "/tema/boernekostumer",
      groups: [
        {
          title: "Kostumer til børn",
          links: [
            { label: "Pigekostumer", href: "/kategori/pigekostumer" },
            { label: "Drengekostumer", href: "/kategori/drengekostumer" },
            { label: "Babykostumer", href: "/kategori/babykostumer" },
            { label: "Alle børnekostumer", href: "/tema/boernekostumer" },
          ],
        },
        {
          title: "Populære temaer",
          links: [
            { label: "Prinsesser og prinser", href: "/tema/prinsesser" },
            { label: "Superhelte", href: "/tema/superhelte" },
            { label: "Dyrekostumer", href: "/tema/dyrekostumer" },
            { label: "Pirater", href: "/tema/pirater" },
            { label: "Politi og brandmænd", href: "/tema/politi-og-brandmaend" },
            { label: "Eventyr og fantasi", href: "/tema/eventyr" },
          ],
        },
      ],
    },
    {
      label: "Voksne",
      href: "/tema/voksenkostumer",
      groups: [
        {
          title: "Kostumer til voksne",
          links: [
            { label: "Damekostumer", href: "/kategori/damekostumer" },
            { label: "Herrekostumer", href: "/kategori/herrekostumer" },
            { label: "Sjove kostumer til voksne", href: "/tema/sjove-voksenkostumer" },
            { label: "Alle voksenkostumer", href: "/tema/voksenkostumer" },
          ],
        },
        {
          title: "Til festen",
          links: [
            { label: "Klovne og cirkus", href: "/tema/klovne" },
            { label: "Cowboys og indianere", href: "/tema/cowboys-og-indianere" },
            { label: "Riddere og vikinger", href: "/tema/riddere-og-vikinger" },
            { label: "Parykker", href: "/kategori/parykker" },
          ],
        },
      ],
    },
    {
      label: "Temaer",
      href: "/tema",
      groups: [
        {
          title: "Find et tema",
          links: [
            { label: "Prinsesser og prinser", href: "/tema/prinsesser" },
            { label: "Superhelte", href: "/tema/superhelte" },
            { label: "Dyrekostumer", href: "/tema/dyrekostumer" },
            { label: "Pirater", href: "/tema/pirater" },
            { label: "Politi og brandmænd", href: "/tema/politi-og-brandmaend" },
          ],
        },
        {
          title: "Flere temaer",
          links: [
            { label: "Eventyr og fantasi", href: "/tema/eventyr" },
            { label: "Klovne og cirkus", href: "/tema/klovne" },
            { label: "Cowboys og indianere", href: "/tema/cowboys-og-indianere" },
            { label: "Riddere og vikinger", href: "/tema/riddere-og-vikinger" },
          ],
        },
      ],
    },
    { label: "Tilbehør", href: "/kategori/tilbehoer", subcategoriesOf: "tilbehoer" },
    { label: "Ansigtsmaling", href: "/kategori/make-up", subcategoriesOf: "make-up" },
    { label: "Pynt og fest", href: "/kategori/pynt-og-fest", subcategoriesOf: "pynt-og-fest" },
  ],
  home: {
    hero: {
      title: "Gør klar til fastelavn",
      text: "Kostumer til hele familien – fra små prinsesser og superhelte til sjove kostumer til de voksne. Klar til tønden på et øjeblik.",
      primary: { label: "Kostumer til børn", href: "/tema/boernekostumer" },
      secondary: { label: "Kostumer til voksne", href: "/tema/voksenkostumer" },
      products: ["skovprinsesse-kostume-til-piger-flerfarvet", "papegoejeponcho-kostume-til-boern", "cowboydukke-kostume-til-boern"],
    },
    audiences: {
      title: "Hvem skal klædes ud?",
      tiles: [
        { label: "Piger", href: "/kategori/pigekostumer", product: "lilla-prinsesse-kostume-til-piger" },
        { label: "Drenge", href: "/kategori/drengekostumer", product: "pirat-kostume-til-boern" },
        { label: "Baby", href: "/kategori/babykostumer", product: "dino-kostume-til-baby" },
        { label: "Damer", href: "/kategori/damekostumer", product: "latindanser-kostume-til-damer" },
        { label: "Herrer", href: "/kategori/herrekostumer", product: "sjov-prinsesse-kostume-til-herrer" },
      ],
    },
    themes: {
      title: "Populære temaer",
      collections: ["prinsesser", "superhelte", "dyrekostumer", "pirater", "politi-og-brandmaend", "eventyr", "klovne", "cowboys-og-indianere"],
    },
    rows: [
      { title: "Populære børnekostumer", intro: "Klar til tønden", href: "/tema/boernekostumer", collection: "boernekostumer" },
      { title: "Sjove kostumer til voksne", intro: "Til fastelavnsfesten på jobbet eller i klubben", href: "/tema/sjove-voksenkostumer", collection: "sjove-voksenkostumer" },
      { title: "Gør kostumet komplet", intro: "Parykker, hatte, masker og alt det andet", href: "/kategori/tilbehoer", collection: "tilbehoer" },
      { title: "Ansigtsmaling", intro: "Kattemasker, tigerstriber og glimmer", href: "/kategori/sminke-og-ansigtsmaling", collection: "ansigtsmaling" },
    ],
    guide: {
      title: "Sådan finder du det rigtige kostume",
      text: "Fastelavn er ofte koldt, og børn vokser hurtigt. Med disse råd sidder kostumet godt hele dagen.",
      tips: [
        { title: "Vælg efter højde", text: "Børnestørrelser står med alder og højde. Gå efter højden – og vælg den største, hvis barnet er mellem to.", icon: "ruler" },
        { title: "Plads til lag", text: "Kostumerne er lavet til at have over tøjet. Det er februar, så giv plads til en trøje under.", icon: "shirt" },
        { title: "Tilbehøret gør det", text: "En paryk, en hat eller lidt ansigtsmaling gør kostumet helt færdigt – og gør det let at genkende.", icon: "sparkles" },
      ],
      link: { label: "Se størrelsesguiden", href: "/stoerrelsesguide" },
    },
  },
  themesPage: {
    intro: "Find fastelavnskostumet efter tema – prinsesser, superhelte, dyr, pirater og meget mere til både børn og voksne.",
    themesTitle: "Find et tema",
    moreTitle: "Kostumer og tilbehør",
  },
  collections: [
    {
      slug: "boernekostumer",
      title: "Børnekostumer",
      intro: "Fastelavnskostumer til piger, drenge og de helt små – prinsesser, superhelte, dyr og meget mere. Vælg størrelse efter barnets højde.",
      categories: CHILDREN,
    },
    {
      slug: "voksenkostumer",
      title: "Voksenkostumer",
      intro: "Kostumer til damer og herrer til fastelavnsfesten, firmafesten eller klubben. Fra sjove og fjollede til flotte og gennemførte.",
      categories: ADULTS,
    },
    {
      slug: "prinsesser",
      title: "Prinsesser og prinser",
      intro: "Prinsessekjoler, kroner og kapper til små og store kongelige – klar til at blive kattedronning eller kattekonge.",
      // Costumes and royal accessories: the tag alone also carries everyday wigs and corsets.
      categories: [...CHILDREN, ...ADULTS, "hovedpynt", "smykker", "tilbehoerssaet", "kapper", "stave-og-rekvisitter"],
      themes: ["Prinser og prinsesser"],
    },
    {
      slug: "superhelte",
      title: "Superhelte",
      intro: "Superheltekostumer og figurer fra tegnefilm til børn og voksne. Med kappe, maske og masser af superkræfter.",
      themes: ["Superhelte og tegnefilm"],
    },
    {
      slug: "dyrekostumer",
      title: "Dyrekostumer",
      intro: "Katte, bjørne, enhjørninger, mariehøns og alle de andre dyr. Bløde og varme kostumer, der er dejlige at have på en kold fastelavnsdag.",
      // "Dyr" carries most animal costumes (lions, dinosaurs, monkeys …), but also bats, spiders
      // and rats for Halloween: keep costumes, ears, masks and wings, not figures and decorations.
      categories: [...CHILDREN, ...ADULTS, "hovedpynt", "masker", "tilbehoerssaet", "vinger-og-fjer"],
      themes: ["Dyr", "Katte og flagermus", "Bjørn", "Mus", "Enhjørninger", "Havdyr", "Mariehøne", "Bier", "Flamingo"],
    },
    {
      slug: "pirater",
      title: "Pirater",
      intro: "Piratkostumer, hatte, klapper og sabler til hele besætningen.",
      themes: ["Pirater"],
    },
    {
      slug: "politi-og-brandmaend",
      title: "Politi og brandmænd",
      intro: "Politibetjente, brandmænd, læger, piloter og kokke – kostumer til dem, der vil være helte i hverdagen.",
      themes: ["Politi", "Brandmænd", "SWAT", "Læger og sygeplejersker", "Piloter", "Kokke"],
      // A child's costume: the newest is often an adult nurse.
      tileProduct: "brandmand-kostume-til-drenge-2",
    },
    {
      slug: "eventyr",
      title: "Eventyr og fantasi",
      intro: "Feer, havfruer, engle, troldmænd og enhjørninger – kostumer til dem, der drømmer sig væk.",
      themes: ["Eventyr", "Enhjørninger", "Havfruer", "Engel", "Troldmandselever"],
    },
    {
      slug: "klovne",
      title: "Klovne og cirkus",
      intro: "Klovnekostumer, store sko, røde næser og farvestrålende parykker. Sjovt for både børn og voksne.",
      themes: ["Klovne"],
      tileProduct: "lille-klovn-kostume-til-piger-hvid-og-flerfarvet",
    },
    {
      slug: "cowboys-og-indianere",
      title: "Cowboys og indianere",
      intro: "Cowboyhatte, sheriffstjerner, fjerpragt og frynser – alt til det vilde vesten.",
      themes: ["Cowboys", "Indianere"],
    },
    {
      slug: "riddere-og-vikinger",
      title: "Riddere og vikinger",
      intro: "Riddere, vikinger, romere og hulemænd med hjelme, skjolde og sværd.",
      themes: ["Vikinger", "Romere og grækere", "Hulemænd", "Middelalder og prinsesser"],
    },
    {
      slug: "sjove-voksenkostumer",
      title: "Sjove kostumer til voksne",
      intro: "Kostumer, der får hele festen til at grine – dyr, klovne, filmfigurer og skøre ideer til damer og herrer.",
      categories: ADULTS,
      themes: ["Spøg og skæmt", "Klovne", "Dyr", "Mr. Smile", "Film", "Superhelte og tegnefilm", "Øl og drinks"],
      tileProduct: "baaret-af-prinsesse-kostume-til-herrer",
    },
    {
      slug: "tilbehoer",
      title: "Tilbehør",
      intro: "Parykker, hatte, masker og alt det, der gør kostumet færdigt.",
      categories: ["tilbehoer"],
      canonical: "/kategori/tilbehoer",
    },
    {
      slug: "ansigtsmaling",
      title: "Ansigtsmaling",
      intro: "Ansigtsmaling, sminke og glimmer til kattemasker, tigerstriber og superheltemasker.",
      categories: ["sminke-og-ansigtsmaling", "glimmer-og-ansigtssmykker"],
    },
  ],
  categoryIntros: {
    kostumer: "Fastelavnskostumer til hele familien. Find kostumet til piger, drenge, baby, damer og herrer – og vælg størrelse efter højde.",
    pigekostumer: "Fastelavnskostumer til piger: prinsesser, feer, dyr, superhelte og meget mere. Størrelserne står med alder og højde, så det er let at vælge.",
    drengekostumer: "Fastelavnskostumer til drenge: superhelte, pirater, riddere, politi, dyr og meget mere. Vælg størrelse efter drengens højde.",
    babykostumer: "Søde og bløde kostumer til de helt små – perfekte til den første fastelavn.",
    damekostumer: "Kostumer til damer til fastelavnsfesten og alle andre fester – fra sjove og fjollede til flotte og gennemførte.",
    herrekostumer: "Kostumer til herrer til fastelavnsfesten, firmafesten og polterabenden – sjove, flotte og lette at tage på.",
    tilbehoer: "Gør kostumet komplet med parykker, hatte, masker, briller, våben og alt det andet tilbehør.",
    "make-up": "Ansigtsmaling, sminke og glimmer til fastelavn – til kattemasker, tigerstriber og superheltemasker.",
    "sminke-og-ansigtsmaling": "Ansigtsmaling og sminke, der er let at påføre og fjerne. Perfekt til kattemaske, tigerstriber og sommerfugle.",
    "pynt-og-fest": "Pynt, konfetti og bordpynt til fastelavnsfesten.",
  },
};

const halloween: Merchandising = {
  hidden: ["jul-og-nytaar"],
  navHidden: ["julepynt"],
  seasonFirst: { categories: ["halloween"], prefer: "in" },
  nav: [
    {
      label: "Kostumer",
      href: "/tema/halloweenkostumer",
      groups: [
        {
          title: "Halloweenkostumer",
          links: [
            { label: "Til damer", href: "/tema/halloweenkostumer-til-damer" },
            { label: "Til herrer", href: "/tema/halloweenkostumer-til-herrer" },
            { label: "Til børn", href: "/tema/halloweenkostumer-til-boern" },
            { label: "Alt til halloween", href: "/kategori/halloween" },
          ],
        },
        {
          title: "Uhyggelige temaer",
          links: [
            { label: "Hekse", href: "/tema/hekse" },
            { label: "Vampyrer", href: "/tema/vampyrer" },
            { label: "Zombier", href: "/tema/zombier" },
            { label: "Skeletter", href: "/tema/skeletter" },
            { label: "Djævle og dæmoner", href: "/tema/djaevle-og-daemoner" },
            { label: "De Dødes Dag", href: "/tema/de-doedes-dag" },
          ],
        },
      ],
    },
    {
      label: "Temaer",
      href: "/tema",
      groups: [
        {
          title: "Find dit monster",
          links: [
            { label: "Hekse", href: "/tema/hekse" },
            { label: "Vampyrer", href: "/tema/vampyrer" },
            { label: "Zombier", href: "/tema/zombier" },
            { label: "Skeletter", href: "/tema/skeletter" },
            { label: "Spøgelser", href: "/tema/spoegelser" },
          ],
        },
        {
          title: "Flere temaer",
          links: [
            { label: "Djævle og dæmoner", href: "/tema/djaevle-og-daemoner" },
            { label: "De Dødes Dag", href: "/tema/de-doedes-dag" },
            { label: "Horror-klovne", href: "/tema/horror-klovne" },
            { label: "Varulve", href: "/tema/varulve" },
          ],
        },
      ],
    },
    { label: "Masker", href: "/tema/halloweenmasker" },
    { label: "Make-up og blod", href: "/kategori/make-up", subcategoriesOf: "make-up" },
    {
      label: "Pynt",
      href: "/kategori/halloweenpynt",
      groups: [
        {
          title: "Pynt til huset",
          links: [
            { label: "Halloweenpynt", href: "/kategori/halloweenpynt" },
            { label: "Figurer og animatronics", href: "/kategori/figurer-og-animatronics" },
            { label: "Lys og effekter", href: "/kategori/lys-og-effekter" },
            { label: "Slik eller ballade", href: "/kategori/slik-eller-ballade" },
          ],
        },
      ],
    },
    { label: "Tilbehør", href: "/kategori/tilbehoer", subcategoriesOf: "tilbehoer" },
  ],
  home: {
    hero: {
      title: "Bliv aftenens mest uhyggelige",
      text: "Halloweenkostumer, masker, blod og pynt – alt til en skræmmende god fest. Bestil før kl. 19 på hverdage, så sender vi samme dag.",
      primary: { label: "Se halloweenkostumer", href: "/tema/halloweenkostumer" },
      secondary: { label: "Masker og make-up", href: "/tema/halloweenmasker" },
      products: [],
    },
    audiences: {
      title: "Find dit halloweenkostume",
      tiles: [
        { label: "Damer", href: "/tema/halloweenkostumer-til-damer" },
        { label: "Herrer", href: "/tema/halloweenkostumer-til-herrer" },
        { label: "Børn", href: "/tema/halloweenkostumer-til-boern", product: "vampyrgreve-kostume-til-drenge" },
        { label: "Masker", href: "/tema/halloweenmasker", product: "pestlaegemaske-pvc" },
        { label: "Blod og effekter", href: "/kategori/blod-og-effekter", product: "vampyrgebis-i-hoej-kvalitet-med-termoplastisk-harpiks-roed-og-groen" },
        { label: "Pynt", href: "/kategori/halloweenpynt", product: "assorteret-skelet-kandelaber-med-lys-pvc-35-cm" },
      ],
    },
    themes: {
      title: "Vælg dit monster",
      collections: ["hekse", "vampyrer", "zombier", "skeletter", "djaevle-og-daemoner", "spoegelser", "de-doedes-dag", "horror-klovne"],
    },
    rows: [
      { title: "Halloweenkostumer til voksne", intro: "De mest uhyggelige kostumer til damer og herrer", href: "/tema/halloweenkostumer-til-voksne", collection: "halloweenkostumer-til-voksne" },
      { title: "Halloween for børn", intro: "Uhyggeligt – men ikke for uhyggeligt", href: "/tema/halloweenkostumer-til-boern", collection: "halloweenkostumer-til-boern" },
      { title: "Masker, blod og effekter", intro: "Gør kostumet rigtig skræmmende", href: "/tema/masker-og-blod", collection: "masker-og-blod" },
      { title: "Pynt huset", intro: "Græskar, kranier, spindelvæv og animatronics", href: "/kategori/halloweenpynt", collection: "halloweenpynt" },
    ],
    guide: {
      title: "Sådan bliver din halloween uhyggelig",
      text: "Et godt halloweenkostume handler om detaljerne. Her er tre råd fra os.",
      tips: [
        { title: "Kostume + maske + blod", text: "Kombinér kostumet med en maske eller make-up og lidt kunstigt blod. Det er detaljerne, der gør det skræmmende.", icon: "mask" },
        { title: "Vælg den rigtige størrelse", text: "Mål bryst, talje og hofte, og sammenlign med størrelsesguiden. Er du mellem to størrelser, så vælg den største.", icon: "ruler" },
        { title: "Pynt huset", text: "Græskar, kranier, spindelvæv og lys forvandler hjemmet til et spøgelseshus – og gør festen komplet.", icon: "house" },
      ],
      link: { label: "Se størrelsesguiden", href: "/stoerrelsesguide" },
    },
  },
  themesPage: {
    intro: "Find dit halloweenkostume efter tema – hekse, vampyrer, zombier, skeletter og alle de andre monstre.",
    themesTitle: "Find dit monster",
    moreTitle: "Kostumer, masker og pynt",
  },
  collections: [
    {
      slug: "halloweenkostumer",
      title: "Halloweenkostumer",
      intro: "Halloweenkostumer til damer, herrer og børn – hekse, vampyrer, zombier, skeletter og meget mere.",
      categories: [...ADULTS, ...CHILDREN],
      alsoIn: ["halloween"],
      alsoInFallbackThemes: HALLOWEEN_THEMES,
      tileProduct: "zombiesygeplejerske-kostume-til-damer-hvid-og-roed",
    },
    {
      slug: "halloweenkostumer-til-damer",
      title: "Halloweenkostumer til damer",
      intro: "Hekse, vampyrer, zombier, skeletter og djævle – halloweenkostumer til damer, der vil være aftenens mest uhyggelige.",
      categories: ["damekostumer"],
      alsoIn: ["halloween"],
      alsoInFallbackThemes: HALLOWEEN_THEMES,
      tileProduct: "vampyr-kostume-til-damer-roed-og-sort",
    },
    {
      slug: "halloweenkostumer-til-herrer",
      title: "Halloweenkostumer til herrer",
      intro: "Zombier, vampyrer, skeletter, djævle og monstre – halloweenkostumer til herrer, der skræmmer.",
      categories: ["herrekostumer"],
      alsoIn: ["halloween"],
      alsoInFallbackThemes: HALLOWEEN_THEMES,
    },
    {
      slug: "halloweenkostumer-til-voksne",
      title: "Halloweenkostumer til voksne",
      intro: "Halloweenkostumer til damer og herrer – fra klassiske hekse og vampyrer til zombier og horror-klovne.",
      categories: ADULTS,
      alsoIn: ["halloween"],
      alsoInFallbackThemes: HALLOWEEN_THEMES,
      tileProduct: "forbandet-spoegelse-kostume-til-herrer",
    },
    {
      slug: "halloweenkostumer-til-boern",
      title: "Halloweenkostumer til børn",
      intro: "Søde små monstre, hekse, skeletter og vampyrer – halloweenkostumer til børn, der er uhyggelige, men ikke for uhyggelige.",
      categories: CHILDREN,
      alsoIn: ["halloween"],
      alsoInFallbackThemes: HALLOWEEN_THEMES,
      tileProduct: "vampyrgreve-kostume-til-drenge",
    },
    {
      slug: "halloweenmasker",
      title: "Halloweenmasker",
      intro: "Skræmmende masker i latex og plast – zombier, dæmoner, klovne og kranier. Den hurtigste vej til et uhyggeligt kostume.",
      categories: ["masker"],
      alsoIn: ["halloween"],
      alsoInFallbackThemes: HALLOWEEN_THEMES,
    },
    {
      slug: "masker-og-blod",
      title: "Masker, blod og effekter",
      intro: "Masker, kunstigt blod, sår, ar og effekter, der gør kostumet rigtig skræmmende.",
      categories: ["masker", "blod-og-effekter"],
      alsoIn: ["halloween"],
      alsoInFallbackThemes: HALLOWEEN_THEMES,
    },
    {
      slug: "halloweenpynt",
      title: "Pynt huset til halloween",
      intro: "Græskar, kranier, gravsten, lys og animatronics – alt til at forvandle huset og haven til et spøgelseshus.",
      categories: ["halloweenpynt", "figurer-og-animatronics", "lys-og-effekter"],
      alsoIn: ["halloween"],
      alsoInFallbackThemes: HALLOWEEN_THEMES,
    },
    // The tiles show adult costumes: the newest product of a theme is often a child's.
    {
      slug: "hekse",
      title: "Hekse",
      intro: "Heksekostumer, heksehatte, koste og parykker til små og store hekse.",
      themes: ["Hekse"],
      tileProduct: "fantasiheks-kostume-til-damer-sort",
    },
    {
      slug: "vampyrer",
      title: "Vampyrer",
      intro: "Vampyrkostumer, kapper, hugtænder og blod – til grever, grevinder og blodsugere.",
      themes: ["Vampyrer"],
      tileProduct: "vampyr-kostume-til-herrer-bordeaux-og-sort",
    },
    {
      slug: "zombier",
      title: "Zombier",
      intro: "Zombiekostumer, sår og blod til dem, der vil gå igen.",
      themes: ["Zombie"],
      tileProduct: "zombie-studerende-kostume-til-damer",
    },
    {
      slug: "skeletter",
      title: "Skeletter",
      intro: "Skeletkostumer, kranier og knogler til kostumet – og til at pynte huset med.",
      themes: ["Skeletter"],
      tileProduct: "skelet-kostume-til-herrer",
    },
    {
      slug: "djaevle-og-daemoner",
      title: "Djævle og dæmoner",
      intro: "Djævlehorn, haler, treforke og dæmonmasker.",
      themes: ["Djævle og dæmoner"],
      tileProduct: "daemon-kostume-til-herrer",
    },
    {
      slug: "spoegelser",
      title: "Spøgelser",
      intro: "Spøgelseskostumer og uhyggelig pynt, der går igen.",
      themes: ["Spøgelser"],
      tileProduct: "haarspoegelse-kostume-til-damer",
    },
    {
      slug: "de-doedes-dag",
      title: "De Dødes Dag",
      intro: "Kostumer, blomsterkranse og make-up til den mexicanske Día de los Muertos – farverigt og flot.",
      themes: ["De Dødes Dag"],
      tileProduct: "farverig-catrina-kostume-til-damer",
    },
    {
      slug: "horror-klovne",
      title: "Horror-klovne",
      intro: "Klovne, der ikke er sjove: horror-klovnekostumer, masker og parykker.",
      themes: ["Klovne"],
      alsoIn: ["halloween"],
      alsoInFallbackThemes: HALLOWEEN_THEMES,
      tileProduct: "ond-klovn-kostume-til-herrer",
    },
    { slug: "varulve", title: "Varulve", intro: "Varulvekostumer, masker og klør til fuldmånen.", themes: ["Varulv"] },
  ],
  categoryIntros: {
    halloween: "Alt til halloween: kostumer, masker, blod og effekter, make-up og pynt til huset.",
    kostumer: "Kostumer til damer, herrer og børn – til halloween og alle andre fester.",
    damekostumer: "Kostumer til damer. Til halloween finder du hekse, vampyrer, zombier og meget mere under Halloweenkostumer til damer.",
    herrekostumer: "Kostumer til herrer. Til halloween finder du zombier, vampyrer, skeletter og meget mere under Halloweenkostumer til herrer.",
    pigekostumer: "Kostumer til piger – hekse, flagermus, skeletter og søde små monstre. Vælg størrelse efter højde.",
    drengekostumer: "Kostumer til drenge – skeletter, vampyrer, zombier og monstre. Vælg størrelse efter højde.",
    masker: "Masker til halloween og fest – fra uhyggelige latexmasker til halvmasker.",
    "make-up": "Halloween-make-up: hvid og sort sminke, kunstigt blod, sår, ar og effekter.",
    "blod-og-effekter": "Kunstigt blod, sår, ar, latex og falske tænder, der gør kostumet rigtig uhyggeligt.",
    halloweenpynt: "Halloweenpynt til huset: græskar, kranier, gravsten, spindelvæv og uhyggelige rekvisitter.",
    "figurer-og-animatronics": "Figurer, der bevæger sig, lyser og laver lyde – det store trick til halloweenfesten.",
    "pynt-og-fest": "Pynt til halloweenfesten – til huset, haven og bordet.",
    "polterabend-18": "Kostumer og tilbehør for voksne. Kun for kunder over 18 år.",
  },
};

/** Merchandising by store ID. */
export const merchandisingByStore: Record<string, Merchandising> = { "piece-dk": fastelavn, "halloween-kostumer-dk": halloween };

/** This shop's merchandising (a store without its own uses its season's). */
export const merchandising: Merchandising = merchandisingByStore[storeConfig.id] ?? (storeConfig.season === "halloween" ? halloween : fastelavn);

export function findCollection(slug: string): Collection | undefined {
  return merchandising.collections.find((c) => c.slug === slug);
}

/** Where links to a theme page go: the page itself, or the category page it stands in for. */
export function collectionHref(collection: Collection): string {
  return collection.canonical ?? `/tema/${collection.slug}`;
}

/** Whether menus and category chips list this category (not hidden, not `navHidden`). */
export function shownInNav(slug: string, shop: Merchandising = merchandising): boolean {
  return !shop.hidden.includes(slug) && !shop.navHidden.includes(slug);
}

/** The sections of the /tema overview: the themes (the front page's first), then the other theme pages. */
export function themesOverview(shop: Merchandising = merchandising): { title: string; collections: Collection[] }[] {
  const first = shop.home.themes.collections;
  const rank = (c: Collection) => (first.includes(c.slug) ? first.indexOf(c.slug) : first.length);
  const themes = shop.collections.filter((c) => c.themes?.length).sort((a, b) => rank(a) - rank(b));
  const more = shop.collections.filter((c) => !c.themes?.length);
  return [
    { title: shop.themesPage.themesTitle, collections: themes },
    { title: shop.themesPage.moreTitle, collections: more },
  ].filter((section) => section.collections.length > 0);
}
