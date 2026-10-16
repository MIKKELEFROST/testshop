#!/usr/bin/env python3
"""Import Guirca's product sheet into WooCommerce. See docs/IMPORT-GUIRCA.md.

    python3 scripts/guirca/import_guirca.py images <sheet.xlsx> --out images.tsv  # which photos exist at Guirca
    python3 scripts/guirca/import_guirca.py report <sheet.xlsx>           # what would be imported (no WooCommerce)
    python3 scripts/guirca/import_guirca.py import <sheet.xlsx> --dry-run # plan against WooCommerce, no writes
    python3 scripts/guirca/import_guirca.py import <sheet.xlsx> --sample 100
    python3 scripts/guirca/import_guirca.py import <sheet.xlsx>           # everything
    python3 scripts/guirca/import_guirca.py order [--apply]   # "Anbefalet" order (menu_order) of all products
    python3 scripts/guirca/import_guirca.py names [--apply]   # unique names for products that share one
    python3 scripts/guirca/import_guirca.py adult [--apply]   # products for adults only (18+) as drafts

Pass --image-status images.tsv to report and import to use the photos the check found.
order, names and adult only read WooCommerce unless --apply is given.
WooCommerce credentials come from WOOCOMMERCE_URL, WOOCOMMERCE_CONSUMER_KEY and
WOOCOMMERCE_CONSUMER_SECRET (e.g. `set -a; . ./.env.local; set +a`).

Safe to run again: products are matched on Guirca's article numbers, unchanged products
are skipped, and texts, categories, tags, status, webshops and stock settings are only set
when a product is created (use --overwrite to set them again).
"""
from __future__ import annotations

import argparse
import collections
import csv
import datetime as dt
import html
import json
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))

import catalog  # noqa: E402
import rules  # noqa: E402
from woo import Woo, WooError  # noqa: E402

HERE = Path(__file__).resolve().parent
IMPORTER_VERSION = "1"
DEFAULT_WEBSHOPS = "halloween-kostumer-dk,piece-dk"
# 18+ products are only sold in these webshops (of those the import assigns).
ADULT_WEBSHOPS = ("halloween-kostumer-dk",)
BRAND = "Guirca"
SIZE, GROUP, COLOUR = "Størrelse", "Målgruppe", "Farve"
SHOP_OWNED = ("texts", "categories", "tags", "status", "webshops", "stock")


# ---------------------------------------------------------------- loading


def load_specs(args) -> tuple[list[catalog.ProductSpec], list[catalog.Skipped]]:
    images = rules.ImageStatus()
    if args.image_status:
        images = rules.ImageStatus.parse(Path(args.image_status).read_text().splitlines())
    rows = catalog.read_sheet(Path(args.sheet))
    translations = catalog.Translations.load(HERE / "translations")
    return catalog.build(rows, translations, images)


def select(specs: list[catalog.ProductSpec], args) -> list[catalog.ProductSpec]:
    if args.codes:
        wanted = {c.strip() for c in args.codes.split(",") if c.strip()}
        return [s for s in specs if wanted & set(s.codes)]
    if args.sample:
        # A spread over the categories: one product per category in turn.
        by_category = collections.defaultdict(list)
        for spec in specs:
            by_category[spec.categories[0]].append(spec)
        queues = [collections.deque(v) for _, v in sorted(by_category.items())]
        chosen = []
        while len(chosen) < args.sample and any(queues):
            for queue in queues:
                if queue and len(chosen) < args.sample:
                    chosen.append(queue.popleft())
        return sorted(chosen, key=lambda s: catalog.code_key(s.codes[0]))
    if args.limit:
        return specs[: args.limit]
    return specs


# ---------------------------------------------------------------- image check


def check_images(args) -> int:
    """Ask Guirca's image server about every photo the sheet lists and every photo the server
    can have for its articles (the sheet often lists only some of them).

    Answers are appended to --out as they come, and links already answered there are not asked
    again, so an interrupted check is simply started again. Use a new file to ask about all.
    """
    rows = catalog.read_sheet(Path(args.sheet))
    urls = list(dict.fromkeys(url for row in rows for url in rules.image_candidates(row)))
    out = Path(args.out)
    known = rules.ImageStatus.parse(out.read_text().splitlines()) if out.exists() else rules.ImageStatus()
    todo = [url for url in urls if url not in known.found and url not in known.dead]
    print(f"{len(urls)} billedlinks, {len(urls) - len(todo)} allerede besvaret, {len(todo)} at tjekke", flush=True)
    local = threading.local()

    def ask(url: str) -> str:
        if not hasattr(local, "session"):
            local.session = requests.Session()
        answer = "000\t"  # no answer: asked again next time
        for attempt in range(3):
            try:
                response = local.session.head(url, timeout=30, allow_redirects=False)
                answer = f"{response.status_code}\t{response.headers.get('content-type', '')}"
                if response.status_code < 500 and response.status_code != 429:
                    break
            except requests.RequestException:
                pass
            time.sleep(2**attempt)
        return f"{url}\t{answer}"

    counts = collections.Counter()
    with out.open("a") as f, ThreadPoolExecutor(max_workers=args.workers) as pool:
        for done, line in enumerate(pool.map(ask, todo), 1):
            f.write(line + "\n")
            counts[line.split("\t")[1][:1]] += 1
            if done % 2000 == 0 or done == len(todo):
                f.flush()
                print(f"{done}/{len(todo)} · findes {counts['2']}, findes ikke {counts['4']}, uden svar {counts['0'] + counts['5']}", flush=True)
    status = rules.ImageStatus.parse(out.read_text().splitlines())
    unanswered = sum(url not in status.found and url not in status.dead for url in urls)
    print(f"Billeder, der findes: {len(status.found & set(urls))}. Uden svar: {unanswered} (kør igen for at spørge om dem).")
    print(f"Brug svarene med: --image-status {out}")
    return 0


