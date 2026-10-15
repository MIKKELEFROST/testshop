"""Guirca's product sheet -> one spec per WooCommerce product.

Sizes of the same item share Guirca's size connector ("CONNECTOR SIZE") and become one
variable product with a variation per size. Everything else becomes a simple product.
"""
from __future__ import annotations

import collections
import hashlib
import json
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path

import rules

SHEETS = ("GUIRCA", "GUIRMA")
# The Christmas sheet (GUIRMA) misspells two columns.
RENAMED_COLUMNS = {"COUNTY OF ORIGIN": "COUNTRY OF ORIGIN", "RRP AMAZAZON ES": "RRP AMAZON ES"}
SKU_PREFIX = "GU-"


@dataclass
class Translations:
    families: dict[str, str]
    names: dict[str, str]
    vocabulary: dict[str, dict[str, str]]

    @classmethod
    def load(cls, directory: Path) -> "Translations":
        def read(name):
            return json.loads((directory / name).read_text(encoding="utf-8"))

        # Keys are compared the way the sheet is read (entities decoded, spaces collapsed).
        def normalized(mapping):
            return {rules.clean(k): v for k, v in mapping.items()}

        vocabulary = read("vocabulary.json")
        return cls(
            families=normalized(read("families.json")),
            names=normalized(read("names.json")),
            vocabulary={k: normalized(v) for k, v in vocabulary.items()},
        )


@dataclass
class VariationSpec:
    code: str
    sku: str
    size: str
    ean: str
    price: int | None
    weight: str
    issue: str | None = None


@dataclass
class ProductSpec:
    key: str
    kind: str  # "simple" or "variable"
    sheet: str
    codes: list[str]
    sku: str
    name: str
    short_description: str
    description: str
    categories: list[tuple[str, ...]]
    tags: list[str]
    sizes: list[str]
    groups: list[str]
    colours: list[str]
    images: list[str]
    price: int | None
    ean: str
    weight: str
    dimensions: dict[str, str]
    meta: dict[str, object]
    status: str
    adult_only: bool
    intro_year: int | None
    issues: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    variations: list[VariationSpec] = field(default_factory=list)

    def fingerprint(self) -> str:
        """Changes whenever anything the importer writes changes."""
        data = json.dumps(asdict(self), sort_keys=True, ensure_ascii=False, default=list)
        return hashlib.sha1(data.encode()).hexdigest()


@dataclass
class Skipped:
    code: str
    description: str
    reason: str


def read_sheet(path: Path) -> list[dict]:
    """Both sheets as rows (dicts of text), the main sheet first, each article once."""
    import pandas as pd

    frames = []
    for sheet in SHEETS:
        frame = pd.read_excel(path, sheet_name=sheet, dtype=str).rename(columns=RENAMED_COLUMNS)
        frame["sheet"] = sheet
        frames.append(frame)
    rows, seen = [], set()
    for row in pd.concat(frames, ignore_index=True).to_dict("records"):
        code = rules.clean(row.get("ARTICLE CODE"))
        # 20 Christmas make-up articles are listed in both sheets; the main sheet wins.
        if code and code not in seen:
            seen.add(code)
            rows.append({k: rules.clean(v) for k, v in row.items()})
    return rows


def row_description(row: dict) -> str:
    if row.get("DESCRIPTION"):
        return row["DESCRIPTION"]
    return ", ".join(p for p in (row.get("PARENT DESCRIPTION"), row.get("SON DESCRIPTION")) if p)


def is_shop_fixture(description: str) -> bool:
    """Display stands for shops ('CHRISTMAS DISPLAY 187 x 30 x 61 CM'), not "(DISPLAY 12 PCS)" packs."""
    return bool(re.search(r"\bDISPLAY\b", description, re.I)) and not re.search(r"DISPLAY\s*\d+\s*PCS", description, re.I)


def code_key(code: str) -> tuple:
    return (int(code), code) if code.isdigit() else (10**9, code)


