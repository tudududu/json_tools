import pathlib
import shutil
import os, sys, tempfile, unittest

# Ensure repository root and python/ directory are on sys.path for direct module imports
_HERE = os.path.dirname(os.path.abspath(__file__))
_PYDIR = os.path.abspath(os.path.join(_HERE, '..', '..'))
_REPOROOT = os.path.abspath(os.path.join(_PYDIR, '..'))
for _p in (_REPOROOT, _PYDIR):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from aux import log_picker


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
            # Counts summary section present
            self.assertIn("==== Summary Counts ====", content)
            # Per-file counts
            self.assertIn("one.log: 2", content)
            self.assertIn("two.log: 2", content)
            self.assertIn("empty.log: 0", content)
            # Total should equal 4
            self.assertIn("TOTAL_MATCHED_LINES: 4", content)
