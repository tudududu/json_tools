"""Unit + CLI tests for config_converter.py and generate_config_template.py."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from typing import Any, List, Optional, Tuple

import pytest

from python.tools.config_converter import _split_list_cell

# ──────────────────────────────────────────────────────────────────────────────
# Shared helpers
# ──────────────────────────────────────────────────────────────────────────────

_CONVERTER = "python.tools.config_converter"
_GENERATOR = "python.tools.generate_config_template"

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
    timing_rows: Optional[List[list]] = None,
) -> None:
    """Write a two-sheet XLSX fixture with standard headers."""
    ws_name, rules_name = sheet_names or (
        "LAYER_NAME_CONFIG_items",
        "LAYER_NAME_CONFIG_recenterRules",
    )
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
    if timing_rows is not None:
        wt = wb.create_sheet(title="TIMING_BEHAVIOR")
        wt.append(["layerName", "behavior"])
        for row in timing_rows:
            wt.append(row)
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
        with open(out_json, encoding="utf-8") as f:
            data = json.load(f)
        body = data["config"]["addLayers"]["LAYER_NAME_CONFIG"]
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
        with open(out_json, encoding="utf-8") as f:
            body = json.load(f)["config"]["addLayers"]["LAYER_NAME_CONFIG"]
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
        _write_minimal_xlsx(
            openpyxl,
            xlsx,
            sheet_names=(
                "layer_name_config_items",
                "layer_name_config_recenterrules",
            ),
        )
        proc = _run(_CONVERTER, xlsx, out_json)
        assert proc.returncode == 0, proc.stderr
        with open(out_json, encoding="utf-8") as f:
            data = json.load(f)
        assert "LAYER_NAME_CONFIG" in data["config"]["addLayers"]
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
        with open(out_json, encoding="utf-8") as f:
            data = json.load(f)
        add_layers = data["config"]["addLayers"]
        assert "MY_CONFIG" in add_layers
        assert "LAYER_NAME_CONFIG" not in add_layers
    finally:
        _cleanup_dir(d)


def test_converter_indent_three_formats_arrays_as_one_liners():
    openpyxl = pytest.importorskip("openpyxl")
    d = tempfile.mkdtemp()
    try:
        xlsx = os.path.join(d, "in.xlsx")
        out_json = os.path.join(d, "out.json")
        _write_minimal_xlsx(
            openpyxl,
            xlsx,
            layer_rows=[["logoAnim", "logo_01_anim;Size_Holder_Logo", ""]],
        )
        proc = _run(_CONVERTER, xlsx, out_json, "--indent", "3")
        assert proc.returncode == 0, proc.stderr
        with open(out_json, encoding="utf-8") as f:
            content = f.read()
        assert '["logo_01_anim", "Size_Holder_Logo"]' in content
        assert '"contains": []' in content
    finally:
        _cleanup_dir(d)


def test_converter_timing_behavior_included_by_default_when_sheet_exists():
    openpyxl = pytest.importorskip("openpyxl")
    d = tempfile.mkdtemp()
    try:
        xlsx = os.path.join(d, "in.xlsx")
        out_json = os.path.join(d, "out.json")
        _write_minimal_xlsx(
            openpyxl,
            xlsx,
            timing_rows=[["logo", "timed"], ["logo_03", "span"]],
        )
        proc = _run(_CONVERTER, xlsx, out_json)
        assert proc.returncode == 0, proc.stderr
        with open(out_json, encoding="utf-8") as f:
            data = json.load(f)
        timing = data["config"]["addLayers"]["TIMING_BEHAVIOR"]
        assert timing["logo"] == "timed"
        assert timing["logo_03"] == "span"
    finally:
        _cleanup_dir(d)


def test_converter_timing_behavior_not_included_when_sheet_missing():
    openpyxl = pytest.importorskip("openpyxl")
    d = tempfile.mkdtemp()
    try:
        xlsx = os.path.join(d, "in.xlsx")
        out_json = os.path.join(d, "out.json")
        _write_minimal_xlsx(openpyxl, xlsx)
        proc = _run(_CONVERTER, xlsx, out_json)
        assert proc.returncode == 0, proc.stderr
        with open(out_json, encoding="utf-8") as f:
            data = json.load(f)
        assert "TIMING_BEHAVIOR" not in data["config"]["addLayers"]
    finally:
        _cleanup_dir(d)


def test_converter_timing_behavior_included_when_flag_set():
    openpyxl = pytest.importorskip("openpyxl")
    d = tempfile.mkdtemp()
    try:
        xlsx = os.path.join(d, "in.xlsx")
        out_json = os.path.join(d, "out.json")
        _write_minimal_xlsx(
            openpyxl,
            xlsx,
            timing_rows=[["logo", "timed"], ["logo_03", "span"]],
        )
        proc = _run(
            _CONVERTER,
            xlsx,
            out_json,
            "--timing-behavior-sheet",
            "TIMING_BEHAVIOR",
        )
        assert proc.returncode == 0, proc.stderr
        with open(out_json, encoding="utf-8") as f:
            data = json.load(f)
        timing = data["config"]["addLayers"]["TIMING_BEHAVIOR"]
        assert timing["logo"] == "timed"
        assert timing["logo_03"] == "span"
    finally:
        _cleanup_dir(d)


def test_converter_timing_behavior_invalid_value_fails():
    openpyxl = pytest.importorskip("openpyxl")
    d = tempfile.mkdtemp()
    try:
        xlsx = os.path.join(d, "in.xlsx")
        out_json = os.path.join(d, "out.json")
        _write_minimal_xlsx(
            openpyxl,
            xlsx,
            timing_rows=[["logo", "INVALID"]],
        )
        proc = _run(
            _CONVERTER,
            xlsx,
            out_json,
            "--timing-behavior-sheet",
            "TIMING_BEHAVIOR",
        )
        assert proc.returncode != 0
        assert "INVALID" in (proc.stdout + proc.stderr)
    finally:
        _cleanup_dir(d)


def test_converter_timing_behavior_dry_run_includes_entry_count():
    openpyxl = pytest.importorskip("openpyxl")
    d = tempfile.mkdtemp()
    try:
        xlsx = os.path.join(d, "in.xlsx")
        out_json = os.path.join(d, "out.json")
        _write_minimal_xlsx(
            openpyxl,
            xlsx,
            timing_rows=[["logo", "timed"], ["logo_03", "span"]],
        )
        proc = _run(
            _CONVERTER,
            xlsx,
            out_json,
            "--dry-run",
        )
        assert proc.returncode == 0, proc.stderr
        assert "TIMING_BEHAVIOR" in proc.stdout
        assert "2 TIMING_BEHAVIOR entries" in proc.stdout
    finally:
        _cleanup_dir(d)


# ──────────────────────────────────────────────────────────────────────────────
# generate_config_template CLI tests
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
        assert "LAYER_NAME_CONFIG_items" in titles
        assert "LAYER_NAME_CONFIG_recenterRules" in titles
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
        ws = next(w for w in wb.worksheets if w.title == "LAYER_NAME_CONFIG_items")
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
        ws = next(
            w for w in wb.worksheets if w.title == "LAYER_NAME_CONFIG_recenterRules"
        )
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
        ws = next(w for w in wb.worksheets if w.title == "LAYER_NAME_CONFIG_items")
        # header + 2 layer entries (logo, subtitles); recenterRules is excluded
        rows = list(ws.iter_rows(values_only=True))
        assert len(rows) == 3
        wb.close()
    finally:
        _cleanup_dir(d)


def test_generator_no_timing_behavior_sheet_by_default():
    openpyxl = pytest.importorskip("openpyxl")
    d = tempfile.mkdtemp()
    try:
        in_json = os.path.join(d, "in.json")
        out_xlsx = os.path.join(d, "out.xlsx")
        payload = {
            "config": {
                "addLayers": {
                    "LAYER_NAME_CONFIG": _MINIMAL_JSON["LAYER_NAME_CONFIG"],
                    "TIMING_BEHAVIOR": {"logo": "timed"},
                }
            }
        }
        _write_json(in_json, payload)
        proc = _run(_GENERATOR, in_json, out_xlsx)
        assert proc.returncode == 0, proc.stderr
        wb = openpyxl.load_workbook(out_xlsx)
        titles = [ws.title for ws in wb.worksheets]
        assert "TIMING_BEHAVIOR" not in titles
        wb.close()
    finally:
        _cleanup_dir(d)


def test_generator_creates_timing_behavior_sheet_with_validation():
    openpyxl = pytest.importorskip("openpyxl")
    d = tempfile.mkdtemp()
    try:
        in_json = os.path.join(d, "in.json")
        out_xlsx = os.path.join(d, "out.xlsx")
        payload = {
            "config": {
                "addLayers": {
                    "LAYER_NAME_CONFIG": _MINIMAL_JSON["LAYER_NAME_CONFIG"],
                    "TIMING_BEHAVIOR": {"logo": "timed", "logo_03": "span"},
                }
            }
        }
        _write_json(in_json, payload)
        proc = _run(
            _GENERATOR,
            in_json,
            out_xlsx,
            "--timing-behavior-sheet",
            "TIMING_BEHAVIOR",
        )
        assert proc.returncode == 0, proc.stderr
        wb = openpyxl.load_workbook(out_xlsx)
        ws = next(w for w in wb.worksheets if w.title == "TIMING_BEHAVIOR")
        headers = [cell.value for cell in next(ws.iter_rows(min_row=1, max_row=1))]
        assert headers == ["layerName", "behavior"]
        rows = list(ws.iter_rows(min_row=2, values_only=True))
        assert ("logo", "timed") in rows
        assert ("logo_03", "span") in rows
        formulas = [dv.formula1 for dv in ws.data_validations.dataValidation]
        assert '"timed,span,asIs"' in formulas
        wb.close()
    finally:
        _cleanup_dir(d)


def test_generator_creates_timing_item_selector_sheet():
    openpyxl = pytest.importorskip("openpyxl")
    d = tempfile.mkdtemp()
    try:
        in_json = os.path.join(d, "in.json")
        out_xlsx = os.path.join(d, "out.xlsx")
        payload = {
            "config": {
                "addLayers": {
                    "LAYER_NAME_CONFIG": _MINIMAL_JSON["LAYER_NAME_CONFIG"],
                    "TIMING_ITEM_SELECTOR": {
                        "logo": {"mode": "line", "value": 1},
                        "logo_02": {"mode": "index", "value": 2},
                    },
                }
            }
        }
        _write_json(in_json, payload)
        proc = _run(_GENERATOR, in_json, out_xlsx)
        assert proc.returncode == 0, proc.stderr
        wb = openpyxl.load_workbook(out_xlsx)
        ws = next(w for w in wb.worksheets if w.title == "TIMING_ITEM_SELECTOR")
        headers = [cell.value for cell in next(ws.iter_rows(min_row=1, max_row=1))]
        assert headers == ["itemName", "mode", "value"]
        rows = list(ws.iter_rows(min_row=2, values_only=True))
        assert ("logo", "line", 1) in rows
        assert ("logo_02", "index", 2) in rows
        formulas = [dv.formula1 for dv in ws.data_validations.dataValidation]
        assert '"line,index,minMax"' in formulas
        wb.close()
    finally:
        _cleanup_dir(d)


def test_generator_reads_timing_item_selector_from_sample_shape():
    openpyxl = pytest.importorskip("openpyxl")
    d = tempfile.mkdtemp()
    try:
        here = os.path.dirname(__file__)
        sample_json = os.path.normpath(
            os.path.join(here, "..", "..", "samples", "sample_config_data.json")
        )
        if not os.path.isfile(sample_json):
            pytest.skip("Sample file samples/sample_config_data.json not found")

        out_xlsx = os.path.join(d, "out.xlsx")
        proc = _run(_GENERATOR, sample_json, out_xlsx)
        assert proc.returncode == 0, proc.stderr
        wb = openpyxl.load_workbook(out_xlsx)
        ws = next(w for w in wb.worksheets if w.title == "TIMING_ITEM_SELECTOR")
        rows = list(ws.iter_rows(min_row=2, values_only=True))
        assert ("logo", "line", 1) in rows
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
        os.path.join(here, "..", "..", "samples", "sample_config_data.json")
    )
    if not os.path.isfile(sample_json):
        pytest.skip("Sample file samples/sample_config_data.json not found")

    d = tempfile.mkdtemp()
    try:
        template_xlsx = os.path.join(d, "template.xlsx")
        roundtrip_json = os.path.join(d, "roundtrip.json")
        sep = ";"

        # Step 1: sample JSON → XLSX template
        proc = _run(
            _GENERATOR,
            sample_json,
            template_xlsx,
            "--separator",
            sep,
            "--timing-behavior-sheet",
            "TIMING_BEHAVIOR",
        )
        assert proc.returncode == 0, proc.stderr

        # Step 2: XLSX template → JSON
        proc = _run(
            _CONVERTER,
            template_xlsx,
            roundtrip_json,
            "--separator",
            sep,
            "--timing-behavior-sheet",
            "TIMING_BEHAVIOR",
        )
        assert proc.returncode == 0, proc.stderr

        with open(sample_json, encoding="utf-8") as f:
            src_raw = json.load(f)
        src_add_layers = src_raw["config"]["addLayers"]
        src = src_add_layers["LAYER_NAME_CONFIG"]
        with open(roundtrip_json, encoding="utf-8") as f:
            rt_full = json.load(f)
        rt_add_layers = rt_full["config"]["addLayers"]
        rt = rt_add_layers["LAYER_NAME_CONFIG"]

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

        # TIMING_BEHAVIOR should survive the roundtrip too.
        assert rt_add_layers.get("TIMING_BEHAVIOR") == src_add_layers.get(
            "TIMING_BEHAVIOR"
        )
    finally:
        _cleanup_dir(d)
