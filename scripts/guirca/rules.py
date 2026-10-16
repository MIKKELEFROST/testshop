"""Rules that turn rows of Guirca's product sheet into Danish shop data.

Pure functions without I/O, so they can be unit-tested (test_rules.py) and reused for
other suppliers. Everything the shop sees in Danish (names, sizes, categories, texts) is
decided here.
"""
from __future__ import annotations

import collections
import functools
import html
import json
import math
import re
import unicodedata
from dataclasses import dataclass, fields
from pathlib import Path

EUR_TO_DKK = 7.46
# Prices in the sheet above this are errors (e.g. 1,455,985.44 EUR for a toy gun).
MAX_PLAUSIBLE_EUR = 5000.0

MANUFACTURER = (
    "Producent: Fiestas Guirca, S.L., Pol. Ind. Can Cuyas, C/ Agudes 14, 08110 Montcada i Reixac, "
    "Barcelona, Spanien · qc@guirca.com · www.guirca.com"
)


# ---------------------------------------------------------------- text helpers


def clean(value) -> str:
    """A sheet cell as trimmed text ('' for empty cells and NaN)."""
    if value is None:
        return ""
    if isinstance(value, float) and math.isnan(value):
        return ""
    return re.sub(r"\s+", " ", html.unescape(str(value))).strip()


def split_list(value) -> list[str]:
    """'BLACK, RED, BLACK' -> ['BLACK', 'RED'] (order kept, duplicates and blanks dropped)."""
    items = [part.strip() for part in clean(value).split(",")]
    return list(dict.fromkeys(item for item in items if item))


def join_da(items) -> str:
    """['a', 'b', 'c'] -> 'a, b og c'."""
    items = list(dict.fromkeys(item for item in items if item))
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " og " + items[-1]


def capitalize(text: str) -> str:
    return text[:1].upper() + text[1:]


def number_da(value: float) -> str:
    """19.9 -> '19,9'; 20.0 -> '20'."""
    text = f"{value:.1f}".rstrip("0").rstrip(".")
    return text.replace(".", ",")


def slugify(name: str) -> str:
    """Danish-friendly slug: 'Tøj og strømper' -> 'toej-og-stroemper'."""
    text = name.lower()
    for src, dst in (("æ", "ae"), ("ø", "oe"), ("å", "aa")):
        text = text.replace(src, dst)
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")


def https(url: str) -> str:
    url = clean(url).replace(" ", "%20")
    if url.startswith("http://"):
        url = "https://" + url[len("http://"):]
    # The size charts on www.guirca.com redirect to the static host.
    return url.replace("https://www.guirca.com/media/mailing/", "https://static.guirca.com/media/mailing/")


# ---------------------------------------------------------------- sizes


def normalize_size(raw) -> str:
    """Sheet size with Guirca's dashes and spacing normalized: '7 –  9 YEARS' -> '7 - 9 YEARS'."""
    return re.sub(r"\s+", " ", clean(raw).replace("–", "-")).strip()


LETTER_SIZES = ["XXS", "XS", "S", "S-M", "M", "L", "XL", "XXL", "XXXL"]


def size_name(raw) -> str:
    """Danish size label: '7 - 9 YEARS' -> '7-9 år', '42 - 44 (L)' -> 'L (42-44)'."""
    size = normalize_size(raw)
    if m := re.fullmatch(r"(\d+) ?- ?(\d+) (YEARS|AÑOS)", size, re.I):
        return f"{m[1]}-{m[2]} år"
    if m := re.fullmatch(r"(\d+) ?- ?(\d+) MONTHS", size, re.I):
        return f"{m[1]}-{m[2]} mdr."
    if m := re.fullmatch(r"(\d+) ?- ?(\d+) \((XXS|XS|S|M|L|XL|XXL|XXXL)\)", size, re.I):
        return f"{m[3].upper()} ({m[1]}-{m[2]})"
    if m := re.fullmatch(r"(XXS|XS|S|M|L|XL|XXL) - DOG", size, re.I):
        return m[1].upper()
    if re.fullmatch(r"S-M MAN SPANDEX", size, re.I):
        return "S-M"
    if m := re.fullmatch(r"(\d+) ?- ?(\d+)", size):
        return f"{m[1]}-{m[2]}"
    return capitalize(size.lower())


def size_sort_key(name: str) -> tuple:
    """Months, then years, then letter sizes, then shoe sizes."""
    if m := re.fullmatch(r"(\d+)-(\d+) mdr\.", name):
        return (0, int(m[1]), int(m[2]), name)
    if m := re.fullmatch(r"(\d+)-(\d+) år", name):
        return (1, int(m[1]), int(m[2]), name)
    if m := re.fullmatch(r"(XXS|XS|S|S-M|M|L|XL|XXL|XXXL)(?: \((\d+)-(\d+)\))?", name):
        return (2, LETTER_SIZES.index(m[1]), int(m[2] or 0), name)
    if m := re.fullmatch(r"(\d+)-(\d+)", name):
        return (3, int(m[1]), int(m[2]), name)
    return (4, 0, 0, name)


def child_height(son_description) -> str:
    """'7 – 9 YEARS (137 CM)' -> '137 cm'."""
    m = re.search(r"\((\d+)\s*CM\)", clean(son_description), re.I)
    return f"{m[1]} cm" if m else ""


# ---------------------------------------------------------------- prices


def parse_eur(raw) -> float | None:
    try:
        value = float(clean(raw).replace(",", "."))
    except ValueError:
        return None
    return value if math.isfinite(value) else None


def unit_price_eur(rrp: float | None, description: str, sheet: str) -> tuple[float | None, str | None]:
    """Recommended price for one piece, and a note when it had to be derived.

    Display packs ("(DISPLAY 12 PCS)") are sold per piece. The Christmas sheet (GUIRMA)
    prices the whole display, the main sheet prices one piece.
    """
    if rrp is None:
        return None, None
    m = re.search(r"DISPLAY\s*(\d+)\s*PCS", description, re.I)
    if m and sheet == "GUIRMA":
        pieces = int(m[1])
        if pieces > 1 and rrp / pieces >= 0.5:
            return rrp / pieces, f"Pris pr. stk. beregnet ud fra displayprisen ({number_da(rrp)} EUR for {pieces} stk.)"
    return rrp, None


