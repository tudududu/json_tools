import json
import os
from pathlib import Path
from typing import Dict

import pytest

from python.tools import inspect_flags


def make_single_country(path: Path, meta: Dict, videos_meta=None):
    data = {
        "metadataGlobal": meta,
        "videos": []
    }
    if videos_meta:
        for i, vm in enumerate(videos_meta):
            data["videos"].append({"videoId": f"vid{i}", "metadata": vm})
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def make_multi_country(path: Path, countries_meta: Dict[str, Dict], videos_meta=None):
    by_country = {}
    for c, meta in countries_meta.items():
        entry = {"metadataGlobal": meta, "videos": []}
        if videos_meta:
            for i, vm in enumerate(videos_meta):
                entry["videos"].append({"videoId": f"{c}_vid{i}", "metadata": vm})
        by_country[c] = entry
    path.write_text(json.dumps({"_multi": True, "byCountry": by_country}), encoding="utf-8")
    return path


def run_cli(args):
    # Capture stdout for assertions; return exit code and lines
    from io import StringIO
    import sys
    buf = StringIO()
    old_out = sys.stdout
    try:
        sys.stdout = buf
        code = inspect_flags.main(args)
    finally:
        sys.stdout = old_out
    return code, [l for l in buf.getvalue().splitlines() if l.strip()]


def test_gather_json_files_glob_and_directory(tmp_path):
    # Create directory with json files
    d = tmp_path / "data"
    d.mkdir()
    (d / "a.json").write_text("{}", encoding="utf-8")
    (d / "b.JSON").write_text("{}", encoding="utf-8")  # case insensitivity
    (tmp_path / "c.json").write_text("{}", encoding="utf-8")
    files = inspect_flags.gather_json_files([str(d), str(tmp_path / "*.json")])
    assert any(str(p).endswith("a.json") for p in files)
    assert any(str(p).endswith("b.JSON") for p in files)
    assert any(str(p).endswith("c.json") for p in files)


@pytest.mark.parametrize("show_missing", [False, True])
def test_single_country_metadata_extraction(tmp_path, show_missing: bool):
    f = make_single_country(tmp_path / "one.json", {"jobNumber": "123", "subtitle_flag": True}, videos_meta=[{"jobNumber": "vJ"}])
    args = [str(f), "--keys", "jobNumber,disclaimer_flag,subtitle_flag"]
    if show_missing:
        args.append("--show-missing")
    code, lines = run_cli(args)
    assert code == 0
    # Only one metadataGlobal line expected (single country)
    mg_line = next(l for l in lines if "[metadataGlobal]" in l)
    assert "jobNumber='123'" in mg_line
    assert ("subtitle_flag=True" in mg_line)
    if show_missing:
        assert "disclaimer_flag=<MISSING>" in mg_line
    else:
        assert "disclaimer_flag=<MISSING>" not in mg_line


def test_single_country_per_video_enabled(tmp_path):
    f = make_single_country(tmp_path / "pv.json", {"jobNumber": "root"}, videos_meta=[{"subtitle_flag": False}, {"jobNumber": "v2"}])
    code, lines = run_cli([str(f), "--per-video", "--keys", "jobNumber,subtitle_flag"])
    assert code == 0
    # Expect metadataGlobal + two video lines
    assert sum("[video:" in l for l in lines) == 2
    assert any("video:vid0" in l and "subtitle_flag=False" in l for l in lines)
    assert any("video:vid1" in l and "jobNumber='v2'" in l for l in lines)


def test_multi_country_basic(tmp_path):
    f = make_multi_country(tmp_path / "multi.json", {"GBR": {"jobNumber": "gb"}, "DEU": {"subtitle_flag": True}}, videos_meta=[{"jobNumber": "v"}])
    code, lines = run_cli([str(f), "--keys", "jobNumber,subtitle_flag", "--per-video"])
    assert code == 0
    # Expect both countries metadataGlobal lines
    assert any("[GBR][metadataGlobal]" in l and "jobNumber='gb'" in l for l in lines)
    assert any("[DEU][metadataGlobal]" in l and "subtitle_flag=True" in l for l in lines)
    # Per-video lines include country prefix videoIds
    assert any("[GBR][video:GBR_vid0]" in l for l in lines)


def test_error_on_no_files(tmp_path, capsys):
    code = inspect_flags.main([str(tmp_path / "nofile*.json")])
    assert code == 1
    err = capsys.readouterr().err
    assert "No files matched" in err


def test_invalid_json_is_reported(tmp_path):
    f = tmp_path / "bad.json"
    f.write_text("{not valid", encoding="utf-8")
    code, lines = run_cli([str(f)])
    assert code == 0  # continues processing other files (none here)
    assert any("<ERROR reading JSON" in l for l in lines)


def test_default_keys_omitted_uses_defaults(tmp_path):
    # Defaults: disclaimer_flag, subtitle_flag, jobNumber
    f = make_single_country(
        tmp_path / "defaults.json",
        {"subtitle_flag": True},  # leave jobNumber/disclaimer_flag missing
    )
    code, lines = run_cli([str(f)])  # no --keys provided
    assert code == 0
    mg_line = next(l for l in lines if "[metadataGlobal]" in l)
    # Present default key should appear
    assert "subtitle_flag=True" in mg_line
    # Missing default keys should be omitted (since --show-missing not set)
    assert "jobNumber=" not in mg_line
    assert "disclaimer_flag=" not in mg_line
