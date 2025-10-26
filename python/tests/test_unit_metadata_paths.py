import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
PYTHON_DIR = os.path.abspath(os.path.join(HERE, '..'))
if PYTHON_DIR not in sys.path:
    sys.path.insert(0, PYTHON_DIR)

import csv_to_subtitles_json as mod


def write_tmp_csv(content: str) -> str:
    f = tempfile.NamedTemporaryFile('w+', delete=False, suffix='.csv')
    f.write(content)
    f.flush()
    f.close()
    return f.name


class MetadataGlobalLocalTests(unittest.TestCase):
    def test_logo_overview_nested_and_per_video_injection_and_local_override(self):
        csv_content = (
            'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL;GBL;DEU;DEU\n'
            # Required globals
            'meta_global;;;;;briefVersion;Y;ALL;53;;;;\n'
            'meta_global;;;;;fps;Y;ALL;25;;;;\n'
            # Global per-country flag default: GBL=Y, DEU empty (will be overridden per-video)
            'meta_global;;;;;disclaimer_flag;Y;ALL;;Y;;;\n'
            # Multi-row logo overview: duration=60, default N, DEU=Y -> nested
            'meta_global;;;;;logo_anim_flag;;60;N;;;Y;\n'
            # Video metadata and per-video override
            'meta_local;VID_60s;;;;duration;N;ALL;60;;;;\n'
            'meta_local;VID_60s;;;;title;N;ALL;TITLE;;;;\n'
            # Per-video: DEU sets disclaimer_flag=N; GBL empty
            'meta_local;VID_60s;;;;disclaimer_flag;N;ALL;;;N;\n'
            # One subtitle line (required to materialize video entries)
            'sub;VID_60s;1;00:00:01:00;00:00:02:00;;;;;Hello;;Hallo;;\n'
        )
        path = write_tmp_csv(csv_content)
        try:
            out = mod.convert_csv_to_json(path, fps=25)
        finally:
            os.remove(path)

        self.assertIsInstance(out, dict)
        self.assertTrue(out.get('_multi'), 'Expected multi-country output')
        byc = out['byCountry']
        self.assertIn('DEU', byc)
        self.assertIn('GBL', byc)

        # 1) Global overview nested for duration 60
        mg_deu = byc['DEU']['metadataGlobal']
        overview = mg_deu.get('logo_anim_flag', {})
        self.assertIn('60', overview)
        self.assertIsInstance(overview['60'], dict)
        self.assertEqual(overview['60'].get('_default'), 'N')
        self.assertEqual(overview['60'].get('DEU'), 'Y')

        # 2) Per-video metadata injection of logo_anim_flag respects per-country override
        vids_deu = byc['DEU']['videos']
        vland_deu = next(v for v in vids_deu if v['metadata'].get('orientation') == 'landscape')
        self.assertIn(vland_deu['metadata'].get('duration'), (60, '60'))
        self.assertEqual(vland_deu['metadata'].get('logo_anim_flag'), 'Y', 'DEU per-video should get Y from mapping override')

        vids_gbl = byc['GBL']['videos']
        vland_gbl = next(v for v in vids_gbl if v['metadata'].get('orientation') == 'landscape')
        self.assertIn(vland_gbl['metadata'].get('duration'), (60, '60'))
        self.assertEqual(vland_gbl['metadata'].get('logo_anim_flag'), 'N', 'GBL per-video should get default N from mapping')
        # 3) Per-video meta_local overrides for DEU are applied
        self.assertEqual(vland_deu['metadata'].get('disclaimer_flag'), 'N', 'DEU per-video override should apply')


if __name__ == '__main__':
    unittest.main(verbosity=2)
