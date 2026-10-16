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

    def test_crude_jokes_outside_erotic_are_for_adults_too(self):
        crude = [
            "Penisforklæde", "Forklæde med lille penis", "Bevægelig penishat", "Hårbøjle med penisser, 6,5 cm", "Kæmpepenis, 75 cm",
            "Oppustelige bryster", "Blødt latexbryst, 9 cm", "Brystvortecovers med pailletter", "Oppustelige testikler – kostume til herrer",
            "Sexlegetøj – kostume til herrer", "Sexman-T-shirt med hætte", 'Pokal "Mister Sex"', "3 minikondomer i latex, 6 cm",
            "Sædcelle – kostume til herrer", "Nøgen-juleforklæde, 78 × 63 cm", "Juleforklæde med nøgenmotiv", "Fuckman-briller",
            "Dickman – kostume til herrer", "Åben gylp – kostume til herrer", "Hotdog-forklæde med overraskelse", "Halskæde med latexlem 12 cm",
            "Bondage – kostume til herrer", 'Erotisk spil "Date and Night" til voksne',
        ]
        for name in crude:
            self.assertTrue(rules.is_crude(name), name)
        # "penis" inside other words, a shirt front, a breastplate, padded busts, "sexy" costumes, surprises that aren't.
        harmless = [
            "Kæmpenisse", "Kæmpenisser med lys", "Skjortebryst 26 cm", "Steampunk-skjortebryst", "Indianerbrystplade",
            "Sexet politibetjent – kostume til herrer", "Sexet kanin – kostume til damer", "Sexsymbol-paryk (i æske)",
            "Overraskelses-chipsdåse 20 cm", "Hudfarvet body til børn", "Kondibukser",
        ]
        for name in harmless:
            self.assertFalse(rules.is_crude(name), name)
        # Contents: a costume with a penis, not a drag costume with a padded bust.
        self.assertTrue(rules.is_crude("Hingst – kostume til herrer", "<p>Indhold: hætte, heldragt og penis.</p>"))
        self.assertFalse(rules.is_crude("Dragqueen – kostume til herrer", "<p>Indhold: heldragt og bryster.</p>"))
        self.assertFalse(rules.is_crude("Vampyr – kostume til herrer", "<p>Indhold: kappe og bryststykke.</p>"))
        # Photos that say what the name doesn't, by the article number.
        self.assertTrue(rules.is_crude("Kat – kostume til herrer", "", "86041"))
        self.assertFalse(rules.is_crude("Kat – kostume til damer", "", "86040"))
        self.assertEqual(rules.crude_reason("Penisforklæde"), 'navn: "penis"')
        self.assertEqual(rules.crude_reason("Glad banan – kostume til herrer", "<p>Indhold: penis og dragt.</p>"), 'indhold: "penis"')
        self.assertTrue(rules.crude_reason("Pose med 3 sexy konfettikanoner", "", "14038").startswith("varenr. 14038: "))
        self.assertEqual(rules.crude_reason("Heksehat"), "")

    def test_seasons(self):
        self.assertEqual(rules.season_categories({"THEME": "Vampires, Cinema"}), [rules.HALLOWEEN])
        self.assertEqual(rules.season_categories({"SEASON": "X'MAS AND NEW YEAR"}), [rules.CHRISTMAS])
        self.assertEqual(rules.season_categories({"THEME": "Pirates"}), [])

    def test_generic_halloween_theme_alone_does_not_make_everyday_make_up_halloween(self):
        paint = {"PARENT CATEGORY": "ACCESSORIES", "CATEGORY": "MAKE UP", "SUBCATEGORY": "OILBASED MAKEUP", "THEME": "White Collour, Halloween", "SEASON": "HALLOWEEN & OKTOBERFEST"}
        self.assertEqual(rules.season_categories({**paint, "DESCRIPTION": "MAKE-UP TUBE, CREME 20ML, WHITE"}), [])
        self.assertEqual(rules.season_categories({"PARENT CATEGORY": "MAKE UP", "THEME": "Halloween", "DESCRIPTION": "SPONGE EGG SHAPE"}), [])
        lashes = {"PARENT CATEGORY": "ACCESSORIES", "CATEGORY": "MAKE UP", "SUBCATEGORY": "LASHES", "THEME": "Halloween"}
        self.assertEqual(rules.season_categories({**lashes, "DESCRIPTION": "BLACK EYELASHES"}), [])
        # A word of the season in the name, a specific theme or a seasonal category still counts.
        self.assertEqual(rules.season_categories({"PARENT CATEGORY": "MAKE UP", "CATEGORY": "MAKEUP SETS", "THEME": "Halloween", "DESCRIPTION": "SET ZOMBIE MAKEUP"}), [rules.HALLOWEEN])
        self.assertEqual(rules.season_categories({**lashes, "SUBCATEGORY": "NAILS", "DESCRIPTION": "12 BLOODY NAILS WITH GLUE"}), [rules.HALLOWEEN])
        self.assertEqual(rules.season_categories({**paint, "THEME": "Halloween, Witches", "DESCRIPTION": "MAKE-UP TUBE, CREME 20ML, GREEN"}), [rules.HALLOWEEN])
        # Blood and effects, masks and wigs keep the generic theme: there it marks scary items.
        self.assertEqual(rules.season_categories({"PARENT CATEGORY": "MAKE UP", "CATEGORY": "BLOOD AND LATEX", "THEME": "Halloween", "DESCRIPTION": "LATEX, 28 ML WHITE"}), [rules.HALLOWEEN])
        self.assertEqual(rules.season_categories({"PARENT CATEGORY": "ACCESSORIES", "CATEGORY": "MASKS", "THEME": "Halloween", "DESCRIPTION": "CROSS MASK, PVC"}), [rules.HALLOWEEN])
        self.assertEqual(rules.season_categories({"PARENT CATEGORY": "COSTUMES", "CATEGORY": "COSTUMES", "THEME": "Halloween", "DESCRIPTION": "TUNIC WITH HOOD, BLACK, ADULT, SIZE L"}), [rules.HALLOWEEN])

    def test_generic_christmas_themes_alone_do_not_make_make_up_and_accessories_christmas(self):
        self.assertEqual(rules.season_categories({"PARENT CATEGORY": "ACCESSORIES", "CATEGORY": "MAKE UP", "THEME": "Elf", "DESCRIPTION": "MAKE-UP TUBE, CREME 20ML, LIGHT GREEN"}), [])
        self.assertEqual(rules.season_categories({"PARENT CATEGORY": "ACCESSORIES", "CATEGORY": "PROSTHETICS", "THEME": "Christmas, Elf", "SEASON": "PERMANENTE", "DESCRIPTION": "LATEX ELF EARS"}), [])
        self.assertEqual(rules.season_categories({"PARENT CATEGORY": "ACCESSORIES", "CATEGORY": "WINGS", "THEME": "Angel, Christmas, Religion", "DESCRIPTION": "BLACK CLOTH ANGEL WINGS"}), [])
        # Guirca's Christmas season, a specific theme or a word of the season still counts.
        self.assertEqual(rules.season_categories({"PARENT CATEGORY": "ACCESSORIES", "CATEGORY": "HATS AND CAPS", "THEME": "Elf", "SEASON": "XMAS AND NEW YEAR", "DESCRIPTION": "ELF HAT"}), [rules.CHRISTMAS])
        self.assertEqual(rules.season_categories({"PARENT CATEGORY": "ACCESSORIES", "CATEGORY": "HATS AND CAPS", "THEME": "Christmas, Santa Claus", "DESCRIPTION": "HAT"}), [rules.CHRISTMAS])
        self.assertEqual(rules.season_categories({"PARENT CATEGORY": "ACCESSORIES", "CATEGORY": "GLASSES", "THEME": "Christmas", "DESCRIPTION": "CHRISTMAS GLASSES"}), [rules.CHRISTMAS])
        # Costumes keep the generic theme.
        self.assertEqual(rules.season_categories({"PARENT CATEGORY": "COSTUMES", "CATEGORY": "COSTUMES", "THEME": "Elf", "DESCRIPTION": "ELF, CHILDREN, 5-6 YEARS"}), [rules.CHRISTMAS])

    def test_colour_and_category_themes_are_not_tags(self):
        self.assertEqual(rules.tag_themes({"THEME": "Pirates, Black Colour, Halloween, White Collour"}), ["Pirates"])