DOUBLE_PHOTOS_ABOUT = (
    "Guirca articles whose main photo (<nr>.jpg) shows the product twice: the same photo again, "
    "or a collage with the article's other photos. The import and the storefront leave that "
    "photo out when the product has other photos. codes is written by: python3 "
    "scripts/guirca/import_guirca.py doubles <sheet> --image-status images.tsv; by_eye are the "
    "ones found by looking at the photos the command missed, and are kept when it runs again."
)


def code_order(code: str) -> tuple[int, str]:
    """Guirca numbers in numeric order (they are digits of different lengths)."""
    return len(code), code


def find_double_photos(args) -> int:
    """Check every Guirca main photo that is not its article's only photo for showing the
    product twice (photos.is_collage), and write the articles where it does to --out
    (src/config/guirca-double-photos.json), which the import and the storefront read.

    A costume's main photo is left out by rule when its catalogue photo (_01) is there, so it is
    not checked. An article whose photos can't be fetched keeps its earlier answer.
    """
    import photos  # needs opencv-python-headless and numpy

    images = rules.ImageStatus.parse(Path(args.image_status).read_text().splitlines()) if args.image_status else rules.ImageStatus()
    todo: dict[str, list[str]] = {}
    for row in catalog.read_sheet(Path(args.sheet)):
        urls = rules.all_image_urls(row, images)
        main = rules.GUIRCA_PHOTO.match(urls[0]) if len(urls) > 1 else None
        if main and main[2] is None and f"{rules.IMAGE_HOST}/{main[1]}/{main[1]}_01.jpg" not in urls:
            todo[main[1]] = urls[:3]  # the main photo and the two photos after it
    print(f"{len(todo)} hovedfotos at tjekke", flush=True)
    local = threading.local()

    def check(item: tuple[str, list[str]]) -> tuple[str, bool | None]:
        code, urls = item
        if not hasattr(local, "session"):
            local.session = requests.Session()
        for attempt in range(3):
            try:
                data = []
                for url in urls:
                    response = local.session.get(url, timeout=60)
                    response.raise_for_status()
                    data.append(response.content)
                return code, photos.is_collage(data[0], data[1:])
            except (requests.RequestException, ValueError):
                time.sleep(2**attempt)
        return code, None

    doubles: set[str] = set()
    failed: set[str] = set()
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for done, (code, double) in enumerate(pool.map(check, todo.items()), 1):
            if double is None:
                failed.add(code)
            elif double:
                doubles.add(code)
            if done % 500 == 0 or done == len(todo):
                print(f"{done}/{len(todo)} · viser varen to gange: {len(doubles)} · uden svar: {len(failed)}", flush=True)
    out = Path(args.out)
    earlier = json.loads(out.read_text()) if out.exists() else {}
    doubles |= set(earlier.get("codes", [])) & failed
    by_eye = set(earlier.get("by_eye", [])) - doubles
    codes = sorted(doubles, key=code_order)
    out.write_text(json.dumps({"about": DOUBLE_PHOTOS_ABOUT, "codes": codes, "by_eye": sorted(by_eye, key=code_order)}, indent=1) + "\n")
    print(f"{len(codes)} hovedfotos viser varen to gange, og {len(by_eye)} mere fundet ved at se på dem: {args.out}" + (f" ({len(failed)} uden svar beholdt deres tidligere svar)" if failed else ""))
    return 0


# ---------------------------------------------------------------- report


def report(args) -> int:
    specs, skipped = load_specs(args)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    kinds = collections.Counter(s.kind for s in specs)
    print(f"Produkter: {len(specs)} ({kinds['variable']} med størrelser, {kinds['simple']} uden)")
    print(f"Varianter (størrelser): {sum(len(s.variations) for s in specs)}")
    print(f"Sprunget over: {len(skipped)}")
    for reason, count in collections.Counter(s.reason for s in skipped).most_common():
        print(f"  {count:5}  {reason}")
    print(f"Kladder (skal tjekkes): {sum(s.status == 'draft' for s in specs)}")
    print(f"Kun 18+ (kun i {', '.join(ADULT_WEBSHOPS)}, status {rules.ADULT_STATUS}): {sum(s.adult_only for s in specs)}")
    print(f"Uden billeder: {sum(not s.images for s in specs)}")
    print(f"Billeder: {sum(len(s.images) for s in specs)} ({sum(len(s.images) == 1 for s in specs)} produkter har kun ét)")
    print("Kategorier:")
    counts = collections.Counter(c for s in specs for c in s.categories)
    for path in rules.CATEGORY_ORDER:
        if counts[path]:
            print(f"  {counts[path]:5}  {' › '.join(path)}")

    preview = out / "guirca-preview.csv"
    with preview.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f, delimiter=";")
        writer.writerow(["Varenr.", "Type", "Navn", "Størrelser", "Pris (kr.)", "Kategorier", "Tags", "Status", "Problemer", "Noter", "Billeder", "Guirca-nr."])
        for s in specs:
            prices = sorted({v.price for v in s.variations if v.price}) if s.variations else ([s.price] if s.price else [])
            writer.writerow([
                s.sku,
                "Variabel" if s.kind == "variable" else "Simpel",
                s.name,
                ", ".join(s.sizes),
                "–".join(str(p) for p in (prices[:1] + prices[-1:] if len(prices) > 1 else prices)),
                " | ".join(" › ".join(c) for c in s.categories),
                ", ".join(s.tags),
                s.status,
                " · ".join(s.issues),
                " · ".join(s.notes),
                len(s.images),
                ",".join(s.codes),
            ])
    with (out / "guirca-skipped.csv").open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f, delimiter=";")
        writer.writerow(["Guirca-nr.", "Beskrivelse", "Grund"])
        for s in skipped:
            writer.writerow([s.code, s.description, s.reason])
    print(f"Oversigt: {preview}")
    return 0


