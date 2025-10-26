import os
import sys
import tempfile
import unittest
import json

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


class ValidationAndOverlapTests(unittest.TestCase):
    def test_validate_only_passes_on_sectioned_ok(self):
        # Sectioned CSV with subtitles and disclaimers, non-overlapping
        csv_content = (
            'subtitles;line;start;end;text\n'
            ';1;00:00:00:00;00:00:02:00;A\n'
            ';2;00:00:03:00;00:00:04:00;B\n'
            'disclaimer;;;;\n'
            ';1;00:00:10:00;00:00:12:00;D1\n'
            ';2;00:00:13:00;00:00:14:00;D2\n'
        )
        path = tmp_csv(csv_content)
        try:
            # Validation requires an output argument but won't write
            rc = mod.main([path, os.path.join(os.path.dirname(path), 'unused.json'), '--validate-only'])
        finally:
            os.remove(path)
        self.assertEqual(rc, 0)

    def test_validate_only_fails_on_overlaps(self):
        # Overlapping subtitles and disclaimers: second starts before previous ends
        csv_content = (
            'subtitles;line;start;end;text\n'
            ';1;00:00:00:00;00:00:02:00;A\n'
            ';2;00:00:01:20;00:00:03:00;B\n'  # starts before prev end
            'disclaimer;;;;\n'
            ';1;00:00:10:00;00:00:12:00;D1\n'
            ';2;00:00:11:00;00:00:13:00;D2\n'  # overlaps previous disclaimer
        )
        path = tmp_csv(csv_content)
        try:
            rc = mod.main([path, os.path.join(os.path.dirname(path), 'unused.json'), '--validate-only'])
        finally:
            os.remove(path)
        self.assertEqual(rc, 1)

    def test_unified_validation_report_missing_keys_warn(self):
        # Unified schema with missing extra required key; should warn (not error) and write report
        csv_content = (
            'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL\n'
            'meta_global;;;;;briefVersion;Y;ALL;53;\n'
            'meta_global;;;;;fps;Y;ALL;25;\n'
            'meta_local;V;;;;title;N;ALL;Title;\n'
            'sub;V;1;00:00:00:00;00:00:01:00;;;;;Hello;\n'
        )
        path = tmp_csv(csv_content)
        try:
            with tempfile.TemporaryDirectory() as td:
                out_json = os.path.join(td, 'unused.json')
                report_path = os.path.join(td, 'report.json')
                rc = mod.main([
                    path,
                    out_json,
                    '--validate-only',
                    '--missing-keys-warn',
                    '--required-global-keys', 'briefVersion,fps,extraReq',
                    '--validation-report', report_path,
                ])
                self.assertEqual(rc, 0)
                with open(report_path, 'r', encoding='utf-8') as f:
                    rep = json.load(f)
                self.assertIn('countries', rep)
                self.assertIn('summary', rep)
                # Ensure warnings mention the missing key
                countries_rep = rep.get('countries', [])
                self.assertTrue(any('extraReq' in ' '.join(c.get('warnings', [])) for c in countries_rep))
        finally:
            os.remove(path)

    def test_unified_per_video_subtitle_overlap_fails(self):
        # Unified schema: per-video subtitles with overlapping times should trigger validation error
        csv_content = (
            'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL\n'
            'meta_global;;;;;briefVersion;Y;ALL;53;\n'
            'meta_global;;;;;fps;Y;ALL;25;\n'
            'meta_local;VID;;;;title;N;ALL;T;\n'
            'sub;VID;1;00:00:00:00;00:00:02:00;;;;;A;\n'
            'sub;VID;2;00:00:01:00;00:00:03:00;;;;;B;\n'
        )
        path = tmp_csv(csv_content)
        try:
            rc = mod.main([path, os.path.join(os.path.dirname(path), 'unused.json'), '--validate-only'])
            self.assertEqual(rc, 1)
        finally:
            os.remove(path)

    def test_no_orientation_validation_path(self):
        # Unified schema; validate-only with --no-orientation exercises alternate validator branch
        csv_content = (
            'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL\n'
            'meta_global;;;;;briefVersion;Y;ALL;53;\n'
            'meta_global;;;;;fps;Y;ALL;25;\n'
            'meta_local;VNO;;;;title;N;ALL;Title;\n'
            'sub;VNO;1;00:00:00:00;00:00:01:00;;;;;Hello;\n'
        )
        path = tmp_csv(csv_content)
        try:
            # CLI validation path
            rc = mod.main([path, os.path.join(os.path.dirname(path), 'unused.json'), '--validate-only', '--no-orientation'])
            self.assertEqual(rc, 0)
            # Convert shape check
            data = mod.convert_csv_to_json(path, fps=25, no_orientation=True)
            self.assertTrue(data.get('_multi'))
            node = data['byCountry']['GBL']
            self.assertIsInstance(node.get('claim'), list)
            self.assertIsInstance(node.get('disclaimer'), list)
            self.assertIsInstance(node.get('logo'), list)
        finally:
            os.remove(path)


if __name__ == '__main__':
    unittest.main(verbosity=2)