def build(rows: list[dict], translations: Translations, images: rules.ImageStatus = rules.ImageStatus()):
    """(product specs, skipped rows) for the whole sheet."""
    skipped: list[Skipped] = []
    families: dict[str, list[dict]] = collections.defaultdict(list)
    singles: list[dict] = []
    for row in rows:
        description = row_description(row)
        if not description:
            skipped.append(Skipped(row["ARTICLE CODE"], "", "Har hverken navn eller beskrivelse i arket"))
            continue
        if is_shop_fixture(description):
            skipped.append(Skipped(row["ARTICLE CODE"], description, "Butiksinventar (display), ikke en vare"))
            continue
        row["_description"] = description
        connector = row.get("CONNECTOR SIZE", "")
        if rules.normalize_size(row.get("SIZE")) and connector and row.get("PARENT DESCRIPTION"):
            families[connector].append(row)
        else:
            singles.append(row)

    specs = [variable_spec(members, translations, images) for members in families.values()]
    specs += [simple_spec(row, translations, images) for row in singles]
    disambiguate(specs)
    specs.sort(key=lambda s: code_key(s.codes[0]))
    return specs, skipped


def common_fields(row: dict, translations: Translations, images: rules.ImageStatus, groups: set[str], sized: bool):
    vocabulary = translations.vocabulary
    categories = rules.main_categories(row, groups, sized)
    adult_only = categories == [rules.ADULT_ONLY]
    tags = [vocabulary["THEME"].get(t, t) for t in rules.tag_themes(row)]
    meta = {
        "_supplier": "Guirca",
        "_hs_code": row.get("HS CODE", ""),
        "_country_of_origin": row.get("COUNTRY OF ORIGIN", ""),
        "_wchc_external_images": rules.image_urls(row, images),
    }
    if row.get("Link_GPSR"):
        meta["_wchc_safety_info"] = rules.https(row["Link_GPSR"])
    if videos := rules.video_urls(row):
        meta["_wchc_videos"] = videos
    year = row.get("INTRO YEAR", "")
    return {
        "categories": categories,
        "adult_only": adult_only,
        "tags": list(dict.fromkeys(tags)),
        "meta": meta,
        "intro_year": int(year) if year.isdigit() else None,
    }


def weight(row: dict) -> str:
    value = rules.parse_eur(row.get("GROSS WEIGHT"))
    return f"{value:g}" if value and value > 0 else ""


def dimensions(row: dict) -> dict[str, str]:
    columns = {"length": "PRODUCT LENGHT WITH PACKAGING", "width": "PRODUCT WIDTH WITH PACKAGING", "height": "PRODUCT HEIGHT WITH PACKAGING"}
    values = {k: rules.parse_eur(row.get(c)) for k, c in columns.items()}
    if not all(v and v > 0 for v in values.values()):
        return {}
    return {k: f"{v:g}" for k, v in values.items()}


def price_for(row: dict) -> tuple[int | None, str | None, str | None]:
    """(DKK price, problem, note) for one article."""
    eur, note = rules.unit_price_eur(rules.parse_eur(row.get("RRP AMAZON EU")), row["_description"], row["sheet"])
    problem = rules.price_problem(eur)
    return (None if problem else rules.price_dkk(eur)), problem, note


def colours_of(rows: list[dict], translations: Translations) -> list[str]:
    values = [c for row in rows for c in rules.split_list(row.get("COLORS"))]
    return rules.translated(values, translations.vocabulary["COLORS"])