# ---------------------------------------------------------------- WooCommerce setup


@dataclass
class Ids:
    brand: int
    attributes: dict[str, int]
    categories: dict[tuple[str, ...], int]
    tags: dict[str, int] = field(default_factory=dict)


def text(value: str) -> str:
    return html.unescape(value or "")


def ensure_attribute(woo: Woo, existing: list[dict], name: str, slug: str) -> int:
    for attribute in existing:
        if text(attribute["name"]).lower() == name.lower() or attribute["slug"] == f"pa_{slug}":
            return attribute["id"]
    created = woo.post("wc/v3/products/attributes", {"name": name, "slug": slug, "type": "select", "order_by": "menu_order", "has_archives": False}, safe_to_repeat=False)
    print(f"  oprettede egenskaben {name}")
    return created["id"]


def ensure_terms(woo: Woo, attribute_id: int, names: list[str]) -> None:
    """Create missing terms and keep them in the given order."""
    existing = {text(t["name"]): t for t in woo.get_all(f"wc/v3/products/attributes/{attribute_id}/terms", _fields="id,name,menu_order")}
    ordered = list(dict.fromkeys(names))
    create = [{"name": n, "menu_order": i} for i, n in enumerate(ordered) if n not in existing]
    update = [{"id": existing[n]["id"], "menu_order": i} for i, n in enumerate(ordered) if n in existing and existing[n].get("menu_order") != i]
    for start in range(0, max(len(create), len(update)), 100):
        body = {"create": create[start:start + 100], "update": update[start:start + 100]}
        result = woo.post(f"wc/v3/products/attributes/{attribute_id}/terms/batch", body, safe_to_repeat=True)
        errors = [r["error"]["message"] for r in result.get("create", []) + result.get("update", []) if r.get("error")]
        if errors:
            print(f"  advarsel: {len(errors)} egenskabsværdier kunne ikke gemmes: {errors[:3]}")
    if create:
        print(f"  oprettede {len(create)} værdier for egenskab {attribute_id}")


def ensure_categories(woo: Woo, paths: list[tuple[str, ...]]) -> dict[tuple[str, ...], int]:
    existing = woo.get_all("wc/v3/products/categories", _fields="id,name,parent,menu_order")
    by_parent = {(c["parent"], text(c["name"])): c for c in existing}
    ids: dict[tuple[str, ...], int] = {}
    order = list(dict.fromkeys([*rules.CATEGORY_ORDER, *paths]))
    for index, path in enumerate(order):
        for depth in range(1, len(path) + 1):
            sub = path[:depth]
            if sub in ids:
                continue
            parent = ids[sub[:-1]] if depth > 1 else 0
            found = by_parent.get((parent, sub[-1]))
            menu_order = index if sub == path else order.index(sub) if sub in order else index
            if found is None:
                slug = rules.slugify(sub[-1])
                try:
                    found = woo.post("wc/v3/products/categories", {"name": sub[-1], "parent": parent, "slug": slug, "menu_order": menu_order})
                except WooError as error:
                    if "term_exists" not in str(error):
                        raise
                    found = woo.post("wc/v3/products/categories", {"name": sub[-1], "parent": parent, "menu_order": menu_order})
                print(f"  oprettede kategorien {' › '.join(sub)}")
            elif found.get("menu_order") != menu_order:
                woo.put(f"wc/v3/products/categories/{found['id']}", {"menu_order": menu_order})
            ids[sub] = found["id"]
    return ids


def ensure_tags(woo: Woo, names: list[str]) -> dict[str, int]:
    existing = {text(t["name"]): t["id"] for t in woo.get_all("wc/v3/products/tags", _fields="id,name")}
    missing = [n for n in dict.fromkeys(names) if n not in existing]
    for start in range(0, len(missing), 100):
        chunk = missing[start:start + 100]
        result = woo.post("wc/v3/products/tags/batch", {"create": [{"name": n} for n in chunk]}, safe_to_repeat=True)
        for name, item in zip(chunk, result.get("create", [])):
            if item.get("id"):
                existing[name] = item["id"]
            elif (item.get("error") or {}).get("data", {}).get("resource_id"):
                existing[name] = item["error"]["data"]["resource_id"]
    if missing:
        print(f"  oprettede {len(missing)} tags")
    return existing


def ensure_brand(woo: Woo) -> int:
    for brand in woo.get("wc/v3/products/brands", search=BRAND, per_page=100):
        if text(brand["name"]) == BRAND:
            return brand["id"]
    return woo.post("wc/v3/products/brands", {"name": BRAND, "description": "Fiestas Guirca, S.L. (Spanien)"})["id"]


def webshop_list(args) -> list[str]:
    """The webshops new products get: --webshop (comma-separated), sorted; none with --no-webshop."""
    return [] if args.no_webshop else sorted({s.strip() for s in args.webshop.split(",") if s.strip()})


