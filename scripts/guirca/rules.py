"""Rules that turn rows of Guirca's product sheet into Danish shop data.

Pure functions without I/O, so they can be unit-tested (test_rules.py) and reused for
other suppliers. Everything the shop sees in Danish (names, sizes, categories, texts) is
decided here.
"""
from __future__ import annotations

import html
import math
import re
import unicodedata

EUR_TO_DKK = 7.46
# Prices in the sheet above this are errors (e.g. 1,455,985.44 EUR for a toy gun).
MAX_PLAUSIBLE_EUR = 5000.0
MAX_IMAGES = 8

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


# ---------------------------------------------------------------- categories

EROTIC = "EROTIC"
ADULT_ONLY = ("Polterabend (18+)",)

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
    """'Halloween' and 'Jul og nytår' next to the main category."""
    if is_erotic(row):
        return []
    row_themes = set(themes(row))
    categories = set(split_list(row.get("CATEGORY")))
    result = []
    if row_themes & HALLOWEEN_THEMES or categories & HALLOWEEN_CATEGORIES:
        result.append(HALLOWEEN)
    if clean(row.get("SEASON")).upper() in CHRISTMAS_SEASONS or row_themes & CHRISTMAS_THEMES:
        result.append(CHRISTMAS)
    return result


# Themes that are colours, categories or seasons already (not useful as tags).
SKIPPED_THEMES = {"Halloween", "Christmas", "Party Decoration", "Facial Jewels", "Electric garlands & Lightning", "Lights", "Erotic", "Sado"}


def tag_themes(row: dict) -> list[str]:
    return [t for t in themes(row) if t not in SKIPPED_THEMES and not re.search(r"col+our$", t, re.I)]


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

IMAGE_COLUMNS = [
    "LINK",
    "Link_CostumeCat", "Link_AccesoriesCatalogue", "Link_DecoCatalogue",
    "Link_AccesoriesW/OPackaging", "Link_DecoW/Opackaging",
    "Link_CostumeBack", "Link_AccesoriesView1", "Link_AccesoriesView2", "Link_AccesoriesView3",
    "Link_DecoSide", "Link_DecoBack",
    "Link_CostumeDetail1", "Link_CostumeDetail2", "Link_CostumeDetail3", "Link_DecoDetail",
    "Link_CostumeUnisex",
    "Link_CostumePackaging", "Link_AccesoriesW/Packaging", "Link_DecoW/Packaging", "Link_DecoBatteries",
]


def image_urls(row: dict, broken: set[str] | frozenset = frozenset()) -> list[str]:
    """The row's photos over https, best first, without known broken links."""
    urls = []
    for column in IMAGE_COLUMNS:
        for part in clean(row.get(column)).split(","):
            url = https(part)
            if url.startswith("https://") and url not in broken:
                urls.append(url)
    return list(dict.fromkeys(urls))[:MAX_IMAGES]


def video_urls(row: dict) -> list[str]:
    """YouTube links, one per video (the sheet lists both embed and short links)."""
    ids = []
    for url in split_list(row.get("LINK VIDEOS")):
        if m := re.search(r"(?:youtu\.be/|/embed/|v=)([\w-]{6,})", url):
            ids.append(m[1])
    return [f"https://www.youtube.com/watch?v={video_id}" for video_id in dict.fromkeys(ids)]