def price_dkk(eur: float) -> int:
    """Recommended price in EUR -> DKK, rounded to the nearest price ending in 9 (at least 9 kr.)."""
    dkk = eur * EUR_TO_DKK
    return max(9, math.floor((dkk + 1) / 10 + 0.5) * 10 - 1)


def price_problem(eur: float | None) -> str | None:
    if eur is None or eur <= 0:
        return "Mangler vejledende pris i Guircas ark"
    if eur > MAX_PLAUSIBLE_EUR:
        return f"Urealistisk vejledende pris i Guircas ark ({number_da(eur)} EUR)"
    return None


# ---------------------------------------------------------------- target group

USER_GROUPS = {
    "ADULT WOMAN": {"damer"},
    "ADULT MAN": {"herrer"},
    "ADULT UNISEX": {"damer", "herrer"},
    "CHILD GIRL": {"piger"},
    "CHILD BOY": {"drenge"},
    "CHILD UNISEX": {"piger", "drenge"},
    "TEEN GIRL": {"piger"},
    "TEEN BOY": {"drenge"},
    "TEEN UNISEX": {"piger", "drenge"},
    "BABY GIRL": {"baby"},
    "BABY BOY": {"baby"},
    "BABY UNISEX": {"baby"},
    "TODDLER": {"baby"},
    "DOG": {"hund"},
}
ADULTS = {"damer", "herrer"}
CHILDREN = {"piger", "drenge"}
GROUP_NAMES = {"damer": "Damer", "herrer": "Herrer", "piger": "Piger", "drenge": "Drenge", "baby": "Baby", "hund": "Hunde"}
GROUP_ORDER = list(GROUP_NAMES)


def groups_for(users) -> set[str]:
    """Target groups of one or more USER values ('ADULT / CHILD' and blanks mean everyone)."""
    groups: set[str] = set()
    for user in users:
        groups |= USER_GROUPS.get(clean(user).upper(), set())
    return groups


def audience(groups: set[str]) -> str:
    """'til piger', 'til voksne', … or '' when the product is for everyone."""
    if not groups:
        return ""
    if groups == {"hund"}:
        return "til hunde"
    adult, child, baby = bool(groups & ADULTS), bool(groups & CHILDREN), "baby" in groups
    if adult and (child or baby):
        return "til børn og voksne"
    if adult:
        return "til damer" if groups & ADULTS == {"damer"} else "til herrer" if groups & ADULTS == {"herrer"} else "til voksne"
    if child:
        if baby or groups & CHILDREN == CHILDREN:
            return "til børn"
        return "til piger" if "piger" in groups else "til drenge"
    return "til baby"


def group_values(groups: set[str]) -> list[str]:
    """Values for the 'Målgruppe' attribute."""
    return [GROUP_NAMES[g] for g in GROUP_ORDER if g in groups]


# ---------------------------------------------------------------- names

COSTUME_PARENTS = {"COSTUMES", "CUSTOMES"}


def costume_name(family: str, groups: set[str]) -> str:
    """'Mørk enhjørning' + girls -> 'Mørk enhjørning – kostume til piger'."""
    who = audience(groups)
    if re.search(r"kostume|dragt", family, re.I):
        return f"{family} {who}".strip()
    return f"{family} – kostume {who}".strip()


def family_name(family: str, groups: set[str]) -> str:
    """Sized non-costume families (sweaters, corsets, …): 'Julesweater' + kids -> 'Julesweater til børn'."""
    return f"{family} {audience(groups)}".strip()


# ---------------------------------------------------------------- unique names


@dataclass(frozen=True)
class NameFacts:
    """What can tell apart products with the same name, in the order the facts are tried."""
    size: str = ""  # 'ca. 23,5 cm'
    audience: str = ""  # 'til voksne'
    pack: str = ""  # '12 stk.'
    colour: str = ""  # 'hvid og rød'
    model: str = ""  # 'model 20113' (always tells them apart)


def measure(text: str) -> str:
    """The largest measure in a description: 'Mål: ca. 23,5 × 17,8 × 7,8 cm.' -> 'ca. 23,5 cm'."""
    m = re.search(r"Mål: ca\. (\d+(?:,\d+)?(?: × \d+(?:,\d+)?)*) cm", html.unescape(text or ""))
    if not m:
        return ""
    return f"ca. {number_da(max(float(v.replace(',', '.')) for v in m[1].split(' × ')))} cm"


def pack_size(text: str) -> str:
    """A pack size the text states: 'sæt med 12 …', '12 stk.', '2 ark' -> '12 stk.'."""
    text = html.unescape(text or "")
    m = re.search(r"\b(\d+) ?(?:stk\b|stykker\b|par\b|ark\b|pakker\b)|\bsæt med (\d+)\b", text, re.I)
    return f"{m[1] or m[2]} stk." if m else ""


def name_facts(*, text: str = "", groups=(), colours=(), code: str = "") -> NameFacts:
    """Facts from what the shop shows: the description, Målgruppe and Farve values, Guirca's number."""
    keys = {key for key, label in GROUP_NAMES.items() if label in groups}
    return NameFacts(
        size=measure(text),
        audience=audience(keys),
        pack=pack_size(text),
        colour=join_da(c.lower() for c in colours),
        model=f"model {code}" if code else "",
    )


def name_key(name: str) -> str:
    """Names that look the same in the shop get the same key (case, spacing and entities ignored)."""
    return re.sub(r"\s+", " ", html.unescape(name or "")).strip().casefold()