def setup(woo: Woo, specs: list[catalog.ProductSpec], webshops: list[str]) -> Ids:
    print("Forbereder WooCommerce (mærke, egenskaber, kategorier, tags) …")
    if webshops:
        known = {s["slug"] for s in woo.get("wc-headless/v1/shops")}
        for webshop in webshops:
            if webshop not in known:
                raise SystemExit(f"Webshoppen '{webshop}' findes ikke i WooCommerce (Produkter → Webshops).")
    existing = woo.get("wc/v3/products/attributes")
    attributes = {
        SIZE: ensure_attribute(woo, existing, SIZE, "storrelse"),
        GROUP: ensure_attribute(woo, existing, GROUP, "maalgruppe"),
        COLOUR: ensure_attribute(woo, existing, COLOUR, "farve"),
    }
    current_sizes = [text(t["name"]) for t in woo.get_all(f"wc/v3/products/attributes/{attributes[SIZE]}/terms", _fields="name")]
    sizes = sorted({*current_sizes, *(size for s in specs for size in s.sizes)}, key=rules.size_sort_key)
    ensure_terms(woo, attributes[SIZE], sizes)
    ensure_terms(woo, attributes[GROUP], list(rules.GROUP_NAMES.values()))
    colours = sorted({c for s in specs for c in s.colours})
    ensure_terms(woo, attributes[COLOUR], colours)
    categories = ensure_categories(woo, sorted({c for s in specs for c in s.categories}))
    tags = ensure_tags(woo, sorted({t for s in specs for t in s.tags}))
    return Ids(brand=ensure_brand(woo), attributes=attributes, categories=categories, tags=tags)


# ---------------------------------------------------------------- payloads


def shops_for(spec: catalog.ProductSpec, webshops: list[str]) -> list[str]:
    """The webshops a product is sold in: 18+ products only in ADULT_WEBSHOPS."""
    return [w for w in webshops if w in ADULT_WEBSHOPS] if spec.adult_only else list(webshops)


def fingerprint(spec: catalog.ProductSpec, webshops: list[str]) -> str:
    return f"{IMPORTER_VERSION}:{','.join(webshops) or '-'}:{spec.fingerprint()}"


def attributes_payload(spec: catalog.ProductSpec, ids: Ids) -> list[dict]:
    attributes = []
    if spec.kind == "variable":
        attributes.append({"id": ids.attributes[SIZE], "visible": True, "variation": True, "options": spec.sizes, "position": 0})
    if spec.groups:
        attributes.append({"id": ids.attributes[GROUP], "visible": True, "variation": False, "options": spec.groups, "position": 1})
    if spec.colours:
        attributes.append({"id": ids.attributes[COLOUR], "visible": True, "variation": False, "options": spec.colours, "position": 2})
    return attributes


def product_payload(spec: catalog.ProductSpec, ids: Ids, fields: set[str], webshops: list[str], creating: bool) -> dict:
    meta = dict(spec.meta)
    meta["_wchc_import_hash"] = fingerprint(spec, webshops)
    meta["_wchc_import_issue"] = " · ".join(spec.issues)
    meta["_wchc_import_note"] = " · ".join(spec.notes)
    payload = {
        "sku": spec.sku,
        "brands": [{"id": ids.brand}],
        "attributes": attributes_payload(spec, ids),
        "weight": spec.weight,
        "dimensions": spec.dimensions or {"length": "", "width": "", "height": ""},
        "meta_data": [{"key": k, "value": v} for k, v in meta.items()],
    }
    if creating:
        payload["type"] = spec.kind
        # First in its tier until the next `order` run places it (menu_order is "Anbefalet").
        payload["menu_order"] = rules.merchandising_tier([rules.slug_path(c) for c in spec.categories]) * rules.TIER_STEP
        if spec.intro_year:
            payload["date_created"] = f"{min(spec.intro_year, dt.date.today().year)}-01-01T00:00:00"
    if spec.kind == "simple":
        payload["regular_price"] = str(spec.price) if spec.price else ""
        payload["global_unique_id"] = spec.ean
    if "texts" in fields:
        payload.update(name=spec.name, short_description=spec.short_description, description=spec.description)
    if "categories" in fields:
        payload["categories"] = [{"id": ids.categories[c]} for c in spec.categories]
    if "tags" in fields:
        payload["tags"] = [{"id": ids.tags[t]} for t in spec.tags if t in ids.tags]
    if "status" in fields:
        payload["status"] = spec.status
    if "webshops" in fields:
        payload["webshops"] = shops_for(spec, webshops)
    if "stock" in fields:
        payload.update(manage_stock=False, stock_status="instock")
    return payload


def variation_payload(variation: catalog.VariationSpec, index: int, ids: Ids, fields: set[str]) -> dict:
    payload = {
        "sku": variation.sku,
        "regular_price": str(variation.price) if variation.price else "",
        "global_unique_id": variation.ean,
        "weight": variation.weight,
        "status": "publish" if variation.price else "private",
        "menu_order": index,
        "attributes": [{"id": ids.attributes[SIZE], "option": variation.size}],
        "meta_data": [{"key": "_supplier_article_code", "value": variation.code}],
    }
    if "stock" in fields:
        payload.update(manage_stock=False, stock_status="instock")
    return payload


# ---------------------------------------------------------------- import


@dataclass
class Existing:
    id: int
    sku: str
    type: str
    hash: str
    variations: int = 0


def index_products(woo: Woo, workers: int) -> tuple[dict[str, Existing], dict[str, Existing]]:
    """Guirca products already in WooCommerce, by article number and by SKU."""
    print("Læser eksisterende produkter i WooCommerce …")
    params = {"status": "any", "_fields": "id,sku,type,meta_data,variations", "per_page": 100}
    first, headers = woo.request("GET", "wc/v3/products", params={**params, "page": 1})
    pages = int(headers.get("X-WP-TotalPages") or 1)
    products = list(first)
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        for data in pool.map(lambda p: woo.get("wc/v3/products", **params, page=p), range(2, pages + 1)):
            products += data
    by_code, by_sku = {}, {}
    for product in products:
        meta = {m["key"]: m["value"] for m in product.get("meta_data", [])}
        existing = Existing(
            product["id"], product.get("sku", ""), product["type"], str(meta.get("_wchc_import_hash", "")), len(product.get("variations") or [])
        )
        if existing.sku:
            by_sku[existing.sku] = existing
        if meta.get("_supplier") == "Guirca":
            for code in str(meta.get("_supplier_article_codes", "")).split(","):
                if code.strip():
                    by_code[code.strip()] = existing
    print(f"  {len(products)} produkter, heraf {len(set(e.id for e in by_code.values()))} fra Guirca")
    return by_code, by_sku