class Merchandising(unittest.TestCase):
    def test_tiers_by_category(self):
        tier = lambda *paths: rules.merchandising_tier(paths)  # noqa: E731
        self.assertEqual(tier(("kostumer", "pigekostumer")), 0)
        self.assertEqual(tier(("kostumer", "hundekostumer")), 0)
        self.assertEqual(tier(("kostumer",)), 0)
        self.assertEqual(tier(("tilbehoer", "masker")), 1)
        self.assertEqual(tier(("tilbehoer", "parykker")), 1)
        self.assertEqual(tier(("tilbehoer", "skaeg-og-overskaeg")), 1)
        self.assertEqual(tier(("tilbehoer", "hatte-og-hjelme")), 1)
        self.assertEqual(tier(("make-up", "blod-og-effekter")), 1)
        self.assertEqual(tier(("make-up", "sminke-og-ansigtsmaling")), 1)
        self.assertEqual(tier(("tilbehoer", "briller")), 2)
        self.assertEqual(tier(("tilbehoer",)), 2)
        self.assertEqual(tier(("toej", "kapper")), 2)
        self.assertEqual(tier(("pynt-og-fest", "halloweenpynt")), 3)
        self.assertEqual(tier(("pynt-og-fest", "julepynt")), 3)
        self.assertEqual(tier(("halloween",)), 4)
        self.assertEqual(tier(("polterabend-18",)), 4)
        self.assertEqual(tier(), 4)
        # The best of the product's categories wins; the season categories never help.
        self.assertEqual(tier(("halloween",), ("pynt-og-fest", "halloweenpynt"), ("tilbehoer", "masker")), 1)

    def test_every_category_the_import_creates_has_its_tier(self):
        tiers = {path: rules.merchandising_tier([rules.slug_path(path)]) for path in rules.CATEGORY_ORDER}
        self.assertEqual(tiers[("Kostumer", "Babykostumer")], 0)
        self.assertEqual(tiers[("Tilbehør", "Hatte og hjelme")], 1)
        self.assertEqual(tiers[("Tøj", "Strømper og leggings")], 2)
        self.assertEqual(tiers[("Pynt og fest", "Figurer og animatronics")], 3)
        others = {path for path, tier in tiers.items() if tier == rules.OTHER_TIER}
        self.assertEqual(others, {rules.HALLOWEEN, rules.CHRISTMAS, rules.ADULT_ONLY})

    def test_category_slug_paths(self):
        categories = [{"id": 17, "slug": "tilbehoer", "parent": 0}, {"id": 81, "slug": "masker", "parent": 17}, {"id": 5, "slug": "loes", "parent": 99}]
        self.assertEqual(rules.category_slug_paths(categories), {17: ("tilbehoer",), 81: ("tilbehoer", "masker"), 5: ("loes",)})

    def test_menu_order_is_tier_then_newest_first(self):
        orders = rules.menu_orders([
            (1, "2020-01-01T00:00:00", 0),
            (2, "2026-01-01T00:00:00", 0),
            (3, "2026-01-01T00:00:00", 0),  # same date: the highest id first
            (4, "2026-10-15T17:33:32", 3),
            (5, None, 1),
        ])
        self.assertEqual(orders, {3: 0, 2: 1, 1: 2, 5: 100_000, 4: 300_000})
        self.assertEqual(sorted(orders, key=orders.get), [3, 2, 1, 5, 4])


