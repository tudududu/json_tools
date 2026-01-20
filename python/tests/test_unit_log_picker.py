import pathlib
import shutil
import os, sys, tempfile, unittest

# Ensure repository root is on sys.path; with package markers, `python.*` imports work
_HERE = os.path.dirname(os.path.abspath(__file__))
_REPOROOT = os.path.abspath(os.path.join(_HERE, '..', '..'))
for _p in (_REPOROOT,):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from python.tools import log_picker


class LogPickerTests(unittest.TestCase):
    def test_log_picker_custom_prefix_and_counts(self):
        with tempfile.TemporaryDirectory() as td:
            tmp_path = pathlib.Path(td)
            # Arrange: create temp log directory with sample logs
            log_dir = tmp_path / "logs"
            log_dir.mkdir()
            (log_dir / "one.log").write_text(
                "RunId=AAA\nUnrelated line\nMYCUSTOM value here\n", encoding="utf-8"
            )
            (log_dir / "two.log").write_text(
                "Pipeline complete.\nTiming (s) => total=1.23\nOther line\n", encoding="utf-8"
            )
            (log_dir / "empty.log").write_text(
                "Nothing to see here\n", encoding="utf-8"
            )

            # Output inside tmp_path to avoid polluting repo log directory
            out_file = tmp_path / "summary.log"

            # Act: run main with custom prefix
            rc = log_picker.main([
                "--input-dir", str(log_dir),
                "--output-file", str(out_file),
                "--prefix", "MYCUSTOM",
            ])

            self.assertEqual(rc, 0, "Script should exit with success")
            self.assertTrue(out_file.is_file(), "Output file should be created")
            content = out_file.read_text(encoding="utf-8")

            # Assert: custom prefix line is present
            self.assertIn("MYCUSTOM value here", content)
            # Counts summary section present with only pipeline_run total
            self.assertIn("==== Summary Counts ====", content)
            self.assertIn("TOTAL_PIPELINE_RUN_LOGS: 0", content)