class Importer:
    def __init__(self, woo: Woo, ids: Ids | None, args):
        self.woo, self.ids, self.args = woo, ids, args
        self.webshops = webshop_list(args)
        self.overwrite = set(SHOP_OWNED) if args.overwrite == "all" else {f for f in (args.overwrite or "").split(",") if f}
        self.lock = threading.Lock()
        self.counts = collections.Counter()
        self.log = open(args.log, "a", encoding="utf-8") if args.log else None
        self.started = time.time()

    def record(self, action: str, spec: catalog.ProductSpec, product_id: int | None = None, error: str | None = None, **extra):
        with self.lock:
            self.counts[action] += 1
            if self.log:
                entry = {"time": dt.datetime.now().isoformat(timespec="seconds"), "action": action, "sku": spec.sku, "name": spec.name, "id": product_id, "error": error, **extra}
                self.log.write(json.dumps(entry, ensure_ascii=False) + "\n")
                self.log.flush()
            if error:
                print(f"  FEJL {spec.sku} {spec.name}: {error}")

    def lookup_skus(self, skus: list[str]) -> dict[str, dict]:
        found = {}
        for start in range(0, len(skus), 50):
            chunk = skus[start:start + 50]
            for item in self.woo.get("wc/v3/products", sku=",".join(chunk), status="any", per_page=100, _fields="id,sku,type,parent_id"):
                found[item["sku"]] = item
        return found

    def create_chunk(self, chunk: list[catalog.ProductSpec]) -> None:
        fields = set(SHOP_OWNED)
        body = {"create": [product_payload(s, self.ids, fields, self.webshops, creating=True) for s in chunk]}
        try:
            results = self.woo.post("wc/v3/products/batch", body).get("create", [])
        except WooError as error:
            print(f"  batch-fejl ({error}); tjekker hvad der blev gemt …")
            results = []
        if not results:
            # The connection broke, but WooCommerce may still be saving the batch: give it time
            # before looking up what was saved (WooCommerce refuses duplicate SKUs on a retry).
            time.sleep(self.args.settle)
        unresolved = []
        for spec, result in zip(chunk, results + [None] * (len(chunk) - len(results))):
            if result and result.get("id") and not result.get("error"):
                self.after_save(spec, result["id"], created=True, fresh=True)
            elif result and result.get("error") and result["error"].get("code") not in ("product_invalid_sku", "woocommerce_rest_product_not_created"):
                self.record("error", spec, error=f"{result['error'].get('code')}: {result['error'].get('message')}")
            else:
                unresolved.append((spec, result))
        if unresolved:
            found = self.lookup_skus([s.sku for s, _ in unresolved])
            for spec, result in unresolved:
                if spec.sku in found:
                    self.after_save(spec, found[spec.sku]["id"], created=True)
                else:
                    message = (result or {}).get("error", {}).get("message", "ikke gemt")
                    self.record("error", spec, error=message)

    def update_chunk(self, chunk: list[tuple[catalog.ProductSpec, Existing]]) -> None:
        body = {"update": [{"id": e.id, **product_payload(s, self.ids, self.overwrite, self.webshops, creating=False)} for s, e in chunk]}
        try:
            results = self.woo.post("wc/v3/products/batch", body, safe_to_repeat=True).get("update", [])
        except WooError as error:
            for spec, existing in chunk:
                self.record("error", spec, existing.id, error=str(error))
            return
        for (spec, existing), result in zip(chunk, results):
            if result.get("error"):
                self.record("error", spec, existing.id, error=f"{result['error'].get('code')}: {result['error'].get('message')}")
            else:
                self.after_save(spec, existing.id, created=False)

    def after_save(self, spec: catalog.ProductSpec, product_id: int, created: bool, fresh: bool = False) -> None:
        if spec.kind == "variable":
            error = self.sync_variations(spec, product_id, created, fresh)
            if error:
                self.record("error", spec, product_id, error=error)
                return
        self.record("created" if created else "updated", spec, product_id)

    def sync_variations(self, spec: catalog.ProductSpec, product_id: int, created: bool, fresh: bool) -> str | None:
        """Create and update the product's sizes. `fresh`: just created, so it has none yet."""
        fields = set(SHOP_OWNED) if created else self.overwrite
        for attempt in range(2):
            if fresh and attempt == 0:
                existing = {}
            else:
                existing = {v["sku"]: v["id"] for v in self.woo.get_all(f"wc/v3/products/{product_id}/variations", _fields="id,sku")}
            create, update = [], []
            for index, variation in enumerate(spec.variations):
                if variation.sku in existing:
                    update.append({"id": existing[variation.sku], **variation_payload(variation, index, self.ids, fields)})
                else:
                    create.append(variation_payload(variation, index, self.ids, fields | {"stock"}))
            try:
                result = self.woo.post(f"wc/v3/products/{product_id}/variations/batch", {"create": create, "update": update}, safe_to_repeat=not create)
            except WooError as error:
                if attempt == 0:
                    continue  # look again at what was saved, then retry the rest
                return f"størrelser: {error}"
            errors = [r["error"].get("message", "") for r in result.get("create", []) + result.get("update", []) if r.get("error")]
            return f"størrelser: {'; '.join(errors)}" if errors else None
        return None

    def run(self, specs: list[catalog.ProductSpec], by_code: dict[str, Existing], by_sku: dict[str, Existing]) -> int:
        creates, updates, unchanged, conflicts = [], [], 0, []
        for spec in specs:
            matches = {by_code[c].id: by_code[c] for c in spec.codes if c in by_code}
            if spec.sku in by_sku:
                matches[by_sku[spec.sku].id] = by_sku[spec.sku]
            if not matches:
                creates.append(spec)
                continue
            existing = max(matches.values(), key=lambda e: sum(by_code.get(c) is e for c in spec.codes))
            if len(matches) > 1:
                conflicts.append(f"{spec.sku}: flere produkter matcher ({', '.join(str(i) for i in matches)}), opdaterer {existing.id}")
            if existing.type != spec.kind:
                conflicts.append(f"{spec.sku}: produkt {existing.id} er {existing.type}, arket siger {spec.kind} – springes over")
                continue
            # A product whose sizes were never all saved (e.g. an interrupted run) is not "unchanged".
            complete = spec.kind != "variable" or existing.variations >= len(spec.variations)
            if existing.hash == fingerprint(spec, self.webshops) and complete and not self.args.force:
                unchanged += 1
            else:
                updates.append((spec, existing))
        print(f"Plan: opret {len(creates)}, opdatér {len(updates)}, uændrede {unchanged}")
        for conflict in conflicts:
            print(f"  OBS {conflict}")
        if self.args.dry_run:
            return 0

        size = self.args.batch
        jobs = [(self.create_chunk, creates[i:i + size]) for i in range(0, len(creates), size)]
        jobs += [(self.update_chunk, updates[i:i + size]) for i in range(0, len(updates), size)]
        with ThreadPoolExecutor(max_workers=self.args.workers) as pool:
            futures = [pool.submit(fn, chunk) for fn, chunk in jobs]
            for done, future in enumerate(as_completed(futures), 1):
                future.result()
                elapsed = time.time() - self.started
                c = self.counts
                print(f"[{done}/{len(jobs)}] oprettet {c['created']}, opdateret {c['updated']}, fejl {c['error']} · {elapsed / 60:.1f} min", flush=True)
        print(f"Færdig: oprettet {self.counts['created']}, opdateret {self.counts['updated']}, uændrede {unchanged}, fejl {self.counts['error']}")
        return 1 if self.counts["error"] else 0