class UniqueNames(unittest.TestCase):
    def test_facts_from_the_shop_texts(self):
        self.assertEqual(rules.measure("<p>Mål: ca. 23,5 × 17,8 × 7,8 cm.</p>"), "ca. 23,5 cm")
        self.assertEqual(rules.measure("<p>Mål: ca. 7 × 12,4 cm.</p>"), "ca. 12,4 cm")
        self.assertEqual(rules.measure("<p>Farve: hvid.</p>"), "")
        self.assertEqual(rules.pack_size("Sæt med 12 servietter"), "12 stk.")
        self.assertEqual(rules.pack_size("<p>Indhold: 2 ark.</p>"), "2 stk.")
        self.assertEqual(rules.pack_size("Kræver 3 × AA-batterier (medfølger ikke). Blond paryk"), "")
        facts = rules.name_facts(text="<p>Mål: ca. 21,4 × 12,3 cm.</p>", groups=["Damer", "Herrer"], colours=["Hvid", "Rød"], code="1135")
        self.assertEqual(facts, rules.NameFacts(size="ca. 21,4 cm", audience="til voksne", colour="hvid og rød", model="model 1135"))
        self.assertEqual(rules.name_facts(groups=["Piger"]).audience, "til piger")

    def test_each_gets_the_first_fact_that_tells_it_apart(self):
        voksne = dict(audience="til voksne", colour="hvid")
        renamed = rules.unique_names({
            1144: ("Kraniemaske, PVC, hvid", rules.NameFacts(size="ca. 23,5 cm", model="model 1144", **voksne)),
            20113: ("Kraniemaske, PVC, hvid", rules.NameFacts(model="model 20113", **voksne)),
            20118: ("Kraniemaske, PVC, hvid", rules.NameFacts(model="model 20118", **voksne)),
            4256: ("Mellemlang grøn paryk (i æske)", rules.NameFacts(audience="til damer", colour="grøn", model="model 4256")),
            4671: ("Mellemlang grøn paryk (i æske)", rules.NameFacts(audience="til herrer", colour="grøn", model="model 4671")),
            2190: ("Vampyrtænder, hvid og rød", rules.NameFacts(size="ca. 7,9 cm", model="model 2190")),
            2191: ("Vampyrtænder, hvid og rød", rules.NameFacts(size="ca. 6,8 cm", model="model 2191")),
            2318: ("vampyrtænder,  hvid og rød", rules.NameFacts(size="ca. 7,9 cm", model="model 2318")),
            1: ("Heksehat", rules.NameFacts(model="model 1")),
        })
        self.assertEqual(renamed, {
            1144: "Kraniemaske, PVC, hvid, ca. 23,5 cm",
            20113: "Kraniemaske, PVC, hvid, model 20113",
            20118: "Kraniemaske, PVC, hvid, model 20118",
            4256: "Mellemlang grøn paryk (i æske), til damer",
            4671: "Mellemlang grøn paryk (i æske), til herrer",
            2190: "Vampyrtænder, hvid og rød, model 2190",  # same size as 2318
            2191: "Vampyrtænder, hvid og rød, ca. 6,8 cm",
            2318: "vampyrtænder,  hvid og rød, model 2318",
        })

    def test_facts_the_name_already_states_are_skipped(self):
        renamed = rules.unique_names({
            1: ("Segl 47 cm", rules.NameFacts(size="ca. 47,2 cm", model="model 1")),
            2: ("Segl 47 cm", rules.NameFacts(size="ca. 46,9 cm", model="model 2")),
            3: ("Cowboyvest til børn", rules.NameFacts(audience="til drenge", model="model 3")),
            4: ("Cowboyvest til børn", rules.NameFacts(audience="til børn", model="model 4")),
            5: ("Kraniemaske, hvid", rules.NameFacts(colour="hvid og sort", model="model 5")),
            6: ("Kraniemaske, hvid", rules.NameFacts(colour="hvid", model="model 6")),
        })
        self.assertEqual(set(renamed.values()), {
            "Segl 47 cm, model 1", "Segl 47 cm, model 2",
            "Cowboyvest til børn, model 3", "Cowboyvest til børn, model 4",
            "Kraniemaske, hvid, model 5", "Kraniemaske, hvid, model 6",
        })

    def test_a_new_name_never_takes_another_products_name(self):
        renamed = rules.unique_names({
            1: ("Maske", rules.NameFacts(colour="rød", model="model 1")),
            2: ("Maske", rules.NameFacts(colour="blå", model="model 2")),
            3: ("Maske, rød", rules.NameFacts(model="model 3")),
        })
        self.assertEqual(renamed, {1: "Maske, model 1", 2: "Maske, blå"})


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
        row = {"ARTICLE CODE": "1", "LINK": "http://marketing.guirca.com/1/1.jpg", "Link_CostumeBack": "http://marketing.guirca.com/1/1_02.jpg", "Link_CostumeCat": "http://marketing.guirca.com/1/1.jpg"}
        self.assertEqual(rules.image_urls(row), ["https://marketing.guirca.com/1/1.jpg", "https://marketing.guirca.com/1/1_02.jpg"])
        dead = rules.ImageStatus(dead=frozenset({"https://marketing.guirca.com/1/1.jpg"}))
        self.assertEqual(rules.image_urls(row, dead), ["https://marketing.guirca.com/1/1_02.jpg"])
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


    def test_photos_on_the_server_the_sheet_does_not_list(self):
        # Ølflaske: the sheet lists only the main photo; the server also has _01 and _02.
        row = {"ARTICLE CODE": "86865", "LINK": "http://marketing.guirca.com/86865/86865.jpg"}
        names = rules.server_images("86865")
        self.assertEqual(len(names), 21)
        self.assertEqual(names[:3], ["https://marketing.guirca.com/86865/86865.jpg", "https://marketing.guirca.com/86865/86865_01.jpg", "https://marketing.guirca.com/86865/86865_07.jpg"])
        self.assertIn("https://marketing.guirca.com/86865/86865.jpg", rules.image_candidates(row))
        self.assertEqual(len(rules.image_candidates(row)), 21)
        status = rules.ImageStatus.parse([
            "https://marketing.guirca.com/86865/86865_02.jpg\t200\timage/jpeg",
            "https://marketing.guirca.com/86865/86865_01.jpg\t200\timage/jpeg",
            "https://marketing.guirca.com/86865/86865_07.jpg\t404\ttext/html",
        ])
        # Ordered like the sheet's columns: main, catalogue (_01), back (_02).
        self.assertEqual(rules.image_urls(row, status), [
            "https://marketing.guirca.com/86865/86865.jpg",
            "https://marketing.guirca.com/86865/86865_01.jpg",
            "https://marketing.guirca.com/86865/86865_02.jpg",
        ])

    def test_links_with_a_space_in_the_code_are_found_under_the_code(self):
        row = {"ARTICLE CODE": "13101", "LINK": "http://marketing.guirca.com/13101 /13101 .jpg"}
        self.assertEqual(rules.server_images(" 13101 ")[0], "https://marketing.guirca.com/13101/13101.jpg")
        status = rules.ImageStatus.parse([
            "https://marketing.guirca.com/13101%20/13101%20.jpg\t404\ttext/html",
            "https://marketing.guirca.com/13101/13101.jpg\t200\timage/jpeg",
        ])
        self.assertEqual(rules.image_urls(row, status), ["https://marketing.guirca.com/13101/13101.jpg"])

    def test_image_check_answers(self):
        status = rules.ImageStatus.parse([
            "https://x/a.jpg\t206\timage/jpeg",   # found (range request)
            "https://x/b.jpg\t404\ttext/html",    # dead
            "https://x/c.jpg\t000\t",             # no answer
            "https://x/d.jpg\t503\ttext/html",    # server error: no answer
            "https://x/e.jpg\t200\ttext/html",    # not a photo
            "https://x/f.jpg\t404\ttext/html",
            "https://x/f.jpg\t200\timage/jpeg",   # a later answer wins
            "https://x/a.jpg\t000\t",             # ... but no answer keeps the last one
        ])
        self.assertEqual(status.found, {"https://x/a.jpg", "https://x/f.jpg"})
        self.assertEqual(status.dead, {"https://x/b.jpg", "https://x/e.jpg"})
        # Links without an answer are kept; photos not found on the server are not added.
        row = {"ARTICLE CODE": "7", "LINK": "https://x/c.jpg"}
        self.assertEqual(rules.image_urls(row, status), ["https://x/c.jpg"])

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

    def test_products_for_adults_only_are_drafts_in_the_adult_category(self):
        translations = catalog.Translations(
            families={"STALLION": "Hingst"},
            names={"PENIS APRON": "Penisforklæde", "BALL GAG, ADULT": "Ball gag til voksne", "GIANT ELF": "Kæmpenisse", "INFLATABLE BREASTS": "Oppustelige bryster"},
            vocabulary={"CONTENT": {"PENIS": "penis", "HOOD": "hætte", "ONEPIECE": "heldragt"}, "MATERIALS": {}, "COLORS": {}, "FABRIC": {}, "THEME": {}},
        )
        party = {"PARENT CATEGORY": "ACCESSORIES", "USER": "ADULT UNISEX", "THEME": "Bachelor parties"}
        rows = [
            row("69080", DESCRIPTION="PENIS APRON", **{**party, "CATEGORY": "TEXTILE"}),
            row("69040", DESCRIPTION="BALL GAG, ADULT", **{**party, "CATEGORY": "EROTIC"}),
            row("18070", DESCRIPTION="INFLATABLE BREASTS", **{**party, "CATEGORY": "INFLATABLES", "THEME": "Bachelor parties, Halloween"}),
            row("40001", DESCRIPTION="GIANT ELF", **{"PARENT CATEGORY": "DECORATION", "CATEGORY": "CHRISTMAS DECORATION", "SEASON": "XMAS AND NEW YEAR"}),
            row("89053", DESCRIPTION="STALLION, 48 – 50 (M), ADULT", CONTENT="HOOD, ONEPIECE, PENIS", **{"USER": "ADULT MAN", "PARENT CATEGORY": "COSTUMES", "CATEGORY": "ADULT", "PARENT DESCRIPTION": "STALLION", "SIZE": "48 - 50 (M)", "CONNECTOR SIZE": "89053", "THEME": "Halloween"}),
            row("89054", DESCRIPTION="STALLION, 52 – 54 (L), ADULT", CONTENT="HOOD, ONEPIECE, PENIS", **{"USER": "ADULT MAN", "PARENT CATEGORY": "COSTUMES", "CATEGORY": "ADULT", "PARENT DESCRIPTION": "STALLION", "SIZE": "52 - 54 (L)", "CONNECTOR SIZE": "89053", "THEME": "Halloween"}),
        ]
        specs = {s.sku: s for s in catalog.build(rows, translations)[0]}
        for sku in ("GU-69080", "GU-69040", "GU-18070", "GU-89053-89054"):
            spec = specs[sku]
            self.assertEqual((spec.adult_only, spec.categories, spec.status), (True, [rules.ADULT_ONLY], rules.ADULT_STATUS), sku)
        # Not Halloween: the season categories are left out too. The giant elf is Christmas decoration.
        elf = specs["GU-40001"]
        self.assertEqual((elf.adult_only, elf.status), (False, "publish"))
        self.assertIn(rules.CHRISTMAS, elf.categories)
        self.assertEqual(catalog.status_for(True, True), rules.ADULT_STATUS)
        self.assertEqual(catalog.status_for(False, True), "draft")
        self.assertEqual(catalog.status_for(True, False), "publish")

    def test_adult_changes_for_the_products_in_woocommerce(self):
        adult = {"id": 300, "slug": "polterabend-18"}
        products = [
            {"id": 1, "name": "Ball gag til voksne", "sku": "GU-69040", "status": "publish", "categories": [{"id": 300}], "webshops": ["halloween-kostumer-dk"]},
            {"id": 2, "name": "Penisforklæde", "sku": "GU-69080", "status": "publish", "categories": [{"id": 40}], "webshops": ["halloween-kostumer-dk", "piece-dk"]},
            {"id": 3, "name": "Hingst – kostume til herrer", "sku": "GU-89053-89054", "status": "draft", "categories": [{"id": 12}], "webshops": ["halloween-kostumer-dk"], "description": "<p>Indhold: hætte, heldragt og penis.</p>"},
            {"id": 4, "name": "Kat – kostume til herrer", "sku": "GU-86041-86041", "status": "publish", "categories": [{"id": 12}], "webshops": ["piece-dk"]},
            {"id": 5, "name": "Kæmpenisse", "sku": "GU-40001", "status": "publish", "categories": [{"id": 50}], "webshops": ["piece-dk"]},
            {"id": 6, "name": "Sort G-streng i blonde", "sku": "GU-69046", "status": "draft", "categories": [{"id": 300}], "webshops": []},
        ]
        changes = {c.product["id"]: c for c in catalog.adult_changes(products, adult, ("halloween-kostumer-dk",))}
        self.assertEqual(sorted(changes), [1, 2, 3, 4, 6])
        self.assertEqual(changes[1].update, {"id": 1, "status": "draft"})
        self.assertEqual(changes[2].update, {"id": 2, "status": "draft", "categories": [{"id": 300}], "webshops": ["halloween-kostumer-dk"]})
        self.assertEqual(changes[3].update, {"id": 3, "categories": [{"id": 300}]})
        self.assertEqual((changes[4].reason[:13], changes[4].update["webshops"]), ("varenr. 86041", ["halloween-kostumer-dk"]))
        # Already in the 18+ category and a draft: nothing to change, and its webshops are left alone.
        self.assertEqual(changes[6].update, {"id": 6})
        self.assertEqual(changes[1].reason, "18+-kategorien")
        result = {"status": "draft", "categories": [{"id": 300, "name": "Polterabend (18+)"}], "webshops": ["halloween-kostumer-dk"]}
        self.assertTrue(catalog.adult_saved(changes[2].update, result))
        self.assertFalse(catalog.adult_saved(changes[2].update, {**result, "webshops": ["halloween-kostumer-dk", "piece-dk"]}))
        self.assertFalse(catalog.adult_saved(changes[1].update, {**result, "status": "publish"}))
        self.assertEqual(catalog.sku_code("GU-89053-89054"), "89053")
        self.assertEqual(catalog.sku_code("TS-001"), "")

    def test_missing_translations_and_prices_make_drafts(self):
        specs, _ = catalog.build([row("1", DESCRIPTION="UNKNOWN THING", **{"PARENT CATEGORY": "ACCESSORIES", "CATEGORY": "TOYS"}), row("2", DESCRIPTION="BLACK WIG", **{"RRP AMAZON EU": "1455985.44"})], self.translations)
        self.assertEqual([s.status for s in specs], ["draft", "draft"])
        self.assertIn("Mangler dansk navn", specs[0].issues[0])
        self.assertIn("Urealistisk", specs[1].issues[0])

    def test_same_names_get_their_colours(self):
        translations = catalog.Translations(families={}, names={"MASK A": "Maske", "MASK B": "Maske"}, vocabulary={"CONTENT": {}, "MATERIALS": {}, "FABRIC": {}, "THEME": {}, "COLORS": {"RED": "rød", "BLUE": "blå"}})
        specs, _ = catalog.build([row("1", DESCRIPTION="MASK A", COLORS="RED"), row("2", DESCRIPTION="MASK B", COLORS="BLUE")], translations)
        self.assertEqual([s.name for s in specs], ["Maske, rød", "Maske, blå"])

    def test_same_names_and_colours_get_what_tells_them_apart(self):
        translations = catalog.Translations(
            families={},
            names={"SKULL MASK PVC": "Kraniemaske, PVC, hvid", "SKULL MASK, PVC": "Kraniemaske, PVC, hvid", "VAMPIRE TEETH": "Vampyrtænder"},
            vocabulary={"CONTENT": {}, "MATERIALS": {}, "FABRIC": {}, "THEME": {}, "COLORS": {"WHITE": "hvid"}},
        )
        mask = {"PARENT CATEGORY": "ACCESSORIES", "CATEGORY": "MASKS", "USER": "ADULT UNISEX", "COLORS": "WHITE"}
        sized = {"LENGTH PRODUCT W/O PACKAGING": "23.5", "WIDTH PRODUCT W/O PACKAGING": "17.8", "HEIGHT PRODUCT W/O PACKAGING": "7.8"}
        rows = [
            row("1144", DESCRIPTION="SKULL MASK PVC", **mask, **sized),
            row("20113", DESCRIPTION="SKULL MASK PVC", **mask),
            row("20118", DESCRIPTION="SKULL MASK, PVC", **mask),
            row("2190", DESCRIPTION="VAMPIRE TEETH", **{**mask, "USER": "CHILD UNISEX"}),
            row("2191", DESCRIPTION="VAMPIRE TEETH", **mask),
        ]
        specs, _ = catalog.build(rows, translations)
        self.assertEqual([s.name for s in specs], [
            "Kraniemaske, PVC, hvid, ca. 23,5 cm",
            "Vampyrtænder, til børn",
            "Vampyrtænder, til voksne",
            "Kraniemaske, PVC, hvid, model 20113",
            "Kraniemaske, PVC, hvid, model 20118",
        ])
        self.assertEqual(len({rules.name_key(s.name) for s in specs}), len(specs))
        self.assertEqual({rules.merchandising_tier([rules.slug_path(c) for c in s.categories]) for s in specs}, {1})


if __name__ == "__main__":
    unittest.main()