def name_states(name: str, kind: str, value: str) -> bool:
    """Whether the name already says this kind of fact ('Segl 47 cm' has a size, 'Cowboyvest
    til børn' an audience), so adding another one would only confuse."""
    name = name_key(name)
    if kind == "size":
        return bool(re.search(r"\d ?cm\b", name))
    if kind == "audience":
        return bool(re.search(r"\btil (?:damer|herrer|voksne|børn|piger|drenge|baby|hunde)\b", name))
    if kind == "pack":
        return bool(pack_size(name))
    if kind == "colour":
        return any(re.search(rf"\b{re.escape(colour)}", name) for colour in value.split(" og "))
    return value.casefold() in name


def unique_names(products: dict) -> dict:
    """New names for products that share their name with another product.

    `products` maps a key to (name, NameFacts). Each product with a shared name gets the first
    of its facts that none of the others with that name has and that the name does not already
    state ('Kraniemaske, PVC, hvid, ca. 23,5 cm'), and its model when no fact does. Only
    renamed products are returned.
    """
    groups = collections.defaultdict(list)
    for key, (name, _) in products.items():
        groups[name_key(name)].append(key)
    kinds = [f.name for f in fields(NameFacts)]
    renamed = {}
    for keys in groups.values():
        if len(keys) < 2:
            continue
        for key in keys:
            name, facts = products[key]
            suffix = next(
                (
                    value
                    for kind in kinds
                    if (value := getattr(facts, kind))
                    and not name_states(name, kind, value)
                    and sum(getattr(products[other][1], kind) == value for other in keys) == 1
                ),
                facts.model,
            )
            if suffix:
                renamed[key] = f"{name.strip()}, {suffix}"
    # A new name can be one another product already has: then the model tells them apart.
    taken = collections.Counter(name_key(renamed.get(key, name)) for key, (name, _) in products.items())
    for key, new in renamed.items():
        name, facts = products[key]
        if taken[name_key(new)] > 1 and facts.model and not new.endswith(facts.model):
            renamed[key] = f"{name.strip()}, {facts.model}"
    return renamed


# ---------------------------------------------------------------- categories

EROTIC = "EROTIC"
ADULT_ONLY = ("Polterabend (18+)",)
# The owner's decision (16-10-2026): products for adults only are sold only in
# Halloweenkostumer.dk, never in Fastelavnskostumer.dk. They stay published, and only Guirca's
# EROTIC items are in the 18+ category; the crude jokes below keep their own categories.
ADULT_WEBSHOPS = ("halloween-kostumer-dk",)

# Guirca files its sex games, lingerie and sado items under EROTIC, but most of its crude
# bachelor-party jokes elsewhere ("Penisforklæde", "Oppustelige bryster", the "Sexlegetøj"
# costume, a latex penis for Halloween). They are for adults only too (ADULT_WEBSHOPS only, in
# their own categories): products whose Danish name names genitals, breasts or nipples, sex,
# sex toys, condoms, sperm, nudity or bondage, or says something crude ("Fuckman", "Dickman",
# "Åben gylp", the aprons "med overraskelse").
# Words only where they mean that: "kæmpenisse" (a giant elf) has "penis" inside, a
# "skjortebryst" is a shirt front, "brystplade" a breastplate, "sexet" (sexy police, sexy
# bunny) is an ordinary adult costume, and "sex" alone is a slogan ("Sea, Sex & Sun" on a fan).
# The Danish name, not Guirca's English, so the `adult` command finds the same products in
# WooCommerce, where only the Danish texts are.
CRUDE_NAME = re.compile(
    r"\bpenis|penis\b|latexlem\b|testik(?:el|ler)|(?<!skjorte)bryst(?:er)?\b|brystvorte|kondom|sædcelle|"
    r"\bsex(?:legetøj|man)\b|fuck|\bdick|\bnøgen|åben gylp|med overraskelse|bondage|erotisk",
    re.I,
)
# Costumes with a penis among their contents ("Indhold: heldragt og penis."): the stallion, the
# caveman, the banana … Padded busts ("bryster") in drag and lifeguard costumes don't count.
CRUDE_CONTENT = re.compile(r"\bpenis|penis\b|testik(?:el|ler)", re.I)
# Crude products whose name and contents don't say so (their photos do), by Guirca's article
# number (a product with sizes: its lowest, which its SKU starts with).
CRUDE_ARTICLES = {
    "14038": "konfettikanoner med penisformet konfetti",
    # The bachelor-party cups as a pair: "Mister Sex" has a penis on it, "Miss Sexy" a naked pin-up.
    "17516": 'pokal "Mister Sex" med penis',
    "17518": 'pokal "Miss Sexy" med nøgen pin-up',
    "41141": "juleforklæde med nøgen mand",
    "69078": "kokkehue med penis",
    "80229": "bedstemor-kostume med nøgen krop under kjolen",
    "86041": "kostume formet som et kvindeligt kønsorgan",
}

COSTUME_CATEGORIES = {
    "damer": ("Kostumer", "Damekostumer"),
    "herrer": ("Kostumer", "Herrekostumer"),
    "piger": ("Kostumer", "Pigekostumer"),
    "drenge": ("Kostumer", "Drengekostumer"),
    "baby": ("Kostumer", "Babykostumer"),
    "hund": ("Kostumer", "Hundekostumer"),
}
COSTUME_CATEGORY_GROUPS = {"ADULT": ADULTS, "CHILDREN": CHILDREN, "TEEN": CHILDREN, "BABY AND TODDLER": {"baby"}}