def run_import(args) -> int:
    specs, skipped = load_specs(args)
    specs = select(specs, args)
    print(f"{len(specs)} produkter valgt ({len(skipped)} rækker i arket sprunget over)")
    woo = Woo.from_env()
    # A dry run only reads: it plans against the products already in WooCommerce.
    ids = None if args.dry_run else setup(woo, specs, webshop_list(args))
    by_code, by_sku = index_products(woo, args.workers)
    return Importer(woo, ids, args).run(specs, by_code, by_sku)


# ---------------------------------------------------------------- order and names

MAX_BATCH = 50


def read_products(woo: Woo, status: str, fields: str) -> list[dict]:
    """Every product, 100 per request and one request at a time (reads are retried)."""
    print("Læser produkterne i WooCommerce …", flush=True)
    products = woo.get_all("wc/v3/products", status=status, _fields=fields)
    print(f"  {len(products)} produkter")
    return products


def saved_field(field: str):
    """Whether the product WooCommerce answered with has the value an update ({id, field}) set."""
    return lambda update, result: text(str(result.get(field))) == text(str(update[field]))


def write_products(woo: Woo, updates: list[dict], saved, args) -> int:
    """Save updates ({id, fields …}) in batches of at most 50, one batch at a time with a pause.
    `saved(update, result)` tells whether WooCommerce's answer has what the update set.

    The updates only set values, so a batch that fails is sent again after --settle seconds
    (WooCommerce may still be saving it). Returns how many products were not saved.
    """
    size = max(1, min(args.batch, MAX_BATCH))
    batches = [updates[start:start + size] for start in range(0, len(updates), size)]
    done = failed = 0
    for number, chunk in enumerate(batches, 1):
        results = []
        for attempt in range(3):
            try:
                results = woo.post("wc/v3/products/batch", {"update": chunk}, safe_to_repeat=True).get("update", [])
                break
            except WooError as error:
                if attempt == 2:
                    print(f"  batch-fejl ({error}); springer portionen over", flush=True)
                else:
                    print(f"  batch-fejl ({error}); prøver igen om {args.settle} s …", flush=True)
                    time.sleep(args.settle)
        by_id = {r.get("id"): r for r in results if not r.get("error")}
        for update in chunk:
            result = by_id.get(update["id"])
            if result is not None and saved(update, result):
                done += 1
            else:
                failed += 1
                error = next((r["error"].get("message") for r in results if r.get("error") and r.get("id") == update["id"]), "ikke gemt")
                print(f"  FEJL produkt {update['id']}: {error}")
        print(f"[{number}/{len(batches)}] gemt {done}, fejl {failed}", flush=True)
        if number < len(batches):
            time.sleep(args.pause)
    return failed


def finish(woo: Woo, updates: list[dict], saved, args) -> int:
    if not args.apply:
        print("Prøvekørsel: intet er gemt. Kør igen med --apply for at gemme.")
        return 0
    failed = write_products(woo, updates, saved, args)
    print(f"Færdig: gemt {len(updates) - failed}, fejl {failed}")
    return 1 if failed else 0


