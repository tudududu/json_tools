import os, sys, tempfile, unittest, pathlib

# Ensure repository root is on sys.path; package markers allow python.* imports
_HERE = os.path.dirname(os.path.abspath(__file__))
_REPOROOT = os.path.abspath(os.path.join(_HERE, '..', '..'))
if _REPOROOT not in sys.path:
    sys.path.insert(0, _REPOROOT)

from python.tools import log_picker


class LogPickerLayersSummaryTests(unittest.TestCase):
    def test_layers_short_summary(self):
        with tempfile.TemporaryDirectory() as td:
            tmp_path = pathlib.Path(td)
            d = tmp_path / 'logs'
            d.mkdir()
            (d / 'a.log').write_text(
                'Counts => created=1, layersAddedTotal=10\nTiming (s) => addLayers=2.5, total=3.0\n', encoding='utf-8'
            )
            (d / 'b.log').write_text(
                'RunId=XYZ\nTiming (s) => addLayers=7.5, total=8.0\n', encoding='utf-8'
            )
            (d / 'c.log').write_text(
                'Counts => created=2, something=else\n', encoding='utf-8'
            )
            out = tmp_path / 'out.log'
            rc = log_picker.main(['--input-dir', str(d), '--output-file', str(out)])
            self.assertEqual(rc, 0)
            txt = out.read_text(encoding='utf-8')
            self.assertIn('==== Short Summary ====', txt)
            # a.log should have both values
            self.assertIn('a.log: Counts => layersAddedTotal=10 ; Timing (s) => addLayers=2.5', txt)
            # b.log missing Counts value, has Timing value
            self.assertIn('b.log: Counts => layersAddedTotal=- ; Timing (s) => addLayers=7.5', txt)
            # c.log missing both specific keys -> dashes
            self.assertIn('c.log: Counts => layersAddedTotal=- ; Timing (s) => addLayers=-', txt)
