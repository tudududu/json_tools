import os, sys, tempfile, unittest, pathlib

# Ensure repository root is on sys.path; package markers allow python.* imports
_HERE = os.path.dirname(os.path.abspath(__file__))
_REPOROOT = os.path.abspath(os.path.join(_HERE, '..', '..'))
if _REPOROOT not in sys.path:
    sys.path.insert(0, _REPOROOT)

from python.tools import log_picker


class LogPickerEdgeCaseTests(unittest.TestCase):
    def test_invalid_directory(self):
        # Non-existing directory should return exit code 2
        bogus = "/nonexistent/path/for/log_picker_tests"
        with tempfile.TemporaryDirectory() as td:
            out = pathlib.Path(td) / "dummy.log"
            rc = log_picker.main(["--input-dir", bogus, "--output-file", str(out)])
            self.assertEqual(rc, 2)

    def test_invalid_regex(self):
        # Invalid regex pattern should return exit code 3
        with tempfile.TemporaryDirectory() as td:
            d = pathlib.Path(td) / "logs"
            d.mkdir()
            (d / "a.log").write_text("Pipeline complete.\n", encoding="utf-8")
            out = pathlib.Path(td) / "out.log"
            rc = log_picker.main(["--input-dir", str(d), "--output-file", str(out), "--regex", "("])
            self.assertEqual(rc, 3)

    def test_no_log_files(self):
        # Empty directory: prints a warning but still returns success (0)
        with tempfile.TemporaryDirectory() as td:
            d = pathlib.Path(td) / "empty"
            d.mkdir()
            out = pathlib.Path(td) / "out.log"
            rc = log_picker.main(["--input-dir", str(d), "--output-file", str(out)])
            self.assertEqual(rc, 0)
            # Output file should still be created (empty summary header + counts)
            self.assertTrue(out.is_file())