def run_order(args) -> int:
    """Set every product's menu_order, which the shop's "Anbefalet" sort follows: costumes
    first, then masks, wigs, hats and make-up, other accessories, decorations and the rest
    (rules.MERCHANDISING_TIERS), newest first within each."""
    woo = Woo.from_env()
    paths = rules.category_slug_paths(woo.get_all("wc/v3/products/categories", _fields="id,slug,parent"))
    products = read_products(woo, "any", "id,name,status,date_created,menu_order,categories")
    tiers = {p["id"]: rules.merchandising_tier(paths.get(c["id"], (c.get("slug", ""),)) for c in p.get("categories") or []) for p in products}
    orders = rules.menu_orders((p["id"], p.get("date_created"), tiers[p["id"]]) for p in products)
    print("Rækkefølge ved Anbefalet:")
    for tier, label in rules.TIER_NAMES.items():
        members = sorted((p for p in products if tiers[p["id"]] == tier), key=lambda p: orders[p["id"]])
        published = sum(p.get("status") == "publish" for p in members)
        first = ", ".join(text(p["name"]) for p in members[:3])
        print(f"  {tier}  {label}: {len(members)} ({published} udgivne){' · først: ' + first if first else ''}")
    updates = [{"id": p["id"], "menu_order": orders[p["id"]]} for p in products if p.get("menu_order") != orders[p["id"]]]
    print(f"menu_order ændres på {len(updates)} af {len(products)} produkter (kun menu_order)")
    return finish(woo, updates, saved_field("menu_order"), args)


def product_name_facts(product: dict) -> rules.NameFacts:
    """NameFacts from what WooCommerce shows: description, Målgruppe, Farve and the Guirca number in the SKU."""
    options = {text(a.get("name", "")): a.get("options") or [] for a in product.get("attributes") or []}
    sku = product.get("sku") or ""
    code = catalog.sku_code(sku) or sku or str(product["id"])
    description = f"{product.get('description', '')} {product.get('short_description', '')}"
    return rules.name_facts(text=description, groups=options.get(GROUP, []), colours=options.get(COLOUR, []), code=code)