CATEGORY_MAP = {
    "HATS AND CAPS": ("Tilbehør", "Hatte og hjelme"),
    "HEADBAND/TIARAS": ("Tilbehør", "Hovedpynt"),
    "CROWNS": ("Tilbehør", "Hovedpynt"),
    "MASKS": ("Tilbehør", "Masker"),
    "GLASSES": ("Tilbehør", "Briller"),
    "JEWELS": ("Tilbehør", "Smykker"),
    "WEAPONS": ("Tilbehør", "Våben og skjolde"),
    "CANES AND TRIDENTS": ("Tilbehør", "Stave og rekvisitter"),
    "MAGIC WANDS": ("Tilbehør", "Stave og rekvisitter"),
    "FANS": ("Tilbehør", "Stave og rekvisitter"),
    "WINGS": ("Tilbehør", "Vinger og fjer"),
    "FEATHERS": ("Tilbehør", "Vinger og fjer"),
    "SETS": ("Tilbehør", "Tilbehørssæt"),
    "GADGETS AND GAMES": ("Tilbehør", "Gadgets og sjov"),
    "JOKES AND MAGIC": ("Tilbehør", "Gadgets og sjov"),
    "TOYS": ("Tilbehør", "Gadgets og sjov"),
    "MUSICAL INSTRUMENTS": ("Tilbehør", "Gadgets og sjov"),
    "AWARDS AND TROPHIES": ("Tilbehør", "Gadgets og sjov"),
    "INFLATABLES": ("Tilbehør", "Gadgets og sjov"),
    "LED ACCESSORIES": ("Tilbehør", "Gadgets og sjov"),
    "MAKEUP SETS": ("Make-up", "Sminke og ansigtsmaling"),
    "CHILDREN'S MAKEUP": ("Make-up", "Sminke og ansigtsmaling"),
    "STICK MAKEUP": ("Make-up", "Sminke og ansigtsmaling"),
    "BLOOD AND LATEX": ("Make-up", "Blod og effekter"),
    "TATTOOS AND FX": ("Make-up", "Blod og effekter"),
    "PROSTHETICS": ("Make-up", "Blod og effekter"),
    "DENTURES": ("Make-up", "Blod og effekter"),
    "NAILS": ("Make-up", "Negle og øjenvipper"),
    "LASHES": ("Make-up", "Negle og øjenvipper"),
    "GLITTER": ("Make-up", "Glimmer og ansigtssmykker"),
    "FACE JEWEL": ("Make-up", "Glimmer og ansigtssmykker"),
    "PARTY DECORATION": ("Pynt og fest", "Festpynt"),
    "WALL/DOOR/WINDOW": ("Pynt og fest", "Festpynt"),
    "TABLE DECORATION": ("Pynt og fest", "Bordpynt"),
    "CANNONS": ("Pynt og fest", "Konfettikanoner"),
    "TRICK OR TREAT": ("Pynt og fest", "Slik eller ballade"),
    "PUMPKINS": ("Pynt og fest", "Halloweenpynt"),
    "PROPS AND SCARY DECORATION": ("Pynt og fest", "Halloweenpynt"),
    "SKULLS AND SKELETONS": ("Pynt og fest", "Halloweenpynt"),
    "GRAVESTONES": ("Pynt og fest", "Halloweenpynt"),
    "ANIMATRONICS": ("Pynt og fest", "Figurer og animatronics"),
    "DOLLS": ("Pynt og fest", "Figurer og animatronics"),
    "DOLLS AND HANGING DECORATIONS": ("Pynt og fest", "Figurer og animatronics"),
    "ANIMALS AND INSECTS": ("Pynt og fest", "Figurer og animatronics"),
    "LIGHTING AND EFFECTS": ("Pynt og fest", "Lys og effekter"),
    "ELECTRIC GARLANDS": ("Pynt og fest", "Lys og effekter"),
    "CANDLES": ("Pynt og fest", "Lys og effekter"),
    "CHRISTMAS DECORATION": ("Pynt og fest", "Julepynt"),
    "TREES": ("Pynt og fest", "Julepynt"),
    "TAMBOURINE AND BELLS": ("Pynt og fest", "Julepynt"),
    "BAG/POUCH": ("Pynt og fest", "Julepynt"),
}
WIG_SUBCATEGORIES = {
    "BEARDS AND MOUSTACHES": ("Tilbehør", "Skæg og overskæg"),
    "HAIR ACCESSORIES": ("Tilbehør", "Hovedpynt"),
}
MAKEUP_SUBCATEGORIES = {
    "BLOOD AND LATEX": "Blod og effekter",
    "TATTOOS AND FX": "Blod og effekter",
    "DENTURES": "Blod og effekter",
    "LASHES": "Negle og øjenvipper",
    "NAILS": "Negle og øjenvipper",
    "GLITTER": "Glimmer og ansigtssmykker",
    "FACE JEWEL": "Glimmer og ansigtssmykker",
}
TEXTILE_SUBCATEGORIES = {
    "TIGHTS AND SOCKS": "Strømper og leggings",
    "LEGGINGS": "Strømper og leggings",
    "SWEATER": "Sweatre",
    "BODYSUITS AND LEOTARDS": "Bodyer, toppe og korsetter",
    "TOPS": "Bodyer, toppe og korsetter",
    "TROUSERS AND SKIRTS": "Bukser og nederdele",
    "TUTUS": "Tutuer",
    "GLOVES": "Handsker",
    "SHIRTS AND APRONS": "Skjorter, veste og jakker",
    "WAISTCOATS AND JACKETS": "Skjorter, veste og jakker",
    "TIES": "Slips og butterflies",
    "BOWTIES": "Slips og butterflies",
    "CAPES": "Kapper",
    "HANDKERCHIEFS": "Tørklæder, bælter og seler",
    "BRACES AND BELTS": "Tørklæder, bælter og seler",
    "BOOT AND SHOE COVERS": "Støvleovertræk",
}

HALLOWEEN = ("Halloween",)
CHRISTMAS = ("Jul og nytår",)
HALLOWEEN_THEMES = {
    "Halloween", "Skeletons", "Witches", "Vampires", "Devil & Demons", "Day of the Dead", "Ghosts",
    "Zombie", "Werewolf", "Voodoo", "Lil Monsters", "Gothic",
}
HALLOWEEN_CATEGORIES = {"PROPS AND SCARY DECORATION", "SKULLS AND SKELETONS", "GRAVESTONES", "PUMPKINS", "TRICK OR TREAT"}
CHRISTMAS_THEMES = {
    "Christmas", "Santa Claus", "Reindeer", "Snowman", "Lil Xmas", "Wise Men", "Nativity scene", "New Year'S Eve", "Tree", "Elf",
}
CHRISTMAS_SEASONS = {"XMAS AND NEW YEAR", "X'MAS AND NEW YEAR"}

