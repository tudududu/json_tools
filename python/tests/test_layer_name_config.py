"""Unit + CLI tests for layer_name_config.py and generate_layer_name_template.py."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from typing import Any, List, Optional, Tuple

import pytest

from python.tools.layer_name_config import _split_list_cell

# ──────────────────────────────────────────────────────────────────────────────
# Shared helpers
# ──────────────────────────────────────────────────────────────────────────────

_CONVERTER = "python.tools.layer_name_config"
_GENERATOR = "python.tools.generate_layer_name_template"

# Minimal JSON used as input for generator tests.
_MINIMAL_JSON = {
    "LAYER_NAME_CONFIG": {
        "logo": {"exact": ["logo_01", "Size_Holder_Logo"], "contains": []},
        "subtitles": {"exact": [], "contains": ["subtitles"]},
        "recenterRules": {
            "force": ["Logo"],
            "noRecenter": ["BG"],
            "alignH": ["Claim"],
            "alignV": ["Disclaimer"],
        },
    }
}


def _run(module: str, *args: str) -> subprocess.CompletedProcess:  # type: ignore[type-arg]
    return subprocess.run(
        [sys.executable, "-m", module, *args],
        capture_output=True,
        text=True,
    )


def _write_json(path: str, data: object) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)


def _write_minimal_xlsx(
    openpyxl_mod: Any,
    path: str,
    layer_rows: Optional[List[list]] = None,
    rule_rows: Optional[List[list]] = None,
    sheet_names: Optional[Tuple[str, str]] = None,
) -> None:
    """Write a two-sheet XLSX fixture with standard headers."""
    ws_name, rules_name = sheet_names or ("LayerNames", "RecenterRules")
    wb = openpyxl_mod.Workbook()
    ws = wb.active
    ws.title = ws_name
    ws.append(["key", "exact", "contains"])
    for row in layer_rows or [["logo", "logo_01", ""]]:
        ws.append(row)
    wr = wb.create_sheet(title=rules_name)
    wr.append(["force", "noRecenter", "alignH", "alignV"])
    for row in rule_rows or [["Logo", "BG", "Claim", "Disclaimer"]]:
        wr.append(row)
    wb.save(path)


def _cleanup_dir(d: str) -> None:
    """Best-effort remove a temporary directory and all its direct children."""
    try:
        for entry in os.scandir(d):
            try:
                os.remove(entry.path)
            except Exception:
                pass
        os.rmdir(d)
    except Exception:
        pass


# ──────────────────────────────────────────────────────────────────────────────
# _split_list_cell unit tests  (no I/O, no XLSX)
# ──────────────────────────────────────────────────────────────────────────────


def test_split_list_cell_none_returns_empty():
    assert _split_list_cell(None, ";") == []


def test_split_list_cell_empty_string_returns_empty():
    assert _split_list_cell("", ";") == []


def test_split_list_cell_single_item():
    assert _split_list_cell("logo_01", ";") == ["logo_01"]


def test_split_list_cell_multiple_items():
    assert _split_list_cell("logo_01;logo_02", ";") == ["logo_01", "logo_02"]


def test_split_list_cell_strips_whitespace():
    assert _split_list_cell(" logo_01 ; logo_02 ", ";") == ["logo_01", "logo_02"]


def test_split_list_cell_drops_blank_segments():
    assert _split_list_cell("logo_01;;logo_02", ";") == ["logo_01", "logo_02"]


# ──────────────────────────────────────────────────────────────────────────────
# layer_name_config CLI tests
# ──────────────────────────────────────────────────────────────────────────────


def test_converter_missing_input_file():
    proc = _run(_CONVERTER, "/nonexistent/does_not_exist.xlsx", "/tmp/out.json")
    assert proc.returncode != 0
    assert "No such file or directory" in proc.stderr


def test_converter_empty_separator():
    openpyxl = pytest.importorskip("openpyxl")
    d = tempfile.mkdtemp()
    try:
        xlsx = os.path.join(d, "in.xlsx")
        _write_minimal_xlsx(openpyxl, xlsx)
        proc = _run(_CONVERTER, xlsx, os.path.join(d, "out.json"), "--separator", "")
        assert proc.returncode != 0
        assert "--separator must not be empty" in proc.stdout + proc.stderr
    finally:
        _cleanup_dir(d)


def test_converter_dry_run_prints_counts_and_no_output_file():
    openpyxl = pytest.importorskip("openpyxl")
    d = tempfile.mkdtemp()
    try:
        xlsx = os.path.join(d, "in.xlsx")
        out_json = os.path.join(d, "out.json")
        # 2 layer rows; rule_rows fills all 4 columns → 4 recenter rule groups
        _write_minimal_xlsx(
            openpyxl,
            xlsx,
            layer_rows=[["logo", "logo_01", ""], ["info", "info", "info"]],
        )
        proc = _run(_CONVERTER, xlsx, out_json, "--dry-run")
        assert proc.returncode == 0, proc.stderr
        assert "Parsed 2 layer-name keys and 4 recenter rule groups" in proc.stdout
        assert not os.path.exists(out_json), "dry-run must not write output file"
    finally:
        _cleanup_dir(d)


def test_converter_produces_valid_json_with_correct_values():
    openpyxl = pytest.importorskip("openpyxl")
    d = tempfile.mkdtemp()
    try:
        xlsx = os.path.join(d, "in.xlsx")
        out_json = os.path.join(d, "out.json")
        _write_minimal_xlsx(
            openpyxl,
            xlsx,
            layer_rows=[["logo", "logo_01;logo_02", ""]],
        )
        proc = _run(_CONVERTER, xlsx, out_json)
        assert proc.returncode == 0, proc.stderr
        data = json.loads(open(out_json, encoding="utf-8").read())
        body = data["LAYER_NAME_CONFIG"]
        assert body["logo"]["exact"] == ["logo_01", "logo_02"]
        assert body["logo"]["contains"] == []
        assert body["recenterRules"]["force"] == ["Logo"]
        assert body["recenterRules"]["noRecenter"] == ["BG"]
    finally:
        _cleanup_dir(d)


def test_converter_empty_exact_and_contains_always_emitted():
    openpyxl = pytest.importorskip("openpyxl")
    d = tempfile.mkdtemp()
    try:
        xlsx = os.path.join(d, "in.xlsx")
        out_json = os.path.join(d, "out.json")
        # both exact and contains cells are empty
        _write_minimal_xlsx(openpyxl, xlsx, layer_rows=[["subtitles", "", ""]])
        proc = _run(_CONVERTER, xlsx, out_json)
        assert proc.returncode == 0, proc.stderr
        body = json.loads(open(out_json, encoding="utf-8").read())["LAYER_NAME_CONFIG"]
        assert body["subtitles"] == {"exact": [], "contains": []}
    finally:
        _cleanup_dir(d)


def test_converter_case_insensitive_sheet_names():
    openpyxl = pytest.importorskip("openpyxl")
    d = tempfile.mkdtemp()
    try:
        xlsx = os.path.join(d, "in.xlsx")
        out_json = os.path.join(d, "out.json")
        # sheets named in lowercase; default CLI flags use mixed case
        _write_minimal_xlsx(openpyxl, xlsx, sheet_names=("layernames", "recenterrules"))
        proc = _run(_CONVERTER, xlsx, out_json)
        assert proc.returncode == 0, proc.stderr
        data = json.loads(open(out_json, encoding="utf-8").read())
        assert "LAYER_NAME_CONFIG" in data
    finally:
        _cleanup_dir(d)


def test_converter_respects_custom_root_key():
    openpyxl = pytest.importorskip("openpyxl")
    d = tempfile.mkdtemp()
    try:
        xlsx = os.path.join(d, "in.xlsx")
        out_json = os.path.join(d, "out.json")
        _write_minimal_xlsx(openpyxl, xlsx)
        proc = _run(_CONVERTER, xlsx, out_json, "--root-key", "MY_CONFIG")
        assert proc.returncode == 0, proc.stderr
        data = json.loads(open(out_json, encoding="utf-8").read())
        assert "MY_CONFIG" in data
        assert "LAYER_NAME_CONFIG" not in data
    finally:
        _cleanup_dir(d)


# ──────────────────────────────────────────────────────────────────────────────
# generate_layer_name_template CLI tests
# ──────────────────────────────────────────────────────────────────────────────


def test_generator_missing_input_file():
    proc = _run(_GENERATOR, "/nonexistent/no_file.json", "/tmp/out.xlsx")
    assert proc.returncode != 0
    assert "No such file or directory" in proc.stderr


def test_generator_wrong_root_key():
    d = tempfile.mkdtemp()
    try:
        in_json = os.path.join(d, "in.json")
        _write_json(in_json, {"WRONG_KEY": {}})
        proc = _run(
            _GENERATOR,
            in_json,
            os.path.join(d, "out.xlsx"),
            "--root-key",
            "LAYER_NAME_CONFIG",
        )
        assert proc.returncode != 0
    finally:
        _cleanup_dir(d)


def test_generator_creates_xlsx_with_correct_sheet_names():
    openpyxl = pytest.importorskip("openpyxl")
    d = tempfile.mkdtemp()
    try:
        in_json = os.path.join(d, "in.json")
        out_xlsx = os.path.join(d, "out.xlsx")
        _write_json(in_json, _MINIMAL_JSON)
        proc = _run(_GENERATOR, in_json, out_xlsx)
        assert proc.returncode == 0, proc.stderr
        assert os.path.isfile(out_xlsx)
        wb = openpyxl.load_workbook(out_xlsx)
        titles = [ws.title for ws in wb.worksheets]
        assert "LayerNames" in titles
        assert "RecenterRules" in titles
        wb.close()
    finally:
        _cleanup_dir(d)


def test_generator_layer_names_sheet_headers():
    openpyxl = pytest.importorskip("openpyxl")
    d = tempfile.mkdtemp()
    try:
        in_json = os.path.join(d, "in.json")
        out_xlsx = os.path.join(d, "out.xlsx")
        _write_json(in_json, _MINIMAL_JSON)
        proc = _run(_GENERATOR, in_json, out_xlsx)
        assert proc.returncode == 0, proc.stderr
        wb = openpyxl.load_workbook(out_xlsx)
        ws = next(w for w in wb.worksheets if w.title == "LayerNames")
        headers = [cell.value for cell in next(ws.iter_rows(min_row=1, max_row=1))]
        assert headers == ["key", "exact", "contains"]
        wb.close()
    finally:
        _cleanup_dir(d)


def test_generator_recenter_rules_sheet_headers():
    openpyxl = pytest.importorskip("openpyxl")
    d = tempfile.mkdtemp()
    try:
        in_json = os.path.join(d, "in.json")
        out_xlsx = os.path.join(d, "out.xlsx")
        _write_json(in_json, _MINIMAL_JSON)
        proc = _run(_GENERATOR, in_json, out_xlsx)
        assert proc.returncode == 0, proc.stderr
        wb = openpyxl.load_workbook(out_xlsx)
        ws = next(w for w in wb.worksheets if w.title == "RecenterRules")
        headers = [cell.value for cell in next(ws.iter_rows(min_row=1, max_row=1))]
        assert headers == ["force", "noRecenter", "alignH", "alignV"]
        wb.close()
    finally:
        _cleanup_dir(d)


def test_generator_layer_names_row_count_excludes_recenter_rules():
    openpyxl = pytest.importorskip("openpyxl")
    d = tempfile.mkdtemp()
    try:
        in_json = os.path.join(d, "in.json")
        out_xlsx = os.path.join(d, "out.xlsx")
        _write_json(in_json, _MINIMAL_JSON)
        proc = _run(_GENERATOR, in_json, out_xlsx)
        assert proc.returncode == 0, proc.stderr
        wb = openpyxl.load_workbook(out_xlsx)
        ws = next(w for w in wb.worksheets if w.title == "LayerNames")
        # header + 2 layer entries (logo, subtitles); recenterRules is excluded
        rows = list(ws.iter_rows(values_only=True))
        assert len(rows) == 3
        wb.close()
    finally:
        _cleanup_dir(d)


# ──────────────────────────────────────────────────────────────────────────────
# Roundtrip integration test
# ──────────────────────────────────────────────────────────────────────────────


def test_roundtrip_via_sample_json():
    """Generate XLSX from the sample JSON, then convert back; all keys must match."""
    pytest.importorskip("openpyxl")
    here = os.path.dirname(__file__)
    sample_json = os.path.normpath(
        os.path.join(here, "..", "..", "out", "LAYER_NAME_CONFIG.json")
    )
    if not os.path.isfile(sample_json):
        pytest.skip("Sample file out/LAYER_NAME_CONFIG.json not found")

    d = tempfile.mkdtemp()
    try:
        template_xlsx = os.path.join(d, "template.xlsx")
        roundtrip_json = os.path.join(d, "roundtrip.json")
        sep = ";"

        # Step 1: sample JSON → XLSX template
        proc = _run(_GENERATOR, sample_json, template_xlsx, "--separator", sep)
        assert proc.returncode == 0, proc.stderr

        # Step 2: XLSX template → JSON
        proc = _run(_CONVERTER, template_xlsx, roundtrip_json, "--separator", sep)
        assert proc.returncode == 0, proc.stderr

        src = json.loads(open(sample_json, encoding="utf-8").read())[
            "LAYER_NAME_CONFIG"
        ]
        rt = json.loads(open(roundtrip_json, encoding="utf-8").read())[
            "LAYER_NAME_CONFIG"
        ]

        # All layer + recenterRules keys must match
        assert set(src.keys()) == set(rt.keys()), (
            f"Key mismatch: src={sorted(src.keys())} rt={sorted(rt.keys())}"
        )

        # Spot-check individual layer entries
        for key in ("logo", "subtitles", "dataJson"):
            if key in src:
                assert rt[key]["exact"] == src[key]["exact"], f"exact mismatch: {key}"
                assert rt[key]["contains"] == src[key]["contains"], (
                    f"contains mismatch: {key}"
                )

        # recenterRules values must survive the round trip
        for rule_key in ("force", "noRecenter", "alignH", "alignV"):
            assert rt["recenterRules"][rule_key] == src["recenterRules"][rule_key], (
                f"recenterRules.{rule_key} mismatch"
            )
    finally:
        _cleanup_dir(d)