def run_names(args) -> int:
    """Give published products that share their name the first fact that tells them apart
    (rules.unique_names). Only the name changes: slugs, and with them the URLs, are kept."""
    woo = Woo.from_env()
    products = read_products(woo, "publish", "id,name,sku,description,short_description,attributes")
    current = {p["id"]: text(p["name"]) for p in products}
    facts = {p["id"]: product_name_facts(p) for p in products}
    renamed = rules.unique_names({i: (current[i], facts[i]) for i in current})
    groups = collections.defaultdict(list)
    for product_id in current:
        groups[rules.name_key(current[product_id])].append(product_id)
    shared = [ids for ids in groups.values() if len(ids) > 1]
    print(f"Navne, som flere udgivne produkter har: {len(shared)} (i alt {sum(len(ids) for ids in shared)} produkter)")
    kinds = collections.Counter()
    for product_id, name in renamed.items():
        suffix = name[len(current[product_id].strip()) + 2:]
        kinds[next((k for k, v in vars(facts[product_id]).items() if v == suffix), "?")] += 1
    labels = {"size": "mål", "audience": "målgruppe", "pack": "antal", "colour": "farve", "model": "Guirca-model"}
    print(f"Omdøbes: {len(renamed)} (kun navnet; adresserne ændres ikke) · " + ", ".join(f"{labels.get(k, k)} {n}" for k, n in kinds.most_common()))
    # Examples: whole groups, spread over the alphabet.
    examples = sorted((ids for ids in shared if any(i in renamed for i in ids)), key=lambda ids: rules.name_key(current[ids[0]]))
    needed = -(-args.examples * len(examples) // max(1, sum(map(len, examples))))  # groups, rounded up
    shown = 0
    for ids in examples[:: max(1, len(examples) // max(1, needed))]:
        for product_id in sorted(ids):
            if shown < args.examples and product_id in renamed:
                print(f"  {product_id}: {current[product_id]}  →  {renamed[product_id]}")
                shown += 1
    if args.out:
        with Path(args.out).open("w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f, delimiter=";")
            writer.writerow(["ID", "Varenr.", "Navn nu", "Nyt navn"])
            skus = {p["id"]: p.get("sku", "") for p in products}
            for product_id in sorted(renamed, key=lambda i: (rules.name_key(current[i]), i)):
                writer.writerow([product_id, skus[product_id], current[product_id], renamed[product_id]])
        print(f"Alle omdøbninger: {args.out}")
    return finish(woo, [{"id": i, "name": n} for i, n in sorted(renamed.items())], saved_field("name"), args)


def run_adult(args) -> int:
    """Keep products for adults only as drafts (the owner's decision, 16-10-2026): the 18+
    category and the crude jokes Guirca files elsewhere (see catalog.adult_changes)."""
    woo = Woo.from_env()
    slug = rules.slugify(rules.ADULT_ONLY[-1])
    adult_category = next((c for c in woo.get_all("wc/v3/products/categories", _fields="id,name,slug,parent") if c["slug"] == slug), None)
    if adult_category is None:
        raise SystemExit(f"Kategorien {rules.ADULT_ONLY[-1]} ({slug}) findes ikke i WooCommerce.")
    products = read_products(woo, "any", "id,name,sku,status,categories,description,webshops")
    changes = catalog.adult_changes(products, adult_category, ADULT_WEBSHOPS)
    crude = [c for c in changes if "categories" in c.update]
    print(f"Varer kun for voksne: {len(changes)} ({len(changes) - len(crude)} i {rules.ADULT_ONLY[-1]}, {len(crude)} grove varer uden for den)")
    print(f"Status nu: {', '.join(f'{s} {n}' for s, n in collections.Counter(c.product.get('status') for c in changes).most_common())}")
    print(f"Bliver kladde: {sum('status' in c.update for c in changes)} · får kun kategorien {rules.ADULT_ONLY[-1]}: {len(crude)} · får kun webshoppen {', '.join(ADULT_WEBSHOPS)}: {sum('webshops' in c.update for c in changes)}")
    for title, group in (("I 18+-kategorien", [c for c in changes if c not in crude]), ("Grove varer, der får 18+-kategorien", crude)):
        print(f"\n{title} ({len(group)}):")
        print("  id\tstatus\tnavn\tkategorier nu\twebshops nu\thvorfor\tændring")
        for change in sorted(group, key=lambda c: c.product["id"]):
            p, update = change.product, change.update
            categories = ", ".join(text(c.get("name", "")) for c in p.get("categories") or [])
            planned = ", ".join(f"{k} → {'18+' if k == 'categories' else ','.join(v) if isinstance(v, list) else v}" for k, v in update.items() if k != "id") or "ingen"
            print(f"  {p['id']}\t{p.get('status')}\t{text(p.get('name', ''))}\t{categories}\t{','.join(p.get('webshops') or []) or '-'}\t{change.reason}\t{planned}")
    updates = [c.update for c in changes if len(c.update) > 1]
    print(f"\nÆndres: {len(updates)} af {len(products)} produkter (kun status, kategorier og webshops)")
    return finish(woo, updates, catalog.adult_saved, args)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Importér Guircas produktark i WooCommerce.")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("images", help="Tjek, hvilke af Guircas fotos der findes")
    p.add_argument("sheet", help="Guircas Excel-ark (PRODUCTS_INFORMATIONS.xlsx)")
    p.add_argument("--out", required=True, help="TSV med svarene (url, HTTP-status, indholdstype); fortsætter en tidligere kørsel")
    p.add_argument("--workers", type=int, default=16, help="Samtidige forespørgsler (standard 16)")
    p = sub.add_parser("doubles", help="Find hovedfotos, der viser det samme foto to gange (kræver opencv-python-headless)")
    p.add_argument("sheet", help="Guircas Excel-ark (PRODUCTS_INFORMATIONS.xlsx)")
    p.add_argument("--image-status", help="TSV fra et billedtjek (kommandoen images)")
    p.add_argument("--out", default=str(rules.DOUBLE_PHOTOS_FILE), help="JSON med Guirca-numrene (standard: src/config/guirca-double-photos.json)")
    p.add_argument("--workers", type=int, default=4, help="Samtidige fotos (standard 4)")
    for name in ("report", "import"):
        p = sub.add_parser(name)
        p.add_argument("sheet", help="Guircas Excel-ark (PRODUCTS_INFORMATIONS.xlsx)")
        p.add_argument("--image-status", help="TSV fra et billedtjek (kommandoen images): døde links udelades, og fotos på Guircas server, som arket ikke nævner, kommer med")
    sub.choices["report"].add_argument("--out", default=".", help="Mappe til oversigten (CSV)")
    p = sub.choices["import"]
    p.add_argument("--dry-run", action="store_true", help="Vis planen uden at skrive til WooCommerce")
    p.add_argument("--sample", type=int, help="Kun N produkter, fordelt over kategorierne")
    p.add_argument("--limit", type=int, help="Kun de første N produkter")
    p.add_argument("--codes", help="Kun produkter med disse Guirca-numre (kommasepareret)")
    p.add_argument("--webshop", default=DEFAULT_WEBSHOPS, help=f"Webshops, nye produkter tildeles, kommasepareret (standard: {DEFAULT_WEBSHOPS})")
    p.add_argument("--no-webshop", action="store_true", help="Tildel ingen webshop")
    p.add_argument("--overwrite", help=f"Sæt også disse felter på eksisterende produkter: {','.join(SHOP_OWNED)} eller 'all'")
    p.add_argument("--force", action="store_true", help="Opdatér også produkter, der ikke er ændret")
    p.add_argument("--workers", type=int, default=3, help="Samtidige forespørgsler (standard 3)")
    p.add_argument("--batch", type=int, default=20, help="Produkter pr. forespørgsel (standard 20)")
    p.add_argument("--log", help="JSONL-log over hvert produkt")
    p.add_argument("--settle", type=int, default=60, help="Sekunder at vente efter en afbrudt forespørgsel, før der tjekkes, hvad der blev gemt")
    sub.add_parser("order", help="Sæt rækkefølgen ved 'Anbefalet' (menu_order): kostumer først, nyeste først")
    sub.add_parser("names", help="Gør navne, som flere udgivne varer har, unikke (kun navnet, ikke adressen)")
    sub.add_parser("adult", help="Gør alle varer kun for voksne (18+ og grove varer) til kladder")
    for name in ("order", "names", "adult"):
        p = sub.choices[name]
        mode = p.add_mutually_exclusive_group()
        mode.add_argument("--dry-run", action="store_true", help="Vis kun, hvad der ville ændres (standard)")
        mode.add_argument("--apply", action="store_true", help="Gem ændringerne i WooCommerce")
        p.add_argument("--batch", type=int, default=MAX_BATCH, help=f"Produkter pr. forespørgsel (højst {MAX_BATCH})")
        p.add_argument("--pause", type=float, default=2, help="Sekunder mellem forespørgslerne (standard 2)")
        p.add_argument("--settle", type=int, default=60, help="Sekunder at vente efter en fejlet forespørgsel, før den sendes igen")
    sub.choices["names"].add_argument("--examples", type=int, default=20, help="Antal eksempler, der vises (standard 20)")
    sub.choices["names"].add_argument("--out", help="CSV med alle omdøbninger")
    args = parser.parse_args(argv)
    commands = {"images": check_images, "doubles": find_double_photos, "report": report, "import": run_import, "order": run_order, "names": run_names, "adult": run_adult}
    return commands[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
