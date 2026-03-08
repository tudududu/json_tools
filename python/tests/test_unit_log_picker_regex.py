import tempfile
import unittest
from pathlib import Path

from python.tools import log_picker


class LogPickerRegexTests(unittest.TestCase):
    def test_log_picker_regex_and_header(self):
        with tempfile.TemporaryDirectory() as td:
            tmp_path = Path(td)
            logs = tmp_path / "logs"
            logs.mkdir()
            (logs / "x.log").write_text("HELLO one\nnope\nbye\n", encoding="utf-8")
            (logs / "y.log").write_text(
                "greeting: HELLO two\nTiming (s) => 0.1\n", encoding="utf-8"
            )

            out = tmp_path / "out.log"

            rc = log_picker.main(
                [
                    "--input-dir",
                    str(logs),
                    "--output-file",
                    str(out),
                    "--regex",
                    r"^HELLO",
                    "--regex",
                    r"greeting: HELLO",
                ]
            )
            self.assertEqual(rc, 0)

            txt = out.read_text(encoding="utf-8")
            # Header
            self.assertIn("==== Log Picker Summary ====", txt)
            self.assertIn("Input Directory:", txt)
            self.assertIn("Timestamp:", txt)

            # Regex hits
            self.assertIn("HELLO one", txt)
            self.assertIn("greeting: HELLO two", txt)

            # Summary Counts now shows only total pipeline_run logs (none in this test)
            self.assertIn("==== Summary Counts ====", txt)
            self.assertIn("TOTAL_PIPELINE_RUN_LOGS: 0", txt)