def variable_spec(members: list[dict], translations: Translations, images: rules.ImageStatus) -> ProductSpec:
    members = sorted(members, key=lambda r: rules.size_sort_key(rules.size_name(r.get("SIZE"))))
    by_code = sorted(members, key=lambda r: code_key(r["ARTICLE CODE"]))
    first = by_code[0]
    codes = [r["ARTICLE CODE"] for r in members]
    groups = rules.groups_for(r.get("USER") for r in members)
    costume = first.get("PARENT CATEGORY", "").upper() in rules.COSTUME_PARENTS
    issues, notes = [], []

    parent_description = collections.Counter(r["PARENT DESCRIPTION"] for r in by_code).most_common(1)[0][0]
    family = translations.families.get(parent_description)
    if not family:
        family = rules.capitalize(parent_description.lower())
        issues.append(f"Mangler dansk navn for '{parent_description}'")
    name = rules.costume_name(family, groups) if costume else rules.family_name(family, groups)

    variations, labels = [], []
    for row in members:
        size = rules.size_name(row.get("SIZE"))
        price, problem, note = price_for(row)
        if note:
            notes.append(note)
        height = rules.child_height(row.get("SON DESCRIPTION"))
        labels.append(f"{size} ({height})" if height else size)
        variations.append(
            VariationSpec(
                code=row["ARTICLE CODE"],
                sku=SKU_PREFIX + row["ARTICLE CODE"],
                size=size,
                ean=row.get("EAN", ""),
                price=price,
                weight=weight(row),
                issue=f"{size}: {problem}" if problem else None,
            )
        )
    issues += [v.issue for v in variations if v.issue]

    colours = colours_of(members, translations)
    common = common_fields(first, translations, images, groups, sized=True)
    seasons = [c for r in by_code for c in rules.season_categories(r)]
    common["categories"] = list(dict.fromkeys(common["categories"] + seasons))
    # Each size has its own copy of the photos, and a few sizes have more than the others:
    # use the size with the most (the lowest article number if several have as many).
    common["meta"]["_wchc_external_images"] = max((rules.image_urls(row, images) for row in by_code), key=len)
    common["meta"]["_supplier_article_codes"] = ",".join(codes)
    common["meta"]["_guirca_size_connector"] = first.get("CONNECTOR SIZE", "")
    if first.get("SIZE_CHART"):
        common["meta"]["_wchc_size_chart"] = rules.https(first["SIZE_CHART"])
    short, description = rules.describe(first, translations.vocabulary, costume=costume, groups=groups, sizes=labels, colours=colours)

    sorted_codes = sorted(codes, key=code_key)
    return ProductSpec(
        key="G" + first.get("CONNECTOR SIZE", first["ARTICLE CODE"]),
        kind="variable",
        sheet=first["sheet"],
        codes=codes,
        sku=f"{SKU_PREFIX}{sorted_codes[0]}-{sorted_codes[-1]}",
        name=name,
        short_description=short,
        description=description,
        sizes=[v.size for v in variations],
        groups=rules.group_values(groups),
        colours=[rules.capitalize(c) for c in colours],
        images=common["meta"]["_wchc_external_images"],
        price=None,
        ean="",
        weight=weight(first),
        dimensions=dimensions(first),
        status="publish" if any(v.price for v in variations) and not any("dansk navn" in i for i in issues) else "draft",
        issues=issues,
        notes=list(dict.fromkeys(notes)),
        variations=variations,
        **{k: v for k, v in common.items() if k != "meta"},
        meta=common["meta"],
    )


def simple_spec(row: dict, translations: Translations, images: rules.ImageStatus) -> ProductSpec:
    description = row["_description"]
    groups = rules.groups_for([row.get("USER")])
    costume = row.get("PARENT CATEGORY", "").upper() in rules.COSTUME_PARENTS
    sized = bool(rules.normalize_size(row.get("SIZE")))
    issues, notes = [], []

    name = translations.names.get(description)
    if not name:
        name = rules.capitalize(description.lower())
        issues.append(f"Mangler dansk navn for '{description}'")
    if description.lower() == "translation not available":
        notes.append("Guirca har intet navn på varen; navnet er sat ud fra kategorien")

    price, problem, note = price_for(row)
    if problem:
        issues.append(problem)
    if note:
        notes.append(note)

    colours = colours_of([row], translations)
    common = common_fields(row, translations, images, groups, sized)
    common["categories"] = list(dict.fromkeys(common["categories"] + rules.season_categories(row)))
    common["meta"]["_supplier_article_codes"] = row["ARTICLE CODE"]
    short, text = rules.describe(row, translations.vocabulary, costume=costume, groups=groups, colours=colours)

    return ProductSpec(
        key="S" + row["ARTICLE CODE"],
        kind="simple",
        sheet=row["sheet"],
        codes=[row["ARTICLE CODE"]],
        sku=SKU_PREFIX + row["ARTICLE CODE"],
        name=name,
        short_description=short,
        description=text,
        sizes=[],
        groups=rules.group_values(groups),
        colours=[rules.capitalize(c) for c in colours],
        images=common["meta"]["_wchc_external_images"],
        price=price,
        ean=row.get("EAN", ""),
        weight=weight(row),
        dimensions=dimensions(row),
        status="draft" if issues else "publish",
        issues=issues,
        notes=notes,
        **{k: v for k, v in common.items() if k != "meta"},
        meta=common["meta"],
    )


def disambiguate(specs: list[ProductSpec]) -> None:
    """Products that would share a name get their colours added ('…, rød og gul')."""
    by_name = collections.defaultdict(list)
    for spec in specs:
        by_name[spec.name.lower()].append(spec)
    for same in by_name.values():
        if len(same) < 2 or len({tuple(s.colours) for s in same}) < 2:
            continue
        for spec in same:
            if spec.colours:
                spec.name = f"{spec.name}, {rules.join_da(c.lower() for c in spec.colours)}"
