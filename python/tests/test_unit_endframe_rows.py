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


class EndFrameParsingTests(unittest.TestCase):
    def test_endframe_parsed_like_logo(self):
        # Minimal unified with per-video logo and endFrame rows; only GBL country
        csv_content = (
            'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL;FRA;GBL;FRA\n'
            'meta_global;;;;;briefVersion;Y;ALL;1;;;;\n'
            'meta_global;;;;;fps;Y;ALL;25;;;;\n'
            'logo;V;1;00:00:30:00;00:00:32:00;;;;;;;;Logo GBL;\n'
            'endFrame;V;1;00:00:30:01;00:00:32:01;;;;;;;;\n'
            'sub;V;1;00:00:00:00;00:00:01:00;;;;;;;;Hello;\n'
        )
        # Write temp CSV
        f = tempfile.NamedTemporaryFile('w+', delete=False, suffix='.csv')
        try:
            f.write(csv_content)
            f.flush()
            f.close()
            with tempfile.TemporaryDirectory() as td:
                out_path = os.path.join(td, 'out.json')
                rc = mod.main([f.name, out_path, '--country-column', '1'])
                self.assertEqual(rc, 0)
                with open(out_path, 'r', encoding='utf-8') as h:
                    data = json.load(h)
                videos = data['videos']
                # Expect two videos (landscape + portrait)
                self.assertEqual(len(videos), 2)
                v_land = next(v for v in videos if v['metadata'].get('orientation') == 'landscape')
                v_port = next(v for v in videos if v['metadata'].get('orientation') == 'portrait')
                # Logo present with timing
                self.assertEqual(len(v_land['logo']), 1)
                self.assertIn('in', v_land['logo'][0])
                self.assertIn('out', v_land['logo'][0])
                # endFrame present with timing and same shape as logo
                self.assertEqual(len(v_land['endFrame']), 1)
                self.assertIn('in', v_land['endFrame'][0])
                self.assertIn('out', v_land['endFrame'][0])
                # Portrait mirrors text fallback behavior
                self.assertEqual(len(v_port['endFrame']), 1)
        finally:
            try:
                os.remove(f.name)
            except Exception:
                pass


if __name__ == '__main__':
    unittest.main(verbosity=2)