# Guirca's generic themes also mark whole ranges that have no season of their own: "Halloween" is
# on all of its everyday make-up (its Halloween catalogue carries the make-up: face paint in every
# colour, sponges, brushes, lipstick, lashes), and "Christmas" and "Elf" on fantasy, angel and
# royal accessories (elf ears, angel wings, a page's hat) and on light-green face paint. There
# they only count with a word of the season in Guirca's name for the item. A seasonal category,
# a specific theme ("Zombie", "Santa Claus") or Guirca's Christmas season still counts as before.
# Costumes, decorations, masks, weapons, wigs and blood keep the generic "Halloween": on them it
# marks scary items whose names often have no such word ("CROSS MASK, PVC", "MACHETE 50 CM").
GENERIC_HALLOWEEN_THEMES = {"Halloween"}
GENERIC_CHRISTMAS_THEMES = {"Christmas", "Elf"}
EVERYDAY_MAKEUP = {("Make-up", "Sminke og ansigtsmaling"), ("Make-up", "Glimmer og ansigtssmykker"), ("Make-up", "Negle og øjenvipper")}
HALLOWEEN_WORDS = re.compile(
    r"\b(?:halloween|pumpkins?|skulls?|skelet\w*|bones?|zombies?|witch\w*|vampir\w*|devil\w*|demon\w*|satanic|possessed|"
    r"ghosts?|spiders?|spiderwebs?|cobwebs?|blood\w*|scars?|wounds?|horror|terror|killers?|evil|dead|death|monsters?|"
    r"werewol\w*|gothic|catrina|bats?)\b",
    re.I,
)
CHRISTMAS_WORDS = re.compile(r"\b(?:christmas|x'?mas|santa|reindeers?|snowm[ae]n|nativity)\b", re.I)

# Top-level menu order, then subcategory order (the shop shows categories in this order).
CATEGORY_ORDER = [
    ("Kostumer",),
    *[COSTUME_CATEGORIES[g] for g in GROUP_ORDER],
    ("Tøj",),
    *[("Tøj", name) for name in dict.fromkeys(TEXTILE_SUBCATEGORIES.values())],
    ("Tilbehør",),
    ("Tilbehør", "Parykker"),
    ("Tilbehør", "Skæg og overskæg"),
    ("Tilbehør", "Hatte og hjelme"),
    ("Tilbehør", "Hovedpynt"),
    ("Tilbehør", "Masker"),
    ("Tilbehør", "Briller"),
    ("Tilbehør", "Smykker"),
    ("Tilbehør", "Våben og skjolde"),
    ("Tilbehør", "Stave og rekvisitter"),
    ("Tilbehør", "Vinger og fjer"),
    ("Tilbehør", "Tilbehørssæt"),
    ("Tilbehør", "Gadgets og sjov"),
    ("Make-up",),
    ("Make-up", "Sminke og ansigtsmaling"),
    ("Make-up", "Blod og effekter"),
    ("Make-up", "Glimmer og ansigtssmykker"),
    ("Make-up", "Negle og øjenvipper"),
    ("Pynt og fest",),
    ("Pynt og fest", "Halloweenpynt"),
    ("Pynt og fest", "Figurer og animatronics"),
    ("Pynt og fest", "Festpynt"),
    ("Pynt og fest", "Bordpynt"),
    ("Pynt og fest", "Lys og effekter"),
    ("Pynt og fest", "Konfettikanoner"),
    ("Pynt og fest", "Slik eller ballade"),
    ("Pynt og fest", "Julepynt"),
    HALLOWEEN,
    CHRISTMAS,
    ADULT_ONLY,
]


def is_erotic(row: dict) -> bool:
    return EROTIC in split_list(row.get("CATEGORY")) or EROTIC in split_list(row.get("SUBCATEGORY"))


def crude_reason(name: str, description: str = "", code: str = "") -> str:
    """Why a product is one of the crude jokes for adults (see CRUDE_NAME), '' when it isn't: a
    word in its Danish name, a content its description lists, or its Guirca article number."""
    if m := CRUDE_NAME.search(name or ""):
        return f'navn: "{m[0].lower()}"'
    if m := CRUDE_CONTENT.search(html.unescape(description or "")):
        return f'indhold: "{m[0].lower()}"'
    if code in CRUDE_ARTICLES:
        return f"varenr. {code}: {CRUDE_ARTICLES[code]}"
    return ""


def is_crude(name: str, description: str = "", code: str = "") -> bool:
    return bool(crude_reason(name, description, code))


