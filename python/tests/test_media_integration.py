import os
import json
import tempfile
import unittest

try:
    from openpyxl import Workbook
except Exception:
    Workbook = None

from python import csv_to_json as mod


def tmp_file(suffix=".csv"):
    f = tempfile.NamedTemporaryFile("w+", delete=False, suffix=suffix)
    f.close()
    return f.name


class MediaIntegrationTests(unittest.TestCase):
    @staticmethod
    @unittest.skipUnless(Workbook is not None, "openpyxl is required for XLSX tests")
    def _write_layer_config_xlsx(path: str):
        wb = Workbook()
        ws_layers = wb.active
        ws_layers.title = "LAYER_NAME_CONFIG_items"
        ws_layers.append(["key", "exact", "contains"])
        ws_layers.append(["logo", "logo_01;Size_Holder_Logo", ""])
        ws_rules = wb.create_sheet(title="LAYER_NAME_CONFIG_recenterRules")
        ws_rules.append(["force", "noRecenter", "alignH", "alignV"])
        ws_rules.append(["Logo", "BG", "Claim", "Disclaimer"])
        ws_tb = wb.create_sheet(title="TIMING_BEHAVIOR")
        ws_tb.append(["layerName", "behavior"])
        ws_tb.append(["logo", "timed"])
        ws_tis = wb.create_sheet(title="TIMING_ITEM_SELECTOR")
        ws_tis.append(["itemName", "mode", "value"])
        ws_tis.append(["logo", "line", 1])
        ws_skip = wb.create_sheet(title="SKIP_COPY_CONFIG")
        ws_skip.append(["key", "value", "names"])
        ws_skip.append(["groups", "TRUE", "info; claim"])
        ws_skip.append(["disclaimerOff", "TRUE", ""])
        wb.save(path)
        wb.close()

    def test_media_injected_for_exact_country_language(self):
        # Unified CSV with two countries; language meta_global empty
        csv_content = (
            "record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL;FRA;GBL;FRA\n"
            "meta_global;;;;;briefVersion;Y;ALL;6;;;;\n"
            "meta_global;;;;;fps;Y;ALL;25;;;;\n"
            "meta_global;;;;;language;Y;ALL;;;;;\n"
            "meta_local;V;;;;title;N;ALL;T;;;;\n"
            "sub;V;1;00:00:00:00;00:00:01:00;;;;;;;;x;y\n"
        )
        media_csv = (
            "AspectRatio;Dimensions;Creative;Media;Template;Template_name;Country;Language\n"
            "1x1;640x640;06sC1;TikTok;regular;;GBL;\n"
            "9x16;720x1280;15sC1;Meta InFeed;extra;tiktok;GBL;\n"
        )
        in_path = tmp_file(".csv")
        with open(in_path, "w", encoding="utf-8") as f:
            f.write(csv_content)
        media_path = tmp_file(".csv")
        with open(media_path, "w", encoding="utf-8") as f:
            f.write(media_csv)
        try:
            with tempfile.TemporaryDirectory() as td:
                pattern = os.path.join(td, "out-{country}.json")
                rc = mod.main(
                    [
                        in_path,
                        pattern,
                        "--split-by-country",
                        "--media-config",
                        media_path,
                    ]
                )
                self.assertEqual(rc, 0)
                gbl_path = os.path.join(td, "out-GBL.json")
                fra_path = os.path.join(td, "out-FRA.json")
                self.assertTrue(os.path.isfile(gbl_path))
                self.assertTrue(os.path.isfile(fra_path))
                with open(gbl_path, "r", encoding="utf-8") as f:
                    gbl = json.load(f)
                with open(fra_path, "r", encoding="utf-8") as f:
                    fra = json.load(f)
                self.assertIn("config", gbl)
                self.assertIn("pack", gbl["config"])
                self.assertIn("EXTRA_OUTPUT_COMPS", gbl["config"]["pack"])
                self.assertNotIn("config", fra)
                self.assertNotIn("media", gbl)
                self.assertNotIn("media", fra)
                # Basic sanity of media content
                self.assertIn("1x1|06s", gbl["config"]["pack"]["EXTRA_OUTPUT_COMPS"])
        finally:
            try:
                os.remove(in_path)
            except Exception:
                pass
            try:
                os.remove(media_path)
            except Exception:
                pass

    @unittest.skipUnless(Workbook is not None, "openpyxl is required for XLSX tests")
    def test_media_injected_from_xlsx_media_file(self):
        csv_content = (
            "record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL;FRA;GBL;FRA\n"
            "meta_global;;;;;briefVersion;Y;ALL;6;;;;\n"
            "meta_global;;;;;fps;Y;ALL;25;;;;\n"
            "meta_global;;;;;language;Y;ALL;;;;;\n"
            "meta_local;V;;;;title;N;ALL;T;;;;\n"
            "sub;V;1;00:00:00:00;00:00:01:00;;;;;;;;x;y\n"
        )
        in_path = tmp_file(".csv")
        with open(in_path, "w", encoding="utf-8") as f:
            f.write(csv_content)

        media_path = tmp_file(".xlsx")
        wb = Workbook()
        ws = wb.active
        ws.title = "media"
        ws.append(
            [
                "AspectRatio",
                "Dimensions",
                "Creative",
                "Media",
                "Template",
                "Template_name",
                "Country",
                "Language",
            ]
        )
        ws.append(["1x1", "640x640", "06sC1", "TikTok", "regular", "", "GBL", ""])
        wb.save(media_path)
        wb.close()

        try:
            with tempfile.TemporaryDirectory() as td:
                pattern = os.path.join(td, "out-{country}.json")
                rc = mod.main(
                    [
                        in_path,
                        pattern,
                        "--split-by-country",
                        "--media-config",
                        media_path,
                    ]
                )
                self.assertEqual(rc, 0)
                gbl_path = os.path.join(td, "out-GBL.json")
                fra_path = os.path.join(td, "out-FRA.json")
                self.assertTrue(os.path.isfile(gbl_path))
                self.assertTrue(os.path.isfile(fra_path))
                with open(gbl_path, "r", encoding="utf-8") as f:
                    gbl = json.load(f)
                with open(fra_path, "r", encoding="utf-8") as f:
                    fra = json.load(f)
                self.assertIn("config", gbl)
                self.assertIn("pack", gbl["config"])
                self.assertIn("EXTRA_OUTPUT_COMPS", gbl["config"]["pack"])
                self.assertNotIn("config", fra)
                self.assertNotIn("media", gbl)
                self.assertNotIn("media", fra)
                self.assertIn("1x1|06s", gbl["config"]["pack"]["EXTRA_OUTPUT_COMPS"])
        finally:
            try:
                os.remove(in_path)
            except Exception:
                pass
            try:
                os.remove(media_path)
            except Exception:
                pass

    @unittest.skipUnless(Workbook is not None, "openpyxl is required for XLSX tests")
    def test_layer_config_injected_under_config_add_layers(self):
        csv_content = (
            "record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL\n"
            "meta_global;;;;;briefVersion;Y;ALL;6;\n"
            "meta_global;;;;;fps;Y;ALL;25;\n"
            "meta_global;;;;;language;Y;ALL;;\n"
            "meta_local;V;;;;title;N;ALL;T;\n"
            "sub;V;1;00:00:00:00;00:00:01:00;;;;;;;x\n"
        )
        in_path = tmp_file(".csv")
        with open(in_path, "w", encoding="utf-8") as f:
            f.write(csv_content)

        layer_cfg_path = tmp_file(".xlsx")
        self._write_layer_config_xlsx(layer_cfg_path)

        try:
            with tempfile.TemporaryDirectory() as td:
                out_json = os.path.join(td, "out.json")
                rc = mod.main([in_path, out_json, "--layer-config", layer_cfg_path])
                self.assertEqual(rc, 0)
                with open(out_json, "r", encoding="utf-8") as f:
                    payload = json.load(f)
                self.assertIn("config", payload)
                self.assertIn("addLayers", payload["config"])
                add_layers = payload["config"]["addLayers"]
                self.assertIn("LAYER_NAME_CONFIG", add_layers)
                self.assertIn("TIMING_BEHAVIOR", add_layers)
                self.assertIn("TIMING_ITEM_SELECTOR", add_layers)
                self.assertIn("SKIP_COPY_CONFIG", add_layers)
                self.assertIn("logo", add_layers["LAYER_NAME_CONFIG"])
                self.assertEqual(add_layers["TIMING_BEHAVIOR"].get("logo"), "timed")
                self.assertEqual(
                    add_layers["TIMING_ITEM_SELECTOR"].get("logo"),
                    {"mode": "line", "value": 1},
                )
                self.assertEqual(
                    add_layers["SKIP_COPY_CONFIG"].get("groups"),
                    {"enabled": True, "names": ["info", "claim"]},
                )
        finally:
            try:
                os.remove(in_path)
            except Exception:
                pass
            try:
                os.remove(layer_cfg_path)
            except Exception:
                pass


if __name__ == "__main__":
    unittest.main(verbosity=2)
