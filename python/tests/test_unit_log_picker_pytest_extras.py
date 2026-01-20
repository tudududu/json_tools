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


@pytest.mark.parametrize(
    "file_encoding,cli_encoding,line,expect_exact",
    [
        ("utf-8", None, "RunId=Hello✓", True),
        ("latin-1", "latin-1", "RunId=Ångström", True),
        # Mismatch: we still match the prefix, but exact unicode may be replaced
        ("latin-1", "utf-8", "RunId=Ångström", False),
    ],
)
def test_param_encodings(tmp_path, file_encoding, cli_encoding, line, expect_exact):
    d = tmp_path / "logs"
    d.mkdir()
    dest = d / "enc.log"
    if file_encoding == "utf-8":
        dest.write_text(line + "\n", encoding="utf-8")
    else:
        # latin-1
        dest.write_bytes(line.encode("latin-1", errors="strict") + b"\n")

    out = tmp_path / "out.log"
    args = ["--input-dir", str(d), "--output-file", str(out)]
    if cli_encoding is not None:
        args += ["--encoding", cli_encoding]
    rc = log_picker.main(args)
    assert rc == 0
    txt = out.read_text(encoding="utf-8")
    # We should always match the prefix line once regardless of encoding outcome
    assert "enc.log:" in txt
    # Summary Counts now only reports total pipeline_run logs (none here)
    assert "==== Summary Counts ====" in txt
    assert "TOTAL_PIPELINE_RUN_LOGS: 0" in txt
    # Exact string may not be preserved under mismatched decoding
    if expect_exact:
        assert line in txt
    else:
        assert "RunId=" in txt


@pytest.mark.parametrize(
    "prefixes,expected_counts,total",
    [
        ([], {"a.log": 1, "b.log": 0}, 1),
        (["PrefixA"], {"a.log": 2, "b.log": 0}, 2),
        (["PrefixB"], {"a.log": 2, "b.log": 1}, 3),
        (["PrefixA", "PrefixB"], {"a.log": 3, "b.log": 1}, 4),
    ],
)
def test_param_prefix_combinations(tmp_path, prefixes, expected_counts, total):
    base = tmp_path / "logs"
    base.mkdir()
    # a.log has both prefixes and a base prefix line
    (base / "a.log").write_text(
        "\n".join([
            "PrefixA one",
            "PrefixB two",
            "INFO {save_as_iso} Saved as",
        ])
        + "\n",
        encoding="utf-8",
    )
    # b.log only has PrefixB
    (base / "b.log").write_text("PrefixB only\n", encoding="utf-8")

    out = tmp_path / "out.log"
    args = ["--input-dir", str(base), "--output-file", str(out)]
    for p in prefixes:
        args += ["--prefix", p]
    rc = log_picker.main(args)
    assert rc == 0
    txt = out.read_text(encoding="utf-8")
    # Summary Counts now only reports total pipeline_run logs (none in this test)
    assert "==== Summary Counts ====" in txt
    assert "TOTAL_PIPELINE_RUN_LOGS: 0" in txt
