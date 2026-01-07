import os
import sys
import json
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
PYTHON_DIR = os.path.abspath(os.path.join(HERE, '..'))
if PYTHON_DIR not in sys.path:
    sys.path.insert(0, PYTHON_DIR)

import csv_to_json as mod


def tmp_file(suffix='.csv'):
    f = tempfile.NamedTemporaryFile('w+', delete=False, suffix=suffix)
    f.close()
    return f.name


class MediaIntegrationTests(unittest.TestCase):
    def test_media_injected_for_exact_country_language(self):
        # Unified CSV with two countries; language meta_global empty
        csv_content = (
            'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL;FRA;GBL;FRA\n'
            'meta_global;;;;;briefVersion;Y;ALL;6;;;;\n'
            'meta_global;;;;;fps;Y;ALL;25;;;;\n'
            'meta_global;;;;;language;Y;ALL;;;;;\n'
            'meta_local;V;;;;title;N;ALL;T;;;;\n'
            'sub;V;1;00:00:00:00;00:00:01:00;;;;;;;;x;y\n'
        )
        media_csv = (
            'AspectRatio;Dimensions;Creative;Media;Template;Template_name;Country;Language\n'
            '1x1;640x640;06sC1;TikTok;regular;;GBL;\n'
            '9x16;720x1280;15sC1;Meta InFeed;extra;tiktok;GBL;\n'
        )
        in_path = tmp_file('.csv')
        with open(in_path, 'w', encoding='utf-8') as f:
            f.write(csv_content)
        media_path = tmp_file('.csv')
        with open(media_path, 'w', encoding='utf-8') as f:
            f.write(media_csv)
        try:
            with tempfile.TemporaryDirectory() as td:
                pattern = os.path.join(td, 'out-{country}.json')
                rc = mod.main([in_path, pattern, '--split-by-country', '--media-csv', media_path])
                self.assertEqual(rc, 0)
                gbl_path = os.path.join(td, 'out-GBL.json')
                fra_path = os.path.join(td, 'out-FRA.json')
                self.assertTrue(os.path.isfile(gbl_path))
                self.assertTrue(os.path.isfile(fra_path))
                gbl = json.load(open(gbl_path, 'r', encoding='utf-8'))
                fra = json.load(open(fra_path, 'r', encoding='utf-8'))
                self.assertIn('media', gbl)
                self.assertNotIn('media', fra)
                # Basic sanity of media content
                self.assertIn('1x1|06s', gbl['media'])
        finally:
            try: os.remove(in_path)
            except Exception: pass
            try: os.remove(media_path)
            except Exception: pass


if __name__ == '__main__':
    unittest.main(verbosity=2)