def main_categories(row: dict, groups: set[str], sized: bool) -> list[tuple[str, ...]]:
    """Category paths for one sheet row. `groups` are the product's target groups."""
    if is_erotic(row):
        return [ADULT_ONLY]
    parent = clean(row.get("PARENT CATEGORY")).upper()
    categories = split_list(row.get("CATEGORY"))
    subcategories = split_list(row.get("SUBCATEGORY"))

    if parent in COSTUME_PARENTS:
        if not groups:
            for category in categories:
                groups = groups | COSTUME_CATEGORY_GROUPS.get(category, set())
        return [COSTUME_CATEGORIES[g] for g in GROUP_ORDER if g in groups] or [("Kostumer",)]

    for category in categories:
        if category == "TEXTILE":
            for sub in subcategories:
                if sub in TEXTILE_SUBCATEGORIES:
                    return [("Tøj", TEXTILE_SUBCATEGORIES[sub])]
            return [("Tøj",)]
        if category == "WIGS AND HAIR ACCESSORIES":
            for sub in subcategories:
                if sub in WIG_SUBCATEGORIES:
                    return [WIG_SUBCATEGORIES[sub]]
            return [("Tilbehør", "Parykker")]
        if category == "MAKE UP":
            for sub in subcategories:
                if sub in MAKEUP_SUBCATEGORIES:
                    return [("Make-up", MAKEUP_SUBCATEGORIES[sub])]
            return [("Make-up", "Sminke og ansigtsmaling")]
        if category in CATEGORY_MAP:
            return [CATEGORY_MAP[category]]

    # No (known) category in the sheet.
    if parent == "MAKE UP":
        return [("Make-up", "Sminke og ansigtsmaling")]
    if parent == "DECORATION":
        return [("Pynt og fest",)]
    description = clean(row.get("DESCRIPTION")).upper()
    if sized and groups:
        return [COSTUME_CATEGORIES[g] for g in GROUP_ORDER if g in groups]
    if "WIG" in description:
        return [("Tilbehør", "Parykker")]
    if "TEXTILE" in categories or "T-SHIRT" in description:
        return [("Tøj",)]
    return [("Tilbehør",)]


def themes(row: dict) -> list[str]:
    return split_list(row.get("THEME"))


def season_categories(row: dict) -> list[tuple[str, ...]]:
    """'Halloween' and 'Jul og nytår' next to the main category (see GENERIC_HALLOWEEN_THEMES)."""
    if is_erotic(row):
        return []
    row_themes = set(themes(row))
    categories = set(split_list(row.get("CATEGORY")))
    name = " ".join(clean(row.get(column)) for column in ("DESCRIPTION", "PARENT DESCRIPTION", "SON DESCRIPTION"))
    halloween_themes = row_themes & HALLOWEEN_THEMES
    if halloween_themes <= GENERIC_HALLOWEEN_THEMES and main_categories(row, set(), sized=False)[0] in EVERYDAY_MAKEUP and not HALLOWEEN_WORDS.search(name):
        halloween_themes = set()
    christmas_themes = row_themes & CHRISTMAS_THEMES
    make_up_or_accessory = clean(row.get("PARENT CATEGORY")).upper() in ("ACCESSORIES", "MAKE UP")
    if christmas_themes <= GENERIC_CHRISTMAS_THEMES and make_up_or_accessory and not CHRISTMAS_WORDS.search(name):
        christmas_themes = set()
    result = []
    if halloween_themes or categories & HALLOWEEN_CATEGORIES:
        result.append(HALLOWEEN)
    if clean(row.get("SEASON")).upper() in CHRISTMAS_SEASONS or christmas_themes:
        result.append(CHRISTMAS)
    return result


# Themes that are colours, categories or seasons already (not useful as tags).
SKIPPED_THEMES = {"Halloween", "Christmas", "Party Decoration", "Facial Jewels", "Electric garlands & Lightning", "Lights", "Erotic", "Sado"}


def tag_themes(row: dict) -> list[str]:
    return [t for t in themes(row) if t not in SKIPPED_THEMES and not re.search(r"col+our$", t, re.I)]


# ---------------------------------------------------------------- merchandising order

# The shop's "Anbefalet" sort is WooCommerce's menu_order (lowest first). It is set from what a
# product is, then newest first: menu_order = tier × TIER_STEP + the product's place in its tier.
TIER_STEP = 100_000
MERCHANDISING_TIERS = {
    ("Kostumer",): 0,
    ("Tilbehør", "Masker"): 1,
    ("Tilbehør", "Parykker"): 1,
    ("Tilbehør", "Skæg og overskæg"): 1,
    ("Tilbehør", "Hatte og hjelme"): 1,
    ("Make-up",): 1,
    ("Tilbehør",): 2,
    ("Tøj",): 2,
    ("Pynt og fest",): 3,
}
OTHER_TIER = 4  # the season categories, Polterabend (18+) and products without a category
TIER_NAMES = {
    0: "Kostumer",
    1: "Masker, parykker, hatte og make-up",
    2: "Andet tilbehør og tøj",
    3: "Pynt og fest",
    4: "Øvrige",
}


def slug_path(path: tuple[str, ...]) -> tuple[str, ...]:
    """('Tilbehør', 'Masker') -> ('tilbehoer', 'masker'), the slugs the import gives the categories."""
    return tuple(slugify(name) for name in path)


TIERS_BY_SLUGS = {slug_path(path): tier for path, tier in MERCHANDISING_TIERS.items()}


def category_slug_paths(categories: list[dict]) -> dict[int, tuple[str, ...]]:
    """WooCommerce categories ({id, slug, parent}) -> each one's slug path from the top."""
    by_id = {c["id"]: c for c in categories}
    paths: dict[int, tuple[str, ...]] = {}
    for category in categories:
        path, current, seen = [], category, set()
        while current and current["id"] not in seen:
            seen.add(current["id"])
            path.insert(0, current["slug"])
            current = by_id.get(current.get("parent"))
        paths[category["id"]] = tuple(path)
    return paths


def merchandising_tier(paths) -> int:
    """The tier of a product in these categories (slug paths): the best of them. A category
    without a tier of its own has its parent's ('tilbehoer/briller' is 'tilbehoer')."""
    tiers = [OTHER_TIER]
    for path in paths:
        for depth in range(len(path), 0, -1):
            if path[:depth] in TIERS_BY_SLUGS:
                tiers.append(TIERS_BY_SLUGS[path[:depth]])
                break
    return min(tiers)


def menu_orders(products) -> dict[int, int]:
    """menu_order for (id, date_created, tier) products: newest first within a tier, then highest id."""
    by_tier = collections.defaultdict(list)
    for product_id, created, tier in products:
        by_tier[tier].append((created or "", product_id))
    orders = {}
    for tier, members in by_tier.items():
        for rank, (_, product_id) in enumerate(sorted(members, reverse=True)):
            orders[product_id] = tier * TIER_STEP + rank
    return orders


