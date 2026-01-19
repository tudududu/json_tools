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

    def test_recursive_directory_traversal(self):
        # --recursive should include nested .log files
        with tempfile.TemporaryDirectory() as td:
            base = pathlib.Path(td) / "logs"
            nested = base / "sub" / "deeper"
            nested.mkdir(parents=True)

            (base / "a.log").write_text("Pipeline complete.\nnope\n", encoding="utf-8")  # no match after prefix change
            (nested / "b.log").write_text("RunId=XYZ\nPipeline complete.\n", encoding="utf-8")  # 1 match after prefix change

            out = pathlib.Path(td) / "out_recursive.log"
            rc = log_picker.main([
                "--input-dir", str(base),
                "--output-file", str(out),
                "--recursive",
            ])
            self.assertEqual(rc, 0)
            txt = out.read_text(encoding="utf-8")
            # Both files should be present
            self.assertIn("a.log:", txt)
            self.assertIn("b.log:", txt)
            # Counts should reflect matches after prefix change
            self.assertIn("a.log: 0", txt)
            self.assertIn("b.log: 1", txt)
            self.assertIn("TOTAL_MATCHED_LINES: 1", txt)

    def test_non_utf8_encoding(self):
        # Latin-1 file should be read correctly when --encoding latin-1 is specified
        with tempfile.TemporaryDirectory() as td:
            d = pathlib.Path(td) / "logs"
            d.mkdir()
            # Contains non-ASCII characters representable in latin-1
            line = "RunId=Ångström"  # Å and ö present
            (d / "enc.log").write_bytes(line.encode("latin-1") + b"\n")

            out = pathlib.Path(td) / "out_enc.log"
            rc = log_picker.main([
                "--input-dir", str(d),
                "--output-file", str(out),
                "--encoding", "latin-1",
            ])
            self.assertEqual(rc, 0)
            txt = out.read_text(encoding="utf-8")
            # Ensure the exact characters survived (no replacement char)
            self.assertIn("RunId=Ångström", txt)
            self.assertIn("TOTAL_MATCHED_LINES: 1", txt)

    def test_multiple_regex_and_prefix(self):
        # Combine custom prefix and multiple regex patterns
        with tempfile.TemporaryDirectory() as td:
            d = pathlib.Path(td) / "logs"
            d.mkdir()
            (d / "x.log").write_text(
                "\n".join([
                    "HELLO one",                 # regex ^HELLO
                    "meh",
                    "greeting: HELLO two",      # regex greeting: HELLO
                    "CustomPrefix value",        # custom prefix
                    "Counts => created=1",       # base prefix
                    "Timing (s) => addLayers=0.5" # base prefix
                ]) + "\n", encoding="utf-8"
            )
            (d / "y.log").write_text(
                "\n".join([
                    "CustomPrefix again",        # custom prefix
                    "HELLO three"                # regex ^HELLO
                ]) + "\n", encoding="utf-8"
            )

            out = pathlib.Path(td) / "out_mix.log"
            rc = log_picker.main([
                "--input-dir", str(d),
                "--output-file", str(out),
                "--prefix", "CustomPrefix",
                "--regex", r"^HELLO",
                "--regex", r"greeting: HELLO",
            ])
            self.assertEqual(rc, 0)
            txt = out.read_text(encoding="utf-8")
            # Header includes both sections
            self.assertIn("Prefixes:", txt)
            self.assertIn("CustomPrefix", txt)
            self.assertIn("Regexes:", txt)
            self.assertIn("^HELLO", txt)
            self.assertIn("greeting: HELLO", txt)
            # Matched lines present
            self.assertIn("HELLO one", txt)
            self.assertIn("greeting: HELLO two", txt)
            self.assertIn("CustomPrefix value", txt)
            self.assertIn("CustomPrefix again", txt)
            self.assertIn("Counts => created=1", txt)
            self.assertIn("Timing (s) => addLayers=0.5", txt)
            # Counts: x.log has 5 matches, y.log has 2 -> total 7
            self.assertIn("x.log: 5", txt)
            self.assertIn("y.log: 2", txt)
            self.assertIn("TOTAL_MATCHED_LINES: 7", txt)
