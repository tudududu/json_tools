import os
import json
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
PYTHON_DIR = os.path.abspath(os.path.join(HERE, '..'))
if PYTHON_DIR not in sys.path:
    sys.path.insert(0, PYTHON_DIR)

import csv_to_json as mod


def tmp_csv(content: str) -> str:
    f = tempfile.NamedTemporaryFile('w+', delete=False, suffix='.csv')
    f.write(content)
    f.flush()
    f.close()
    return f.name


class FlagsAndMergingTests(unittest.TestCase):
    def test_cast_and_prefer_local_and_claims_as_objects_and_no_orientation(self):
        # Single-country (GBL) unified schema; local claim/disclaimer should win with prefer_local flag.
        csv_content = (
            'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL\n'
            # Required globals
            'meta_global;;;;;briefVersion;Y;ALL;53;\n'
            'meta_global;;;;;fps;Y;ALL;25;\n'
            # Video metadata; duration as string numeric; title non-numeric to avoid cast
            'meta_local;VID_A;;;;duration;N;ALL;45;\n'
            'meta_local;VID_A;;;;title;N;ALL;TitleA;\n'
            # Global claim/disclaimer with timing
            'claim;;1;00:00:10:00;00:00:12:00;;;;;GLOBAL_CLAIM;\n'
            'disclaimer;;1;00:00:20:00;00:00:22:00;;;;;GLOBAL_DISC;\n'
            # Per-video local claim/disclaimer with same timing (should override when prefer_local set)
            'claim;VID_A;;00:00:10:00;00:00:12:00;;;;;LOCAL_CLAIM;\n'
            'disclaimer;VID_A;;00:00:20:00;00:00:22:00;;;;;LOCAL_DISC;\n'
            # One subtitle to materialize videos
            'sub;VID_A;1;00:00:00:00;00:00:01:00;;;;;;;;hello;\n'
        )
        path = tmp_csv(csv_content)
        try:
            out = mod.convert_csv_to_json(
                path,
                fps=25,
                cast_metadata=True,
                prefer_local_claim_disclaimer=True,
                claims_as_objects=True,
                no_orientation=True,
                test_mode=False,
            )
        finally:
            os.remove(path)

        self.assertIsInstance(out, dict)
        self.assertTrue(out.get('_multi'))
        node = out['byCountry']['GBL']
        # Casting: ints stay ints
        self.assertIsInstance(node['metadataGlobal'].get('fps'), (int, float))
        # Videos present; claims as objects
        vids = node['videos']
        self.assertTrue(any('claim_01' in v for v in vids))
        # no_orientation top-level arrays exist
        self.assertIsInstance(node.get('claim'), list)
        self.assertIsInstance(node.get('disclaimer'), list)
        self.assertIsInstance(node.get('logo'), list)
        # Prefer local: in video object, the claim_01 text should be LOCAL_CLAIM for the matching timing
        v = next(v for v in vids if v['videoId'].endswith('_landscape'))
        c1 = v.get('claim_01')
        self.assertIsInstance(c1, list)
        self.assertTrue(any('LOCAL_CLAIM' == item.get('text') for item in c1))

    def test_join_claim_and_disclaimer_merge_and_logo_mirror(self):
        # Two claim rows share same timing; disclaimer block with continuation; logo single line
        csv_content = (
            'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL\n'
            'meta_global;;;;;briefVersion;Y;ALL;53;\n'
            'meta_global;;;;;fps;Y;ALL;25;\n'
            # Claims (global) same timing
            'claim;;1;00:00:05:00;00:00:07:00;;;;;C1;\n'
            'claim;;2;00:00:05:00;00:00:07:00;;;;;C1b;\n'
            # Disclaimer timed block + continuation (no times)
            'disclaimer;;1;00:00:15:00;00:00:17:00;;;;;D1;\n'
            'disclaimer;;2;;;;;;;D1b;\n'
            # Logo one line
            'logo;;1;00:00:25:00;00:00:26:00;;;;;L1;\n'
            # One video
            'meta_local;VID_B;;;;title;N;ALL;TitleB;\n'
            'sub;VID_B;1;00:00:00:00;00:00:01:00;;;;;;;;hello;\n'
        )
        path = tmp_csv(csv_content)
        try:
            out = mod.convert_csv_to_json(path, fps=25, join_claim=True)
        finally:
            os.remove(path)

        node = out['byCountry']['GBL']
        # Top-level claim merged (after join) should have one item per timing; the landscape array stores strings
        claims_land = node['claim']['landscape']
        self.assertEqual(len(claims_land), 1)
        self.assertIn('\n', claims_land[0])  # merged with newline
        # Disclaimer merged into a single block where texts contain newline
        discs_land = node['disclaimer']['landscape']
        self.assertTrue(discs_land)
        self.assertIn('\n', discs_land[0])
        # Logo portrait mirrors landscape when portrait empty
        logos_land = node['logo']['landscape']
        logos_port = node['logo']['portrait']
        self.assertEqual(logos_port, logos_land)

    def test_resolve_column_errors(self):
        headers = ['S', 'E']  # missing Text column
        with self.assertRaises(KeyError):
            mod.detect_columns(headers)
        headers2 = ['Start', 'End', 'Text']
        with self.assertRaises(IndexError):
            mod.detect_columns(headers2, start_override='999')
        with self.assertRaises(KeyError):
            mod.detect_columns(headers2, text_override='Nonexistent')

    def test_orientation_mirroring_and_overrides(self):
        # Duplicate GBL columns => second is portrait
        csv_content = (
            'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL;GBL\n'
            'meta_global;;;;;briefVersion;Y;ALL;53;;\n'
            'meta_global;;;;;fps;Y;ALL;25;;\n'
            # Global claims: row1 only landscape; row2 both orientations
            'claim;;1;00:00:01:00;00:00:02:00;;;;;C1_land;\n'
            'claim;;2;00:00:03:00;00:00:04:00;;;;;C2_land;C2_port\n'
            # Logo one line landscape only
            'logo;;1;00:00:05:00;00:00:06:00;;;;;L1;\n'
            # One video with one subtitle; portrait text provided
            'meta_local;VID_OVR;;;;title;N;ALL;T;\n'
            'sub;VID_OVR;1;00:00:00:00;00:00:01:00;;;;;helloL;helloP\n'
        )
        path = tmp_csv(csv_content)
        try:
            out = mod.convert_csv_to_json(path, fps=25)
        finally:
            os.remove(path)

        node = out['byCountry']['GBL']
        # Claim orientation arrays: portrait collects only explicit slots, then extends with remaining landscape entries
        # For row1 (no portrait), nothing added; row2 adds C2_port; then extended with landscape[1] ('C2_land')
        self.assertEqual(node['claim']['landscape'], ['C1_land', 'C2_land'])
        self.assertEqual(node['claim']['portrait'], ['C2_port', 'C2_land'])
        # Logo mirrors to portrait
        self.assertEqual(node['logo']['portrait'], node['logo']['landscape'])
        # Subtitles: portrait video should use portrait text when supplied
        vids = node['videos']
        v_land = next(v for v in vids if v['videoId'].endswith('_landscape'))
        v_port = next(v for v in vids if v['videoId'].endswith('_portrait'))
        self.assertEqual(v_land['subtitles'][0]['text'], 'helloL')
        self.assertEqual(v_port['subtitles'][0]['text'], 'helloP')

    def test_per_video_claim_local_precedence_without_flag(self):
        # Local claim text should override global fallback even when prefer_local flag is False
        csv_content = (
            'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL;DEU\n'
            'meta_global;;;;;briefVersion;Y;ALL;53;;\n'
            'meta_global;;;;;fps;Y;ALL;25;;\n'
            'meta_local;VID_CLAIM;;;;title;N;ALL;Title;;\n'
            'claim;;1;00:00:05:00;00:00:07:00;;;;;GLOBAL_GBL;GLOBAL_DEU\n'
            'claim;VID_CLAIM;;00:00:05:00;00:00:07:00;;;;;LOCAL_GBL;\n'
            'sub;VID_CLAIM;1;00:00:00:00;00:00:01:00;;;;;hiGBL;hiDEU\n'
        )
        path = tmp_csv(csv_content)
        try:
            out = mod.convert_csv_to_json(path, fps=25)
        finally:
            os.remove(path)

        self.assertTrue(out.get('_multi'))
        node_gbl = out['byCountry']['GBL']
        node_deu = out['byCountry']['DEU']
        vid_gbl = next(v for v in node_gbl['videos'] if v['videoId'].endswith('_landscape'))
        vid_deu = next(v for v in node_deu['videos'] if v['videoId'].endswith('_landscape'))
        self.assertEqual(vid_gbl['claim'][0]['text'], 'LOCAL_GBL')
        self.assertEqual(vid_deu['claim'][0]['text'], 'GLOBAL_DEU')

    def test_join_claim_edge_cases_none_timings(self):
        # Multiple global claim rows without timings should join into one entry
        csv_content = (
            'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL\n'
            'meta_global;;;;;briefVersion;Y;ALL;53;\n'
            'meta_global;;;;;fps;Y;ALL;25;\n'
            'claim;;1;;;;;;;A;\n'
            'claim;;2;;;;;;;B;\n'
            # include a video to keep structure consistent
            'meta_local;V;;;;title;N;ALL;T;\n'
            'sub;V;1;00:00:00:00;00:00:01:00;;;;;x;\n'
        )
        path = tmp_csv(csv_content)
        try:
            out = mod.convert_csv_to_json(path, fps=25, join_claim=True)
        finally:
            os.remove(path)

        node = out['byCountry']['GBL']
        claims_land = node['claim']['landscape']
        self.assertEqual(len(claims_land), 1)
        self.assertIn('\n', claims_land[0])

    def test_casting_edge_cases(self):
        # Verify int/float/negative/spaced casting and non-numeric remains string
        csv_content = (
            'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL\n'
            'meta_global;;;;;briefVersion;Y;ALL;53;\n'
            'meta_global;;;;;fps;Y;ALL;25;\n'
            'meta_global;;;;;int1;Y;ALL;03;\n'
            'meta_global;;;;;float1;Y;ALL;3.14;\n'
            'meta_global;;;;;neg;Y;ALL;-7;\n'
            'meta_global;;;;;spaced;Y;ALL; 8 ;\n'
            'meta_global;;;;;floatint;Y;ALL;3.0;\n'
            'meta_global;;;;;name;Y;ALL;v1;\n'
            # one video and sub
            'meta_local;V;;;;title;N;ALL;T;\n'
            'sub;V;1;00:00:00:00;00:00:01:00;;;;;x;\n'
        )
        path = tmp_csv(csv_content)
        try:
            out = mod.convert_csv_to_json(path, fps=25, cast_metadata=True)
        finally:
            os.remove(path)

        mg = out['byCountry']['GBL']['metadataGlobal']
        self.assertIsInstance(mg['int1'], int)
        self.assertEqual(mg['int1'], 3)
        self.assertIsInstance(mg['float1'], float)
        self.assertAlmostEqual(mg['float1'], 3.14, places=2)
        self.assertEqual(mg['neg'], -7)
        self.assertEqual(mg['spaced'], 8)
        self.assertIsInstance(mg['floatint'], float)
        self.assertEqual(mg['floatint'], 3.0)
        self.assertIsInstance(mg['name'], str)

    def test_jobnumber_per_country_precedence(self):
        # Two countries with duplicate columns (portrait present) to verify precedence
        csv_content = (
            'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL;FRA;GBL;FRA\n'
            'meta_global;;;;;briefVersion;Y;ALL;53;;;;\n'
            'meta_global;;;;;fps;Y;ALL;25;;;;\n'
            # jobNumber: metadata fallback provided, plus GBL landscape and FRA portrait; avoid ALL to prevent propagation
            'meta_global;;;;;jobNumber;Y;;FALLBACK;GBL_SPEC;;;FRA_PORT;\n'
            # one video and one subtitle
            'meta_local;VID_J;;;;title;N;ALL;T;;;;\n'
            'sub;VID_J;1;00:00:00:00;00:00:01:00;;;;;;;;x;y\n'
        )
        path = tmp_csv(csv_content)
        try:
            out = mod.convert_csv_to_json(path, fps=25)
        finally:
            os.remove(path)
        gbl = out['byCountry']['GBL']['metadataGlobal']
        fra = out['byCountry']['FRA']['metadataGlobal']
        self.assertEqual(gbl['jobNumber'], 'GBL_SPEC')
        self.assertEqual(fra['jobNumber'], 'FRA_PORT')

    def test_logo_anim_flag_precedence_and_injection(self):
        # Two countries with portrait/landscape/default for duration 45; default only for 60
        csv_content = (
            'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL;FRA;GBL;FRA\n'
            'meta_global;;;;;briefVersion;Y;ALL;53;;;;\n'
            'meta_global;;;;;fps;Y;ALL;25;;;;\n'
            # duration 45: default DEF45, GBL portrait P_GBL (should win), FRA landscape L_FRA
            'meta_global;;;;;logo_anim_flag;Y;45;DEF45;L_GBL;L_FRA;P_GBL;\n'
            # duration 60: default only
            'meta_global;;;;;logo_anim_flag;Y;60;DEF60;;;;\n'
            # videos VID1 (45) and VID2 (60)
            'meta_local;VID1;;;;duration;N;ALL;45;;;;\n'
            'meta_local;VID1;;;;title;N;ALL;T1;;;;\n'
            'sub;VID1;1;00:00:00:00;00:00:01:00;;;;;;;;x;y\n'
            'meta_local;VID2;;;;duration;N;ALL;60;;;;\n'
            'meta_local;VID2;;;;title;N;ALL;T2;;;;\n'
            'sub;VID2;1;00:00:00:00;00:00:01:00;;;;;;;;x;y\n'
        )
        path = tmp_csv(csv_content)
        try:
            out = mod.convert_csv_to_json(path, fps=25)
        finally:
            os.remove(path)
        vids_gbl = [v for v in out['byCountry']['GBL']['videos'] if v['videoId'].startswith('VID1_')]
        vids_fra = [v for v in out['byCountry']['FRA']['videos'] if v['videoId'].startswith('VID1_')]
        for v in vids_gbl:
            self.assertEqual(v['metadata']['logo_anim_flag'], 'P_GBL')
        for v in vids_fra:
            self.assertEqual(v['metadata']['logo_anim_flag'], 'L_FRA')
        # Default-only duration 60 should inject DEF60 for both countries
        vids_gbl_60 = [v for v in out['byCountry']['GBL']['videos'] if v['videoId'].startswith('VID2_')]
        vids_fra_60 = [v for v in out['byCountry']['FRA']['videos'] if v['videoId'].startswith('VID2_')]
        for v in vids_gbl_60 + vids_fra_60:
            self.assertEqual(v['metadata']['logo_anim_flag'], 'DEF60')

    def test_logo_anim_flag_overview_nested_and_trim_on_split(self):
        # Build overview with per-country nesting for duration 45 and verify trimming on split export
        csv_content = (
            'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL;FRA;GBL;FRA\n'
            'meta_global;;;;;briefVersion;Y;ALL;53;;;;\n'
            'meta_global;;;;;fps;Y;ALL;25;;;;\n'
            # duration 45: default=DEF45, GBL portrait=P_OVR, FRA landscape=F_LAND
            'meta_global;;;;;logo_anim_flag;Y;45;DEF45;G_LAND;F_LAND;P_OVR;\n'
            # One video with duration 45 ensures country presence
            'meta_local;VIDO;;;;duration;N;ALL;45;;;;\n'
            'meta_local;VIDO;;;;title;N;ALL;T;;;;\n'
            'sub;VIDO;1;00:00:00:00;00:00:01:00;;;;;;;;x;y\n'
        )
        path = tmp_csv(csv_content)
        try:
            out = mod.convert_csv_to_json(path, fps=25)
        finally:
            os.remove(path)
        # Combined structure contains nested overview
        overview = out['byCountry']['GBL']['metadataGlobal']['logo_anim_flag']
        self.assertIsInstance(overview, dict)
        self.assertIn('45', overview)
        entry = overview['45']
        self.assertIsInstance(entry, dict)
        self.assertIn('_default', entry)
        self.assertIn('GBL', entry)
        self.assertIn('FRA', entry)
        # Now run CLI split to test trimming per country
        csv_path = tmp_csv(csv_content)
        try:
            with tempfile.TemporaryDirectory() as td:
                out_pattern = os.path.join(td, 'out_{country}.json')
                # Call CLI main to trigger trimming
                mod.main([csv_path, out_pattern, '--split-by-country'])
                # Read both outputs
                with open(os.path.join(td, 'out_GBL.json'), 'r', encoding='utf-8') as f:
                    gbl = json.load(f)
                with open(os.path.join(td, 'out_FRA.json'), 'r', encoding='utf-8') as f:
                    fra = json.load(f)
                # After trimming, values are scalars per country
                self.assertIsInstance(gbl['metadataGlobal']['logo_anim_flag']['45'], str)
                self.assertIsInstance(fra['metadataGlobal']['logo_anim_flag']['45'], str)
                # Specific values: GBL picks portrait override P_OVR; FRA picks landscape F_LAND
                self.assertEqual(gbl['metadataGlobal']['logo_anim_flag']['45'], 'P_OVR')
                self.assertEqual(fra['metadataGlobal']['logo_anim_flag']['45'], 'F_LAND')
        finally:
            os.remove(csv_path)

    def test_per_video_claim_join_and_synthetic_second(self):
        # Global two claim strings (different timings) + per-video duplicate-timing rows
        csv_content = (
            'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL\n'
            'meta_global;;;;;briefVersion;Y;ALL;53;\n'
            'meta_global;;;;;fps;Y;ALL;25;\n'
            # global claim texts at two timings
            'claim;;1;00:00:05:00;00:00:07:00;;;;;G1;\n'
            'claim;;2;00:00:08:00;00:00:09:00;;;;;G2;\n'
            # per-video claims at same timing as first global; will be joined
            'meta_local;VJ;;;;title;N;ALL;T;\n'
            'claim;VJ;1;00:00:05:00;00:00:07:00;;;;;X;\n'
            'claim;VJ;2;00:00:05:00;00:00:07:00;;;;;Y;\n'
            'sub;VJ;1;00:00:00:00;00:00:01:00;;;;;s;\n'
        )
        path = tmp_csv(csv_content)
        try:
            out = mod.convert_csv_to_json(path, fps=25, join_claim=True)
        finally:
            os.remove(path)
        v_land = next(v for v in out['byCountry']['GBL']['videos'] if v['videoId'].endswith('_landscape'))
        self.assertIn('claim', v_land)
        self.assertEqual(len(v_land['claim']), 2)
        self.assertEqual(v_land['claim'][0]['text'], 'X\nY')  # joined local rows override global
        self.assertEqual(v_land['claim'][1]['text'], 'G2')  # index fallback still applies

    def test_global_flags_propagation_vs_local_overrides(self):
        # Two countries; meta_global provides defaults; meta_local overrides per-country for one video
        csv_content = (
            'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL;FRA;GBL;FRA\n'
            'meta_global;;;;;briefVersion;Y;ALL;53;;;;\n'
            'meta_global;;;;;fps;Y;ALL;25;;;;\n'
            # Global defaults: subtitle_flag and disclaimer_flag
            'meta_global;;;;;subtitle_flag;Y;;S_DEF;S_GBL;;;\n'
            'meta_global;;;;;disclaimer_flag;Y;;D_DEF;D_GBL;;;\n'
            # Video 1: no overrides
            'meta_local;VID1;;;;title;N;ALL;T1;;;;\n'
            'sub;VID1;1;00:00:00:00;00:00:01:00;;;;;;;;x;y\n'
            # Video 2: FRA overrides; GBL inherits global
            'meta_local;VID2;;;;title;N;ALL;T2;;;;\n'
            # Override both countries explicitly on one row (landscape columns)
            'meta_local;VID2;;;;subtitle_flag;N;ALL;;S_GBL_OVR;S_FRA_OVR;;\n'
            'meta_local;VID2;;;;disclaimer_flag;N;ALL;;D_GBL_OVR;D_FRA_OVR;;\n'
            'sub;VID2;1;00:00:00:00;00:00:01:00;;;;;;;;x;y\n'
        )
        path = tmp_csv(csv_content)
        try:
            out = mod.convert_csv_to_json(path, fps=25)
        finally:
            os.remove(path)
        # VID1 expectations: GBL from S_GBL/D_GBL, FRA from defaults S_DEF/D_DEF
        node = out['byCountry']
        v1_gbl = [v for v in node['GBL']['videos'] if v['videoId'].startswith('VID1_')]
        v1_fra = [v for v in node['FRA']['videos'] if v['videoId'].startswith('VID1_')]
        for v in v1_gbl:
            self.assertEqual(v['metadata']['subtitle_flag'], 'S_GBL')
            self.assertEqual(v['metadata']['disclaimer_flag'], 'D_GBL')
        for v in v1_fra:
            self.assertEqual(v['metadata']['subtitle_flag'], 'S_DEF')
            self.assertEqual(v['metadata']['disclaimer_flag'], 'D_DEF')
        # VID2 expectations: both countries pick their explicit overrides
        v2_gbl = [v for v in node['GBL']['videos'] if v['videoId'].startswith('VID2_')]
        v2_fra = [v for v in node['FRA']['videos'] if v['videoId'].startswith('VID2_')]
        for v in v2_gbl:
            self.assertEqual(v['metadata']['subtitle_flag'], 'S_GBL_OVR')
            self.assertEqual(v['metadata']['disclaimer_flag'], 'D_GBL_OVR')
        for v in v2_fra:
            self.assertEqual(v['metadata']['subtitle_flag'], 'S_FRA_OVR')
            self.assertEqual(v['metadata']['disclaimer_flag'], 'D_FRA_OVR')

    def test_per_video_logo_anim_flag_overrides_supersede_overview(self):
        # Build overview (duration 45) and per-video per-country overrides; ensure overrides win
        csv_content = (
            'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL;FRA;GBL;FRA\n'
            'meta_global;;;;;briefVersion;Y;ALL;53;;;;\n'
            'meta_global;;;;;fps;Y;ALL;25;;;;\n'
            # Overview for duration 45: default DEF45, GBL landscape L_GBL, FRA landscape L_FRA
            'meta_global;;;;;logo_anim_flag;Y;45;DEF45;L_GBL;L_FRA;;\n'
            # Video A duration 45 with per-country overrides in meta_local
            'meta_local;VIDA;;;;duration;N;ALL;45;;;;\n'
            'meta_local;VIDA;;;;title;N;ALL;TA;;;;\n'
            'meta_local;VIDA;;;;logo_anim_flag;N;ALL;;OVR_GBL;OVR_FRA;;\n'
            'sub;VIDA;1;00:00:00:00;00:00:01:00;;;;;;;;x;y\n'
            # Video B duration 45 without overrides → should use overview per-country values
            'meta_local;VIDB;;;;duration;N;ALL;45;;;;\n'
            'meta_local;VIDB;;;;title;N;ALL;TB;;;;\n'
            'sub;VIDB;1;00:00:00:00;00:00:01:00;;;;;;;;x;y\n'
        )
        path = tmp_csv(csv_content)
        try:
            out = mod.convert_csv_to_json(path, fps=25)
        finally:
            os.remove(path)
        node = out['byCountry']
        # VIDA per-country overrides win
        for v in [vv for vv in node['GBL']['videos'] if vv['videoId'].startswith('VIDA_')]:
            self.assertEqual(v['metadata']['logo_anim_flag'], 'OVR_GBL')
        for v in [vv for vv in node['FRA']['videos'] if vv['videoId'].startswith('VIDA_')]:
            self.assertEqual(v['metadata']['logo_anim_flag'], 'OVR_FRA')
        # VIDB uses overview mapping (no portrait set, so landscape values L_GBL/L_FRA)
        for v in [vv for vv in node['GBL']['videos'] if vv['videoId'].startswith('VIDB_')]:
            self.assertEqual(v['metadata']['logo_anim_flag'], 'L_GBL')
        for v in [vv for vv in node['FRA']['videos'] if vv['videoId'].startswith('VIDB_')]:
            self.assertEqual(v['metadata']['logo_anim_flag'], 'L_FRA')


if __name__ == '__main__':
    unittest.main(verbosity=2)
