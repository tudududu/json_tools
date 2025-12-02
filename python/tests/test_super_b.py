import unittest
import tempfile
import os
import csv_to_json as mod


class SuperBTests(unittest.TestCase):
    """Tests for parsing, merge, dedup, portrait mirroring, and empty emission of super_B."""

    def test_basic_parsing_and_portrait_mirroring(self):
        csv_content = (
            'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL;GBL_portrait\n'
            'meta_global;;;;;briefVersion;Y;ALL;1;;\n'
            'meta_global;;;;;fps;Y;ALL;25;;\n'
            # Two super_b rows
            'super_b;VID_A;1;00:00:00:00;00:00:01:00;;;;;LINE ONE;\n'
            'super_b;VID_A;2;00:00:01:00;00:00:02:00;;;;;LINE TWO;\n'
        )
        with tempfile.NamedTemporaryFile('w+', delete=False, suffix='.csv', encoding='utf-8') as f:
            f.write(csv_content)
            path = f.name
        try:
            out = mod.convert_csv_to_json(path, fps=25)
            gbl = out['byCountry']['GBL']
            land = next(v for v in gbl['videos'] if v['videoId'].endswith('_landscape'))
            port = next(v for v in gbl['videos'] if v['videoId'].endswith('_portrait'))
            self.assertIn('super_B', land)
            self.assertEqual(len(land['super_B']), 2)
            self.assertEqual(land['super_B'][0]['text'], 'LINE ONE')
            # Portrait mirrors landscape for both lines
            self.assertEqual(port['super_B'][0]['text'], 'LINE ONE')
            self.assertEqual(port['super_B'][1]['text'], 'LINE TWO')
        finally:
            os.remove(path)

    def test_merge_and_dedup(self):
        csv_content = (
            'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL\n'
            'meta_global;;;;;briefVersion;Y;ALL;1;\n'
            'meta_global;;;;;fps;Y;ALL;25;\n'
            # Original
            'super_b;VID_X;1;00:00:10:00;00:00:11:00;;;;;EVENT ONE;\n'
            # Intervening distinct line
            'super_b;VID_X;2;00:00:11:00;00:00:12:00;;;;;MID;\n'
            # Non-contiguous identical duplicate of line 1 (should not concatenate)
            'super_b;VID_X;1;00:00:10:00;00:00:11:00;;;;;EVENT ONE;\n'
            # Distinct duplicates line 3
            'super_b;VID_X;3;00:00:12:00;00:00:13:00;;;;;EVENT TWO;\n'
            'super_b;VID_X;3;00:00:12:00;00:00:13:00;;;;;EVENT TWO (dup);\n'
        )
        with tempfile.NamedTemporaryFile('w+', delete=False, suffix='.csv', encoding='utf-8') as f:
            f.write(csv_content)
            path = f.name
        try:
            out = mod.convert_csv_to_json(path, fps=25)
            gbl = out['byCountry']['GBL']
            land = next(v for v in gbl['videos'] if v['videoId'].endswith('_landscape'))
            items = land['super_B']
            self.assertEqual(len(items), 3)
            self.assertEqual(items[0]['text'], 'EVENT ONE')
            self.assertEqual(items[1]['text'], 'MID')
            self.assertEqual(items[2]['text'], 'EVENT TWO\nEVENT TWO (dup)')
        finally:
            os.remove(path)

    def test_flag_precedence_and_empty(self):
        csv_content = (
            'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL\n'
            'meta_global;;;;;briefVersion;Y;ALL;1;\n'
            'meta_global;;;;;fps;Y;ALL;25;\n'
            'meta_global;;;;;super_B_flag;Y;GBL;G;\n'
            'meta_local;VID_Z;;;;super_B_flag;N;GBL;L;\n'
            # No super_b rows -> expect empty array
        )
        with tempfile.NamedTemporaryFile('w+', delete=False, suffix='.csv', encoding='utf-8') as f:
            f.write(csv_content)
            path = f.name
        try:
            out = mod.convert_csv_to_json(path, fps=25)
            gbl = out['byCountry']['GBL']
            land = next(v for v in gbl['videos'] if v['videoId'].endswith('_landscape'))
            self.assertEqual(land['super_B'], [])
            self.assertIn('super_B_flag', land['metadata'])
            # meta_local overrides global
            self.assertEqual(land['metadata']['super_B_flag'], 'L')
        finally:
            os.remove(path)

if __name__ == '__main__':
    unittest.main(verbosity=2)
