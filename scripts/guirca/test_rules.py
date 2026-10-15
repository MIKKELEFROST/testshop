"""Unit tests for the Guirca import rules: python3 -m unittest discover -s scripts/guirca"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import catalog  # noqa: E402
import rules  # noqa: E402


class Sizes(unittest.TestCase):
    def test_danish_size_names(self):
        self.assertEqual(rules.size_name("7 –  9 YEARS"), "7-9 år")
        self.assertEqual(rules.size_name("3 - 6 Años"), "3-6 år")
        self.assertEqual(rules.size_name("12 - 18 MONTHS"), "12-18 mdr.")
        self.assertEqual(rules.size_name("42 - 44 (L)"), "L (42-44)")
        self.assertEqual(rules.size_name("37 - 41"), "37-41")
        self.assertEqual(rules.size_name("S - DOG"), "S")
        self.assertEqual(rules.size_name("S-M MAN SPANDEX"), "S-M")

    def test_sizes_sort_from_babies_to_adults(self):
        names = ["L (42-44)", "10-12 år", "37-41", "S (36-38)", "3-4 år", "12-18 mdr.", "XL (44-46)", "M (38-40)"]
        self.assertEqual(
            sorted(names, key=rules.size_sort_key),
            ["12-18 mdr.", "3-4 år", "10-12 år", "S (36-38)", "M (38-40)", "L (42-44)", "XL (44-46)", "37-41"],
        )

    def test_child_height(self):
        self.assertEqual(rules.child_height("7 – 9 YEARS (137 CM)"), "137 cm")
        self.assertEqual(rules.child_height("ONE SIZE"), "")


class Prices(unittest.TestCase):
    def test_nearest_price_ending_in_nine(self):
        self.assertEqual(rules.price_dkk(22.98), 169)  # 171.43 kr.
        self.assertEqual(rules.price_dkk(23.6), 179)  # 176.06 kr.
        self.assertEqual(rules.price_dkk(2.0), 19)  # 14.92 kr.
        self.assertEqual(rules.price_dkk(0.5), 9)  # never below 9 kr.

    def test_display_packs_are_priced_per_piece_on_the_christmas_sheet(self):
        price, note = rules.unit_price_eur(193.96, "PHOTOBOOTH, 80X60 CM (DISPLAY 12 PCS)", "GUIRMA")
        self.assertAlmostEqual(price, 16.163, places=2)
        self.assertIn("12 stk.", note)
        # The main sheet already prices one piece, and so do cheap Christmas displays.
        self.assertEqual(rules.unit_price_eur(17.96, "PHOTOBOOTH FRAME (DISPLAY 12 PCS)", "GUIRCA"), (17.96, None))
        self.assertEqual(rules.unit_price_eur(2.52, "LIL XMAS PEN (DISPLAY 36 PCS)", "GUIRMA"), (2.52, None))

    def test_broken_prices_are_reported(self):
        self.assertIsNone(rules.price_problem(22.98))
        self.assertIn("Mangler", rules.price_problem(None))
        self.assertIn("Urealistisk", rules.price_problem(1455985.44))


class Names(unittest.TestCase):
    def test_target_groups(self):
        self.assertEqual(rules.audience(rules.groups_for(["CHILD GIRL"])), "til piger")
        self.assertEqual(rules.audience(rules.groups_for(["CHILD UNISEX"])), "til børn")
        self.assertEqual(rules.audience(rules.groups_for(["ADULT MAN", "ADULT WOMAN"])), "til voksne")
        self.assertEqual(rules.audience(rules.groups_for(["BABY BOY", "TODDLER"])), "til baby")
        self.assertEqual(rules.audience(rules.groups_for(["DOG"])), "til hunde")
        self.assertEqual(rules.audience(rules.groups_for(["ADULT / CHILD"])), "")
        self.assertEqual(rules.audience(rules.groups_for(["ADULT MAN", "CHILD BOY"])), "til børn og voksne")

    def test_costume_names(self):
        self.assertEqual(rules.costume_name("Mørk enhjørning", {"piger"}), "Mørk enhjørning – kostume til piger")
        self.assertEqual(rules.costume_name("Skeletkostume", {"hund"}), "Skeletkostume til hunde")
        self.assertEqual(rules.costume_name("Pirat", set()), "Pirat – kostume")
        self.assertEqual(rules.family_name("Julesweater", {"piger", "drenge"}), "Julesweater til børn")

    def test_slugs(self):
        self.assertEqual(rules.slugify("Tøj og strømper"), "toej-og-stroemper")
        self.assertEqual(rules.slugify("Polterabend (18+)"), "polterabend-18")


class Categories(unittest.TestCase):
    def test_costumes_by_target_group(self):
        row = {"PARENT CATEGORY": "COSTUMES", "CATEGORY": "CHILDREN"}
        self.assertEqual(rules.main_categories(row, {"piger", "drenge"}, sized=True), [("Kostumer", "Pigekostumer"), ("Kostumer", "Drengekostumer")])
        self.assertEqual(rules.main_categories(row, set(), sized=True), [("Kostumer", "Pigekostumer"), ("Kostumer", "Drengekostumer")])

    def test_accessories_by_category_and_subcategory(self):
        self.assertEqual(rules.main_categories({"PARENT CATEGORY": "ACCESSORIES", "CATEGORY": "TEXTILE", "SUBCATEGORY": "TEXTILE, TOPS, BRAS AND CORSETS"}, set(), False), [("Tøj", "Bodyer, toppe og korsetter")])
        self.assertEqual(rules.main_categories({"PARENT CATEGORY": "ACCESSORIES", "CATEGORY": "WIGS AND HAIR ACCESSORIES", "SUBCATEGORY": "BEARDS AND MOUSTACHES"}, set(), False), [("Tilbehør", "Skæg og overskæg")])
        self.assertEqual(rules.main_categories({"PARENT CATEGORY": "ACCESSORIES", "CATEGORY": "CROWNS, JEWELS"}, set(), False), [("Tilbehør", "Hovedpynt")])
        self.assertEqual(rules.main_categories({"PARENT CATEGORY": "MAKE UP", "CATEGORY": ""}, set(), False), [("Make-up", "Sminke og ansigtsmaling")])

    def test_adult_items_only_go_to_the_adult_category(self):
        row = {"PARENT CATEGORY": "ACCESSORIES", "CATEGORY": "TEXTILE", "SUBCATEGORY": "EROTIC, TIES", "THEME": "Halloween"}
        self.assertEqual(rules.main_categories(row, set(), False), [rules.ADULT_ONLY])
        self.assertEqual(rules.season_categories(row), [])

    def test_seasons(self):
        self.assertEqual(rules.season_categories({"THEME": "Vampires, Cinema"}), [rules.HALLOWEEN])
        self.assertEqual(rules.season_categories({"SEASON": "X'MAS AND NEW YEAR"}), [rules.CHRISTMAS])
        self.assertEqual(rules.season_categories({"THEME": "Pirates"}), [])

    def test_colour_and_category_themes_are_not_tags(self):
        self.assertEqual(rules.tag_themes({"THEME": "Pirates, Black Colour, Halloween, White Collour"}), ["Pirates"])


class Texts(unittest.TestCase):
    def test_batteries(self):
        self.assertEqual(rules.battery_text("AA 3 No"), "Kræver 3 × AA-batterier (medfølger ikke).")
        self.assertEqual(rules.battery_text("AG13 3 Yes"), "Leveres med 3 × AG13-batterier.")
        self.assertEqual(rules.battery_text("AA - 3 0 No"), "Kræver 3 × AA-batterier (medfølger ikke).")
        self.assertEqual(rules.battery_text("3 X LR44 0 No"), "Kræver 3 × LR44-batterier (medfølger ikke).")
        self.assertEqual(rules.battery_text("CR 2032 1 No"), "Kræver 1 × CR2032-batteri (medfølger ikke).")
        self.assertEqual(rules.battery_text("USB CHARGE 0 No"), "Genoplades via USB.")
        self.assertEqual(rules.battery_text("NO 0 No"), "")

    def test_age_and_features(self):
        self.assertEqual(rules.age_text("+ 6 Years"), "Anbefalet alder: fra 6 år.")
        self.assertEqual(rules.age_text("8 – 11 Years"), "Anbefalet alder: 8-11 år.")
        self.assertEqual(rules.features_text({"WITH LIGHT": "SI", "WITH SOUND": "SI", "WITH MOVEMENT": "NO"}), "Med lys og lyd.")

    def test_costume_description(self):
        vocabulary = {"CONTENT": {"DRESS": "kjole", "HEADBAND": "hårbøjle", "WING/S": "vinger"}, "MATERIALS": {"POLYESTER": "polyester"}, "COLORS": {}, "FABRIC": {}}
        row = {"CONTENT": "WING/S, HEADBAND, DRESS, 2", "MATERIALS": "POLYESTER", "FIRE RETARDANT": "YES", "CE": "S"}
        short, text = rules.describe(row, vocabulary, costume=True, groups={"piger"}, sizes=["3-4 år (109 cm)", "5-6 år (123 cm)"], colours=["sort"])
        self.assertEqual(short, "<p>Kostume til piger med vinger, hårbøjle og kjole.</p>")
        self.assertIn("<p>Indhold: vinger, hårbøjle og kjole.</p>", text)
        self.assertIn("<p>Størrelser: 3-4 år (109 cm) og 5-6 år (123 cm).</p>", text)
        self.assertIn("<p>Materiale: polyester. Farve: sort.</p>", text)
        self.assertIn("<p>Brandhæmmende materiale og CE-mærket.</p>", text)
        self.assertIn("Fiestas Guirca, S.L.", text)

    def test_images_and_videos(self):
        row = {"LINK": "http://marketing.guirca.com/1/1.jpg", "Link_CostumeBack": "http://marketing.guirca.com/1/1_02.jpg", "Link_CostumeCat": "http://marketing.guirca.com/1/1.jpg"}
        self.assertEqual(rules.image_urls(row), ["https://marketing.guirca.com/1/1.jpg", "https://marketing.guirca.com/1/1_02.jpg"])
        self.assertEqual(rules.image_urls(row, {"https://marketing.guirca.com/1/1.jpg"}), ["https://marketing.guirca.com/1/1_02.jpg"])
        videos = rules.video_urls({"LINK VIDEOS": "https://www.youtube.com/embed/0Jq9orJ4P0o, https://youtu.be/0Jq9orJ4P0o"})
        self.assertEqual(videos, ["https://www.youtube.com/watch?v=0Jq9orJ4P0o"])


def row(code, **values):
    base = {"ARTICLE CODE": code, "sheet": "GUIRCA", "RRP AMAZON EU": "10", "EAN": f"84340770{code}", "USER": "CHILD GIRL", "PARENT CATEGORY": "COSTUMES", "CATEGORY": "CHILDREN", "LINK": f"http://marketing.guirca.com/{code}/{code}.jpg"}
    return {**base, **values}


class Catalog(unittest.TestCase):
    translations = catalog.Translations(
        families={"DARK UNICORN": "Mørk enhjørning"},
        names={"WITCH HAT": "Heksehat", "BLACK WIG": "Sort paryk"},
        vocabulary={"CONTENT": {}, "MATERIALS": {}, "COLORS": {}, "FABRIC": {}, "THEME": {}},
    )

    def test_sizes_with_one_connector_become_one_variable_product(self):
        rows = [
            row("78225", DESCRIPTION="DARK UNICORN, 5 – 6 YEARS", **{"PARENT DESCRIPTION": "DARK UNICORN", "SON DESCRIPTION": "5 – 6 YEARS (123 CM)", "SIZE": "5 - 6 YEARS", "CONNECTOR SIZE": "78224"}),
            row("78224", DESCRIPTION="DARK UNICORN, 3 – 4 YEARS", **{"PARENT DESCRIPTION": "DARK UNICORN", "SON DESCRIPTION": "3 – 4 YEARS (109 CM)", "SIZE": "3 - 4 YEARS", "CONNECTOR SIZE": "78224", "RRP AMAZON EU": ""}),
            row("13480", DESCRIPTION="WITCH HAT", **{"PARENT CATEGORY": "ACCESSORIES", "CATEGORY": "HATS AND CAPS", "USER": "ADULT WOMAN"}),
            row("99999", DESCRIPTION="BIG DISPLAY HALLOWEEN 61X30X187 CM"),
        ]
        specs, skipped = catalog.build(rows, self.translations)
        self.assertEqual([s.reason for s in skipped], ["Butiksinventar (display), ikke en vare"])
        hat, unicorn = specs
        self.assertEqual((hat.kind, hat.sku, hat.name, hat.price, hat.status), ("simple", "GU-13480", "Heksehat", 79, "publish"))
        self.assertEqual(hat.categories, [("Tilbehør", "Hatte og hjelme")])
        self.assertEqual((unicorn.kind, unicorn.sku, unicorn.name), ("variable", "GU-78224-78225", "Mørk enhjørning – kostume til piger"))
        self.assertEqual(unicorn.sizes, ["3-4 år", "5-6 år"])
        self.assertEqual([(v.sku, v.price) for v in unicorn.variations], [("GU-78224", None), ("GU-78225", 79)])
        self.assertEqual(unicorn.status, "publish")  # one size can be sold
        self.assertEqual(unicorn.issues, ["3-4 år: Mangler vejledende pris i Guircas ark"])
        self.assertEqual(unicorn.meta["_supplier_article_codes"], "78224,78225")
        self.assertIn("Størrelser: 3-4 år (109 cm) og 5-6 år (123 cm).", unicorn.description)

    def test_missing_translations_and_prices_make_drafts(self):
        specs, _ = catalog.build([row("1", DESCRIPTION="UNKNOWN THING", **{"PARENT CATEGORY": "ACCESSORIES", "CATEGORY": "TOYS"}), row("2", DESCRIPTION="BLACK WIG", **{"RRP AMAZON EU": "1455985.44"})], self.translations)
        self.assertEqual([s.status for s in specs], ["draft", "draft"])
        self.assertIn("Mangler dansk navn", specs[0].issues[0])
        self.assertIn("Urealistisk", specs[1].issues[0])

    def test_same_names_get_their_colours(self):
        translations = catalog.Translations(families={}, names={"MASK A": "Maske", "MASK B": "Maske"}, vocabulary={"CONTENT": {}, "MATERIALS": {}, "FABRIC": {}, "THEME": {}, "COLORS": {"RED": "rød", "BLUE": "blå"}})
        specs, _ = catalog.build([row("1", DESCRIPTION="MASK A", COLORS="RED"), row("2", DESCRIPTION="MASK B", COLORS="BLUE")], translations)
        self.assertEqual([s.name for s in specs], ["Maske, rød", "Maske, blå"])


if __name__ == "__main__":
    unittest.main()