# ---------------------------------------------------------------- descriptions

IGNORED_CONTENT = {"WITH", "SET", "PIECES", "PARTY STUFF"}


def content_items(row: dict, vocabulary: dict) -> list[str]:
    """CONTENT in Danish, without quantity tokens and splitting leftovers."""
    items = []
    for item in split_list(row.get("CONTENT")):
        if item.isdigit() or item.upper() in IGNORED_CONTENT:
            continue
        items.append(vocabulary.get(item, item.lower()))
    return list(dict.fromkeys(items))


def translated(values: list[str], vocabulary: dict) -> list[str]:
    return list(dict.fromkeys(vocabulary.get(v, v.lower()) for v in values if v))


def battery_text(raw) -> str:
    """'AA 3 No' -> 'Kræver 3 × AA-batterier (medfølger ikke).'"""
    text = clean(raw).upper()
    if not text:
        return ""
    *rest, included = text.split(" ")
    included = included == "YES"
    rest = " ".join(rest).strip()
    if "USB" in rest:
        return "Genoplades via USB."
    count, kind = 0, rest
    if m := re.match(r"^(\d+)\s*X\s*([A-Z0-9]+)", rest):
        count, kind = int(m[1]), m[2]
    elif m := re.match(r"^([A-Z0-9 ]+?)\s*-\s*(\d+)", rest):
        kind, count = m[1], int(m[2])
    elif m := re.match(r"^(.*?)\s*(\d+)$", rest):
        kind, count = m[1], int(m[2])
    kind = kind.replace(" ", "")
    if not kind or kind == "NO":
        return ""
    if count > 0:
        pieces = f"{count} × {kind}-{'batteri' if count == 1 else 'batterier'}"
    else:
        pieces = f"{kind}-batterier"
    return f"Leveres med {pieces}." if included else f"Kræver {pieces} (medfølger ikke)."


def features_text(row: dict) -> str:
    flags = [("WITH LIGHT", "lys"), ("WITH SOUND", "lyd"), ("WITH MOVEMENT", "bevægelse")]
    features = [label for column, label in flags if clean(row.get(column)).upper() in {"SI", "YES"}]
    text = f"Med {join_da(features)}." if features else ""
    if clean(row.get("SOUND SENSOR")).upper() == "YES":
        text = f"{text} Starter, når den hører lyd.".strip()
    return text


def age_text(raw) -> str:
    """'+ 6 Years' -> 'Anbefalet alder: fra 6 år.'; '8 – 11 Years' -> 'Anbefalet alder: 8-11 år.'"""
    text = clean(raw).replace("–", "-")
    if m := re.search(r"\+\s*(\d+)", text):
        return f"Anbefalet alder: fra {m[1]} år."
    if m := re.search(r"(\d+)\s*-\s*(\d+)", text):
        return f"Anbefalet alder: {m[1]}-{m[2]} år."
    return ""


def safety_text(row: dict) -> str:
    fire = clean(row.get("FIRE RETARDANT")).upper() == "YES"
    ce = clean(row.get("CE")).upper() == "S"
    if fire and ce:
        return "Brandhæmmende materiale og CE-mærket."
    if fire:
        return "Brandhæmmende materiale."
    if ce:
        return "CE-mærket."
    return ""


def dimensions_text(row: dict) -> str:
    sizes = []
    for column in ("LENGTH PRODUCT W/O PACKAGING", "WIDTH PRODUCT W/O PACKAGING", "HEIGHT PRODUCT W/O PACKAGING"):
        value = parse_eur(row.get(column))
        if value and value > 0:
            sizes.append(number_da(value))
    return f"Mål: ca. {' × '.join(sizes)} cm." if len(sizes) >= 2 else ""


def paragraphs_html(paragraphs: list[str]) -> str:
    return "".join(f"<p>{html.escape(p, quote=False)}</p>" for p in paragraphs if p)


def describe(
    row: dict,
    vocabulary: dict,
    *,
    costume: bool,
    groups: set[str],
    sizes: list[str] | None = None,
    colours: list[str] | None = None,
) -> tuple[str, str]:
    """(short description, description) as HTML paragraphs, built from the sheet's facts."""
    content = content_items(row, vocabulary.get("CONTENT", {}))
    materials = translated(split_list(row.get("MATERIALS")), vocabulary.get("MATERIALS", {}))
    fabrics = translated(split_list(row.get("FABRIC")), vocabulary.get("FABRIC", {}))
    colours = colours if colours is not None else translated(split_list(row.get("COLORS")), vocabulary.get("COLORS", {}))

    who = audience(groups)
    features = features_text(row)
    if costume:
        short = f"Kostume {who} med {join_da(content)}." if content else f"Kostume {who}."
        short = re.sub(r"\s+", " ", short)
    elif len(content) >= 2:
        short = f"Med {join_da(content)}."
    else:
        short = features

    looks = []
    if materials:
        material = join_da(materials)
        if fabrics and set(fabrics) - set(materials):
            material += f" ({join_da(f for f in fabrics if f not in materials)})"
        looks.append(f"Materiale: {material}.")
    if colours:
        looks.append(f"Farve: {join_da(colours)}.")

    paragraphs = [
        f"Indhold: {join_da(content)}." if content and (costume or len(content) >= 2) else "",
        f"Størrelser: {join_da(sizes)}." if sizes else "",
        " ".join(looks),
        "" if costume or sizes else dimensions_text(row),
        " ".join(t for t in (features if short != features else "", battery_text(row.get("BATTERIES"))) if t),
        " ".join(t for t in (safety_text(row), age_text(row.get("RECOMMENDED AGE"))) if t),
        MANUFACTURER + ".",
    ]
    return paragraphs_html([short]), paragraphs_html(paragraphs)


# ---------------------------------------------------------------- images

IMAGE_HOST = "https://marketing.guirca.com"

