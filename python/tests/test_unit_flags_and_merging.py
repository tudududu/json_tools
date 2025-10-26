import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
PYTHON_DIR = os.path.abspath(os.path.join(HERE, '..'))
if PYTHON_DIR not in sys.path:
    sys.path.insert(0, PYTHON_DIR)

import csv_to_subtitles_json as mod


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


if __name__ == '__main__':
    unittest.main(verbosity=2)
