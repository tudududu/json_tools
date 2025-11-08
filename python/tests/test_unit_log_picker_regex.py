import os, sys, tempfile, unittest
from pathlib import Path

# Ensure repository root is on sys.path; package markers allow python.* imports
_HERE = os.path.dirname(os.path.abspath(__file__))
_REPOROOT = os.path.abspath(os.path.join(_HERE, '..', '..'))
if _REPOROOT not in sys.path:
    sys.path.insert(0, _REPOROOT)

from python.aux import log_picker


class LogPickerRegexTests(unittest.TestCase):
    def test_log_picker_regex_and_header(self):
        with tempfile.TemporaryDirectory() as td:
            tmp_path = Path(td)
            logs = tmp_path / "logs"
            logs.mkdir()
            (logs / "x.log").write_text("HELLO one\nnope\nbye\n", encoding="utf-8")
            (logs / "y.log").write_text("greeting: HELLO two\nTiming (s) => 0.1\n", encoding="utf-8")

            out = tmp_path / "out.log"

            rc = log_picker.main([
                "--input-dir", str(logs),
                "--output-file", str(out),
                "--regex", r"^HELLO",
                "--regex", r"greeting: HELLO",
            ])
            self.assertEqual(rc, 0)

            txt = out.read_text(encoding="utf-8")
            # Header
            self.assertIn("==== Log Picker Summary ====", txt)
            self.assertIn("Input Directory:", txt)
            self.assertIn("Timestamp:", txt)

            # Regex hits
            self.assertIn("HELLO one", txt)
            self.assertIn("greeting: HELLO two", txt)

            # Counts
            self.assertIn("x.log: 1", txt)
            self.assertIn("y.log: 2", txt)
            self.assertIn("TOTAL_MATCHED_LINES: 3", txt)
