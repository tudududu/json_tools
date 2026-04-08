import os
import tempfile
import unittest

from python import csv_to_json as mod


def tmp_csv(content: str) -> str:
    f = tempfile.NamedTemporaryFile("w+", delete=False, suffix=".csv")
    f.write(content)
    f.flush()
    f.close()
    return f.name


class GenericTimedKeysTests(unittest.TestCase):
    def test_controller_keys_top_level_and_video_and_flag_precedence(self):
        csv_content = (
            "record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL;GBL\n"
            "meta_global;;;;;briefVersion;Y;ALL;53;;\n"
            "meta_global;;;;;fps;Y;ALL;25;;\n"
            "meta_global;;;;;controller_01_flag;Y;ALL;G01;;\n"
            "meta_global;;;;;controller_02_flag;Y;ALL;G02;;\n"
            "controller_01;;1;00:00:01:00;00:00:02:00;;;;;G1_L1;\n"
            "controller_01;;2;00:00:03:00;00:00:04:00;;;;;G1_L2;G1_P2\n"
            "controller_02;;1;00:00:05:00;00:00:06:00;;;;;G2_L1;G2_P1\n"
            "meta_local;VID_G;;;;title;N;ALL;TitleG;;\n"
            "meta_local;VID_G;;;;controller_01_flag;N;ALL;L01;;\n"
            "sub;VID_G;1;00:00:00:00;00:00:01:00;;;;;helloL;helloP\n"
            "controller_01;VID_G;1;00:00:01:00;00:00:02:00;;;;;V1_L1;\n"
            "controller_01;VID_G;2;00:00:03:00;00:00:04:00;;;;;;V1_P2\n"
            "controller_02;VID_G;1;00:00:05:00;00:00:06:00;;;;;;\n"
        )
        path = tmp_csv(csv_content)
        try:
            out = mod.convert_csv_to_json(
                path, fps=25, prefer_local_claim_disclaimer=True
            )
        finally:
            os.remove(path)

        node = out["byCountry"]["GBL"]

        self.assertIn("controller_01", node)
        self.assertIn("controller_02", node)
        self.assertEqual(node["controller_01"]["landscape"], ["G1_L1", "G1_L2"])
        self.assertEqual(node["controller_01"]["portrait"], ["G1_L1", "G1_P2"])
        self.assertEqual(node["controller_02"]["portrait"], ["G2_P1"])

        v_land = next(v for v in node["videos"] if v["videoId"].endswith("_landscape"))
        v_port = next(v for v in node["videos"] if v["videoId"].endswith("_portrait"))

        self.assertEqual(v_land["metadata"].get("controller_01_flag"), "L01")
        self.assertEqual(v_land["metadata"].get("controller_02_flag"), "G02")

        self.assertEqual([x["text"] for x in v_land["controller_01"]], ["V1_L1", "G1_L2"])
        self.assertEqual([x["text"] for x in v_port["controller_01"]], ["V1_L1", "V1_P2"])

        # No local controller_02 text -> falls back to global by timing/index
        self.assertEqual(v_land["controller_02"][0]["text"], "G2_L1")
        self.assertEqual(v_port["controller_02"][0]["text"], "G2_P1")

    def test_controller_key_has_no_merge_no_dedup(self):
        csv_content = (
            "record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL;GBL\n"
            "meta_global;;;;;briefVersion;Y;ALL;53;;\n"
            "meta_global;;;;;fps;Y;ALL;25;;\n"
            "meta_local;VID_D;;;;title;N;ALL;TitleD;;\n"
            "sub;VID_D;1;00:00:00:00;00:00:01:00;;;;;helloL;helloP\n"
            "controller_01;VID_D;1;00:00:01:00;00:00:02:00;;;;;DUP;\n"
            "controller_01;VID_D;1;00:00:01:00;00:00:02:00;;;;;DUP;\n"
        )
        path = tmp_csv(csv_content)
        try:
            out = mod.convert_csv_to_json(path, fps=25)
        finally:
            os.remove(path)

        node = out["byCountry"]["GBL"]
        v_land = next(v for v in node["videos"] if v["videoId"].endswith("_landscape"))

        self.assertIn("controller_01", v_land)
        self.assertEqual(len(v_land["controller_01"]), 2)
        self.assertEqual(v_land["controller_01"][0]["text"], "DUP")
        self.assertEqual(v_land["controller_01"][1]["text"], "DUP")

    def test_ordering_contract_top_level_and_per_video(self):
        csv_content = (
            "record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL;GBL\n"
            "meta_global;;;;;briefVersion;Y;ALL;53;;\n"
            "meta_global;;;;;fps;Y;ALL;25;;\n"
            "claim;;1;00:00:01:00;00:00:02:00;;;;;C1;\n"
            "disclaimer;;1;00:00:02:00;00:00:03:00;;;;;D1;\n"
            "logo;;1;00:00:03:00;00:00:04:00;;;;;L1;\n"
            "controller_01;;1;00:00:04:00;00:00:05:00;;;;;G1;\n"
            "controller_02;;1;00:00:05:00;00:00:06:00;;;;;G2;\n"
            "meta_local;VID_O;;;;title;N;ALL;TitleO;;\n"
            "sub;VID_O;1;00:00:00:00;00:00:01:00;;;;;sL;sP\n"
            "super_a;VID_O;1;00:00:01:00;00:00:02:00;;;;;aL;aP\n"
            "super_b;VID_O;1;00:00:02:00;00:00:03:00;;;;;bL;bP\n"
            "claim;VID_O;1;00:00:01:00;00:00:02:00;;;;;vC;\n"
            "disclaimer;VID_O;1;00:00:00:00;00:00:00:00;;;;;vD;\n"
        )
        path = tmp_csv(csv_content)
        try:
            out = mod.convert_csv_to_json(path, fps=25)
        finally:
            os.remove(path)

        node = out["byCountry"]["GBL"]
        top_keys = list(node.keys())
        self.assertIn("controller_01", top_keys)
        self.assertIn("controller_02", top_keys)
        self.assertIn("videos", top_keys)
        self.assertLess(top_keys.index("controller_01"), top_keys.index("videos"))
        self.assertLess(top_keys.index("controller_02"), top_keys.index("videos"))

        v_land = next(v for v in node["videos"] if v["videoId"].endswith("_landscape"))
        v_keys = list(v_land.keys())
        self.assertIn("super_B", v_keys)
        self.assertIn("claim", v_keys)
        self.assertIn("disclaimer", v_keys)
        self.assertLess(v_keys.index("super_B"), v_keys.index("claim"))
        self.assertLess(v_keys.index("claim"), v_keys.index("disclaimer"))

    def test_controller_missing_local_rows_emit_empty_per_video_list(self):
        csv_content = (
            "record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL;GBL\n"
            "meta_global;;;;;briefVersion;Y;ALL;53;;\n"
            "meta_global;;;;;fps;Y;ALL;25;;\n"
            "controller_01;;1;00:00:01:00;00:00:02:00;;;;;G1_L1;G1_P1\n"
            "controller_02;;1;00:00:03:00;00:00:04:00;;;;;G2_L1;G2_P1\n"
            "meta_local;VID_A;;;;title;N;ALL;TitleA;;\n"
            "sub;VID_A;1;00:00:00:00;00:00:01:00;;;;;aL;aP\n"
            "controller_01;VID_A;1;00:00:01:00;00:00:02:00;;;;;A1_L;A1_P\n"
            "controller_02;VID_A;1;00:00:03:00;00:00:04:00;;;;;A2_L;A2_P\n"
            "meta_local;VID_B;;;;title;N;ALL;TitleB;;\n"
            "sub;VID_B;1;00:00:00:00;00:00:01:00;;;;;bL;bP\n"
            "controller_01;VID_B;1;00:00:01:00;00:00:02:00;;;;;B1_L;B1_P\n"
        )
        path = tmp_csv(csv_content)
        try:
            out = mod.convert_csv_to_json(path, fps=25)
        finally:
            os.remove(path)

        node = out["byCountry"]["GBL"]

        v_b_land = next(v for v in node["videos"] if v["videoId"] == "VID_B_landscape")
        v_b_port = next(v for v in node["videos"] if v["videoId"] == "VID_B_portrait")

        self.assertEqual([x["text"] for x in v_b_land["controller_01"]], ["B1_L"])
        self.assertEqual([x["text"] for x in v_b_port["controller_01"]], ["B1_P"])
        self.assertEqual(v_b_land["controller_02"], [])
        self.assertEqual(v_b_port["controller_02"], [])

    def test_controller_always_emit_opt_in_restores_global_fallback(self):
        csv_content = (
            "record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL;GBL\n"
            "meta_global;;;;;briefVersion;Y;ALL;53;;\n"
            "meta_global;;;;;fps;Y;ALL;25;;\n"
            "controller_01;;1;00:00:01:00;00:00:02:00;;;;;G1_L1;G1_P1\n"
            "controller_02;;1;00:00:03:00;00:00:04:00;;;;;G2_L1;G2_P1\n"
            "meta_local;VID_A;;;;title;N;ALL;TitleA;;\n"
            "sub;VID_A;1;00:00:00:00;00:00:01:00;;;;;aL;aP\n"
            "controller_01;VID_A;1;00:00:01:00;00:00:02:00;;;;;A1_L;A1_P\n"
            "controller_02;VID_A;1;00:00:03:00;00:00:04:00;;;;;A2_L;A2_P\n"
            "meta_local;VID_B;;;;title;N;ALL;TitleB;;\n"
            "sub;VID_B;1;00:00:00:00;00:00:01:00;;;;;bL;bP\n"
            "controller_01;VID_B;1;00:00:01:00;00:00:02:00;;;;;B1_L;B1_P\n"
        )
        path = tmp_csv(csv_content)
        try:
            out = mod.convert_csv_to_json(path, fps=25, controller_always_emit=True)
        finally:
            os.remove(path)

        node = out["byCountry"]["GBL"]

        v_b_land = next(v for v in node["videos"] if v["videoId"] == "VID_B_landscape")
        v_b_port = next(v for v in node["videos"] if v["videoId"] == "VID_B_portrait")

        self.assertEqual([x["text"] for x in v_b_land["controller_01"]], ["B1_L"])
        self.assertEqual([x["text"] for x in v_b_port["controller_01"]], ["B1_P"])
        self.assertEqual([x["text"] for x in v_b_land["controller_02"]], ["G2_L1"])
        self.assertEqual([x["text"] for x in v_b_port["controller_02"]], ["G2_P1"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
