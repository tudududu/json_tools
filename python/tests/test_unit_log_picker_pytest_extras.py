import os
import sys
from pathlib import Path

import pytest

# Ensure repository root is on sys.path; package markers allow python.* imports
_HERE = os.path.dirname(os.path.abspath(__file__))
_REPOROOT = os.path.abspath(os.path.join(_HERE, "..", ".."))
if _REPOROOT not in sys.path:
    sys.path.insert(0, _REPOROOT)

from python.tools import log_picker


def test_pick_lines_oserror_monkeypatch(monkeypatch, tmp_path):
    """Force Path.open to raise OSError for one path to cover error branch.

    This verifies pick_lines emits a single diagnostic line for unreadable files.
    """
    target = tmp_path / "boom.log"
    target.write_text("hello\n", encoding="utf-8")

    orig_open = Path.open

    def patched_open(self: Path, *args, **kwargs):
        if self == target:
            raise OSError("boom-error")
        return orig_open(self, *args, **kwargs)

    monkeypatch.setattr(log_picker.Path, "open", patched_open)

    picked = log_picker.pick_lines(target, prefixes=["X"], regexes=[], encoding="utf-8")
    assert len(picked) == 1
    assert picked[0].startswith("<ERROR reading boom.log: ")
    assert "boom-error" in picked[0]


@pytest.mark.parametrize("case", ["invalid_dir", "invalid_regex"])
def test_main_parametrized_error_cases(tmp_path, case):
    out = tmp_path / "out.log"
    if case == "invalid_dir":
        bogus = tmp_path / "nope" / "missing"
        rc = log_picker.main(["--input-dir", str(bogus), "--output-file", str(out)])
        assert rc == 2
    else:  # invalid_regex
        d = tmp_path / "logs"
        d.mkdir()
        (d / "a.log").write_text("Pipeline complete.\n", encoding="utf-8")
        rc = log_picker.main([
            "--input-dir",
            str(d),
            "--output-file",
            str(out),
            "--regex",
            "(",
        ])
        assert rc == 3
