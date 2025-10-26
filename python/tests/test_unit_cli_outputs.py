import os
import sys
import json
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


class CliOutputTests(unittest.TestCase):
    def test_auto_output_split_names(self):
        # Two countries minimal unified CSV
        csv_content = (
            'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL;FRA;GBL;FRA\n'
            'meta_global;;;;;briefVersion;Y;ALL;53;;;;\n'
            'meta_global;;;;;fps;Y;ALL;25;;;;\n'
            'meta_local;V;;;;title;N;ALL;T;;;;\n'
            'sub;V;1;00:00:00:00;00:00:01:00;;;;;;;;x;y\n'
        )
        path = tmp_csv(csv_content)
        try:
            with tempfile.TemporaryDirectory() as td:
                # Note: with --auto-output, outputs are written next to the INPUT file,
                # not to the provided output path. We still must provide a dummy second arg.
                dummy_out = os.path.join(td, 'ignored.json')
                rc = mod.main([path, dummy_out, '--split-by-country', '--auto-output'])
                self.assertEqual(rc, 0)
                in_dir = os.path.dirname(path)
                in_base = os.path.splitext(os.path.basename(path))[0]
                gbl_path = os.path.join(in_dir, f'{in_base}_GBL.json')
                fra_path = os.path.join(in_dir, f'{in_base}_FRA.json')
                self.assertTrue(os.path.isfile(gbl_path))
                self.assertTrue(os.path.isfile(fra_path))
                with open(gbl_path, 'r', encoding='utf-8') as f:
                    gbl = json.load(f)
                with open(fra_path, 'r', encoding='utf-8') as f:
                    fra = json.load(f)
                self.assertEqual(gbl['metadataGlobal']['country'], 'GBL')
                self.assertEqual(fra['metadataGlobal']['country'], 'FRA')
        finally:
            # Clean up input and auto-generated outputs
            try:
                os.remove(path)
            except Exception:
                pass
            try:
                in_dir = os.path.dirname(path)
                in_base = os.path.splitext(os.path.basename(path))[0]
                os.remove(os.path.join(in_dir, f'{in_base}_GBL.json'))
                os.remove(os.path.join(in_dir, f'{in_base}_FRA.json'))
            except Exception:
                pass

    def test_output_pattern_custom(self):
        csv_content = (
            'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL;FRA;GBL;FRA\n'
            'meta_global;;;;;briefVersion;Y;ALL;53;;;;\n'
            'meta_global;;;;;fps;Y;ALL;25;;;;\n'
            'meta_local;V2;;;;title;N;ALL;T2;;;;\n'
            'sub;V2;1;00:00:00:00;00:00:01:00;;;;;;;;x;y\n'
        )
        path = tmp_csv(csv_content)
        try:
            with tempfile.TemporaryDirectory() as td:
                pattern = os.path.join(td, 'nested', 'out-{country}.json')
                rc = mod.main([path, pattern, '--split-by-country'])
                self.assertEqual(rc, 0)
                gbl_path = os.path.join(td, 'nested', 'out-GBL.json')
                fra_path = os.path.join(td, 'nested', 'out-FRA.json')
                self.assertTrue(os.path.isfile(gbl_path))
                self.assertTrue(os.path.isfile(fra_path))
                with open(gbl_path, 'r', encoding='utf-8') as f:
                    gbl = json.load(f)
                with open(fra_path, 'r', encoding='utf-8') as f:
                    fra = json.load(f)
                self.assertEqual(gbl['metadataGlobal']['country'], 'GBL')
                self.assertEqual(fra['metadataGlobal']['country'], 'FRA')
        finally:
            os.remove(path)


if __name__ == '__main__':
    unittest.main(verbosity=2)