# The sheet's photo columns, best first, and the ending Guirca gives that photo's file on its
# image server: {IMAGE_HOST}/{code}/{code}{ending}.jpg (LINK, the main photo, is {code}.jpg).
IMAGE_COLUMNS = {
    "LINK": "",
    "Link_CostumeCat": "_01", "Link_AccesoriesCatalogue": "_07", "Link_DecoCatalogue": "_14",
    "Link_AccesoriesW/OPackaging": "_08", "Link_DecoW/Opackaging": "_15",
    "Link_CostumeBack": "_02", "Link_AccesoriesView1": "_10", "Link_AccesoriesView2": "_11", "Link_AccesoriesView3": "_12",
    "Link_DecoSide": "_17", "Link_DecoBack": "_18",
    "Link_CostumeDetail1": "_05", "Link_CostumeDetail2": "_06", "Link_CostumeDetail3": "_13", "Link_DecoDetail": "_19",
    "Link_CostumeUnisex": "_03",
    "Link_CostumePackaging": "_04", "Link_AccesoriesW/Packaging": "_09", "Link_DecoW/Packaging": "_16", "Link_DecoBatteries": "_20",
}


@dataclass(frozen=True)
class ImageStatus:
    """What an image check (import_guirca.py images) answered: photos that exist, links that don't.

    Links it has no answer for (not checked, timeouts, server errors) are in neither set.
    """
    found: frozenset[str] = frozenset()
    dead: frozenset[str] = frozenset()

    @classmethod
    def parse(cls, lines) -> ImageStatus:
        """From lines of 'url<TAB>HTTP status<TAB>content type'; a later answer for a URL wins."""
        found: set[str] = set()
        dead: set[str] = set()
        for line in lines:
            url, status, content_type = (line.rstrip("\n").split("\t") + ["", ""])[:3]
            if status.startswith("2") and content_type.startswith("image/"):
                found.add(url)
                dead.discard(url)
            elif status in ("404", "410") or status.startswith("2"):
                dead.add(url)
                found.discard(url)
        return cls(frozenset(found), frozenset(dead))


def sheet_images(row: dict) -> list[tuple[int, str]]:
    """(rank, https link) for each photo the sheet lists for the row, rank 0 best."""
    links = []
    for rank, column in enumerate(IMAGE_COLUMNS):
        for part in clean(row.get(column)).split(","):
            url = https(part)
            if url.startswith("https://"):
                links.append((rank, url))
    return links


def server_images(code: str) -> list[str]:
    """Every photo Guirca's image server can have for an article, best first.

    The sheet often lists only some of them, and a few rows have a space in the code of their
    links (13101 /13101 _07.jpg); these names use the code itself.
    """
    code = re.sub(r"\s+", "", clean(code))
    return [f"{IMAGE_HOST}/{code}/{code}{ending}.jpg" for ending in IMAGE_COLUMNS.values()] if code else []


def image_candidates(row: dict) -> list[str]:
    """The links an image check should answer for the row."""
    return list(dict.fromkeys([url for _, url in sheet_images(row)] + server_images(row.get("ARTICLE CODE", ""))))


def all_image_urls(row: dict, status: ImageStatus = ImageStatus()) -> list[str]:
    """The row's photos over https, best first: the sheet's links that are not dead, and the
    photos the image check found on Guirca's server that the sheet does not list."""
    ranked = [(rank, url) for rank, url in sheet_images(row) if url not in status.dead]
    ranked += [(rank, url) for rank, url in enumerate(server_images(row.get("ARTICLE CODE", ""))) if url in status.found]
    ranked.sort(key=lambda item: item[0])  # stable: the sheet's own link first within a rank
    return list(dict.fromkeys(url for _, url in ranked))


def image_urls(row: dict, status: ImageStatus = ImageStatus()) -> list[str]:
    """The photos the product gets: all_image_urls without a main photo that shows the same
    photo twice (without_double_photos)."""
    return without_double_photos(all_image_urls(row, status))


GUIRCA_PHOTO = re.compile(rf"^{re.escape(IMAGE_HOST)}/([^/]+)/\1(_\d\d)?\.jpg$")
DOUBLE_PHOTOS_FILE = Path(__file__).resolve().parents[2] / "src" / "config" / "guirca-double-photos.json"


@functools.cache
def double_photo_codes() -> frozenset[str]:
    """Articles whose main photo shows the product twice: found by import_guirca.py doubles
    ("codes") or by looking at the photos ("by_eye"). The storefront reads the same file."""
    try:
        data = json.loads(DOUBLE_PHOTOS_FILE.read_text())
    except FileNotFoundError:
        return frozenset()
    return frozenset(data["codes"]) | frozenset(data.get("by_eye", []))


def without_double_photos(urls: list[str], doubles: frozenset[str] | None = None) -> list[str]:
    """Leaves out Guirca's main photo (<nr>/<nr>.jpg) when it shows the same photo twice: a large
    crop with the same photo again, smaller, beside it or in a corner. A costume's main photo is
    always like that, so it goes when the costume's catalogue photo (<nr>/<nr>_01.jpg, the whole
    costume) is there; for other articles the main photo goes when its article is in `doubles`
    (double_photo_codes()). A main photo that is the product's only photo is kept."""
    doubles = double_photo_codes() if doubles is None else doubles
    matches = [(url, GUIRCA_PHOTO.match(url)) for url in urls]
    with_catalogue = {m[1] for _, m in matches if m and m[2] == "_01"}
    kept = [url for url, m in matches if not (m and m[2] is None and (m[1] in with_catalogue or m[1] in doubles))]
    return kept or urls


def video_urls(row: dict) -> list[str]:
    """YouTube links, one per video (the sheet lists both embed and short links)."""
    ids = []
    for url in split_list(row.get("LINK VIDEOS")):
        if m := re.search(r"(?:youtu\.be/|/embed/|v=)([\w-]{6,})", url):
            ids.append(m[1])
    return [f"https://www.youtube.com/watch?v={video_id}" for video_id in dict.fromkeys(ids)]
