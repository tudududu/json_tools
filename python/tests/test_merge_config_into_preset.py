"""Unit + CLI tests for merge_config_into_preset.py."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from typing import Any, List, Optional

import pytest

from python.tools.merge_config_into_preset import (
    _deep_merge_replace_present,
    merge_config_into_preset,
)
from python.tools.sheet_names_config import SHEETS_BY_KEY

ITEMS_SHEET = SHEETS_BY_KEY["LAYER_NAME_CONFIG_items"].default_sheet_name
RULES_SHEET = SHEETS_BY_KEY["LAYER_NAME_CONFIG_recenterRules"].default_sheet_name
TIMING_BEHAVIOR_SHEET = SHEETS_BY_KEY["TIMING_BEHAVIOR"].default_sheet_name
TIMING_ITEM_SELECTOR_SHEET = SHEETS_BY_KEY["TIMING_ITEM_SELECTOR"].default_sheet_name
SKIP_COPY_CONFIG_SHEET = SHEETS_BY_KEY["SKIP_COPY_CONFIG"].default_sheet_name
MODULE_MAP_SHEET = SHEETS_BY_KEY["MODULE_MAP"].default_sheet_name
EXPLICIT_VARIANTS_SHEET = SHEETS_BY_KEY[
    "EXPLICIT_VARIANTS_BY_VIDEOID"
].default_sheet_name

_MERGE_TOOL = "python.tools.merge_config_into_preset"


def _run(module: str, *args: str) -> subprocess.CompletedProcess:  # type: ignore[type-arg]
    return subprocess.run(
        [sys.executable, "-m", module, *args],
        capture_output=True,
        text=True,
    )


def _write_minimal_xlsx(
    openpyxl_mod: Any,
    path: str,
    layer_rows: Optional[List[list]] = None,
    rule_rows: Optional[List[list]] = None,
    timing_rows: Optional[List[list]] = None,
    selector_rows: Optional[List[list]] = None,
    skip_rows: Optional[List[list]] = None,
    module_map_rows: Optional[List[list]] = None,
    explicit_variants_rows: Optional[List[list]] = None,
) -> None:
    """Write a two-sheet XLSX fixture with standard headers."""
    wb = openpyxl_mod.Workbook()
    ws = wb.active
    ws.title = ITEMS_SHEET
    ws.append(["key", "exact", "contains"])
    for row in layer_rows or [["logo", "logo_01", ""]]:
        ws.append(row)
    wr = wb.create_sheet(title=RULES_SHEET)
    wr.append(["force", "noRecenter", "alignH", "alignV"])
    for row in rule_rows or [["Logo", "BG", "Claim", "Disclaimer"]]:
        wr.append(row)
    if timing_rows is not None:
        wt = wb.create_sheet(title=TIMING_BEHAVIOR_SHEET)
        wt.append(["layerName", "behavior"])
        for row in timing_rows:
            wt.append(row)
    if selector_rows is not None:
        ws = wb.create_sheet(title=TIMING_ITEM_SELECTOR_SHEET)
        ws.append(["itemName", "mode", "value"])
        for row in selector_rows:
            ws.append(row)
    if skip_rows is not None:
        ws = wb.create_sheet(title=SKIP_COPY_CONFIG_SHEET)
        ws.append(["key", "value", "names"])
        for row in skip_rows:
            ws.append(row)
    if module_map_rows is not None:
        ws = wb.create_sheet(title=MODULE_MAP_SHEET)
        ws.append(["module", "ENABLED", "SOURCE_KEY"])
        for row in module_map_rows:
            ws.append(row)
    if explicit_variants_rows is not None:
        ws = wb.create_sheet(title=EXPLICIT_VARIANTS_SHEET)
        ws.append(["video_id", "variants"])
        for row in explicit_variants_rows:
            ws.append(row)
    wb.save(path)


def _write_json(path: str, data: object) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


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
# _deep_merge_replace_present unit tests
# ──────────────────────────────────────────────────────────────────────────────


def test_deep_merge_replace_present_basic():
    """Merge converts config into preset, updating matched keys."""
    preset = {
        "config": {
            "addLayers": {
                "LAYER_NAME_CONFIG": {"old": "value"},
                "TIMING_BEHAVIOR": {"old": "timing"},
            },
            "modular": {"MODULE_MAP": {"old": "map"}},
        },
        "other_data": {"keep": "this"},
    }
    converted = {
        "config": {
            "addLayers": {
                "LAYER_NAME_CONFIG": {"new": "value"},
            },
            "modular": {
                "MODULE_MAP": {"new": "map"},
            },
        }
    }
    merged, changed_keys = _deep_merge_replace_present(preset, converted)

    # Updated keys are present with new values
    assert merged["config"]["addLayers"]["LAYER_NAME_CONFIG"] == {"new": "value"}
    assert merged["config"]["modular"]["MODULE_MAP"] == {"new": "map"}

    # Untouched keys remain unchanged
    assert merged["config"]["addLayers"]["TIMING_BEHAVIOR"] == {"old": "timing"}
    assert merged["other_data"]["keep"] == "this"

    # Changed keys tracked
    assert "config.addLayers.LAYER_NAME_CONFIG" in changed_keys
    assert "config.modular.MODULE_MAP" in changed_keys
    assert len(changed_keys) == 2


def test_deep_merge_replace_present_missing_optional_sheets():
    """Replace-present mode: missing optional sheets leave preset untouched."""
    preset = {
        "config": {
            "addLayers": {
                "LAYER_NAME_CONFIG": {"old": "value"},
                "TIMING_BEHAVIOR": {"old": "timing"},
                "SKIP_COPY_CONFIG": {"old": "skip"},
            },
        }
    }
    # Converted has only LAYER_NAME_CONFIG; no TIMING_BEHAVIOR or SKIP_COPY_CONFIG
    converted = {
        "config": {
            "addLayers": {
                "LAYER_NAME_CONFIG": {"new": "value"},
            }
        }
    }
    merged, changed_keys = _deep_merge_replace_present(preset, converted)

    # Only LAYER_NAME_CONFIG replaced
    assert merged["config"]["addLayers"]["LAYER_NAME_CONFIG"] == {"new": "value"}

    # Other keys preserved
    assert merged["config"]["addLayers"]["TIMING_BEHAVIOR"] == {"old": "timing"}
    assert merged["config"]["addLayers"]["SKIP_COPY_CONFIG"] == {"old": "skip"}

    # Only one key changed
    assert changed_keys == ["config.addLayers.LAYER_NAME_CONFIG"]


def test_deep_merge_replace_present_no_changes():
    """When converted values match preset, no changes tracked."""
    preset = {
        "config": {
            "addLayers": {"LAYER_NAME_CONFIG": {"key": "value"}},
        }
    }
    converted = {
        "config": {
            "addLayers": {"LAYER_NAME_CONFIG": {"key": "value"}},
        }
    }
    merged, changed_keys = _deep_merge_replace_present(preset, converted)

    assert merged["config"]["addLayers"]["LAYER_NAME_CONFIG"] == {"key": "value"}
    assert changed_keys == []


def test_deep_merge_replace_present_creates_missing_namespaces():
    """Merge creates config, addLayers, modular if missing."""
    preset = {"other_data": "value"}
    converted = {
        "config": {
            "addLayers": {"LAYER_NAME_CONFIG": {"new": "value"}},
            "modular": {"MODULE_MAP": {"new": "map"}},
        }
    }
    merged, changed_keys = _deep_merge_replace_present(preset, converted)

    assert merged["config"]["addLayers"]["LAYER_NAME_CONFIG"] == {"new": "value"}
    assert merged["config"]["modular"]["MODULE_MAP"] == {"new": "map"}
    assert merged["other_data"] == "value"
    assert len(changed_keys) == 2


def test_deep_merge_replace_present_top_level_shape():
    """pipeline.preset top-level addLayers/modular is merged in-place."""
    preset = {
        "addLayers": {"TIMING_BEHAVIOR": {"old": "timing"}},
        "modular": {"ENABLED": False, "MODULE_MAP": {"old": "map"}},
    }
    converted = {
        "config": {
            "addLayers": {"LAYER_NAME_CONFIG": {"logo": {"exact": [], "contains": []}}},
            "modular": {
                "MODULE_MAP": {"A": {"ENABLED": True, "SOURCE_KEY": "controller_01"}}
            },
        }
    }

    merged, changed_keys = _deep_merge_replace_present(preset, converted)

    assert "config" not in merged
    assert "LAYER_NAME_CONFIG" in merged["addLayers"]
    assert merged["modular"]["ENABLED"] is False
    assert merged["modular"]["MODULE_MAP"]["A"]["ENABLED"] is True
    assert "addLayers.LAYER_NAME_CONFIG" in changed_keys
    assert "modular.MODULE_MAP" in changed_keys


# ──────────────────────────────────────────────────────────────────────────────
# merge_config_into_preset function tests
# ──────────────────────────────────────────────────────────────────────────────


def test_merge_config_into_preset_required_sheets_only():
    """Merge required sheets (LAYER_NAME_CONFIG, recenterRules) from XLSX."""
    openpyxl = pytest.importorskip("openpyxl")
    d = tempfile.mkdtemp()
    try:
        # Create XLSX with required sheets only
        xlsx = os.path.join(d, "config.xlsx")
        _write_minimal_xlsx(
            openpyxl,
            xlsx,
            layer_rows=[["logo", "logo_01", ""]],
            rule_rows=[["Logo", "BG", "Claim", "Disclaimer"]],
        )

        # Create input preset
        preset_in = os.path.join(d, "preset_in.json")
        preset_data = {
            "addLayers": {
                "LAYER_NAME_CONFIG": {"old": "value"},
                "TIMING_BEHAVIOR": {"existing": "timing"},
                "other_key": "preserve_me",
            },
            "other_section": {"keep": "this"},
        }
        _write_json(preset_in, preset_data)

        # Merge
        preset_out = os.path.join(d, "preset_out.json")
        changed_keys = merge_config_into_preset(
            xlsx_path=xlsx,
            preset_path=preset_in,
            output_path=preset_out,
        )

        # Verify output file exists and is valid JSON
        assert os.path.isfile(preset_out)
        with open(preset_out, "r", encoding="utf-8") as f:
            merged = json.load(f)

        # Required sheets replaced
        assert "LAYER_NAME_CONFIG" in merged["addLayers"]
        assert "recenterRules" in merged["addLayers"]["LAYER_NAME_CONFIG"]

        # Optional sheets untouched
        assert merged["addLayers"]["TIMING_BEHAVIOR"] == {"existing": "timing"}
        assert merged["addLayers"]["other_key"] == "preserve_me"

        # Other sections preserved
        assert merged["other_section"]["keep"] == "this"

        # Changed keys tracked
        assert "addLayers.LAYER_NAME_CONFIG" in changed_keys
    finally:
        _cleanup_dir(d)


def test_merge_config_into_preset_with_optional_sheets():
    """Merge updates optional sheets when present in XLSX."""
    openpyxl = pytest.importorskip("openpyxl")
    d = tempfile.mkdtemp()
    try:
        # Create XLSX with optional sheets
        xlsx = os.path.join(d, "config.xlsx")
        _write_minimal_xlsx(
            openpyxl,
            xlsx,
            layer_rows=[["logo", "logo_01", ""]],
            rule_rows=[["Logo", "BG", "Claim", "Disclaimer"]],
            timing_rows=[["logo", "timed"], ["logo_02", "span"]],
            selector_rows=[["logo", "line", 1]],
        )

        # Create input preset
        preset_in = os.path.join(d, "preset_in.json")
        preset_data = {
            "config": {
                "addLayers": {
                    "TIMING_BEHAVIOR": {"old": "timing"},
                    "TIMING_ITEM_SELECTOR": {"old": "selector"},
                },
            }
        }
        _write_json(preset_in, preset_data)

        # Merge
        preset_out = os.path.join(d, "preset_out.json")
        changed_keys = merge_config_into_preset(
            xlsx_path=xlsx,
            preset_path=preset_in,
            output_path=preset_out,
        )

        with open(preset_out, "r", encoding="utf-8") as f:
            merged = json.load(f)

        # Optional sheets replaced
        assert merged["config"]["addLayers"]["TIMING_BEHAVIOR"]["logo"] == "timed"
        assert (
            merged["config"]["addLayers"]["TIMING_ITEM_SELECTOR"]["logo"]["mode"]
            == "line"
        )

        # Changed keys tracked
        assert "config.addLayers.TIMING_BEHAVIOR" in changed_keys
        assert "config.addLayers.TIMING_ITEM_SELECTOR" in changed_keys
    finally:
        _cleanup_dir(d)


def test_merge_config_into_preset_modular_sheets():
    """Merge modular sheets (MODULE_MAP, EXPLICIT_VARIANTS_BY_VIDEOID)."""
    openpyxl = pytest.importorskip("openpyxl")
    d = tempfile.mkdtemp()
    try:
        # Create XLSX with modular sheets
        xlsx = os.path.join(d, "config.xlsx")
        _write_minimal_xlsx(
            openpyxl,
            xlsx,
            layer_rows=[["logo", "logo_01", ""]],
            rule_rows=[["Logo", "BG", "Claim", "Disclaimer"]],
            module_map_rows=[
                ["A", "TRUE", "controller_01"],
                ["B", "FALSE", "controller_02"],
            ],
            explicit_variants_rows=[
                ["Travel_20s", "A1_B1;A2_B2"],
            ],
        )

        # Create input preset
        preset_in = os.path.join(d, "preset_in.json")
        preset_data = {
            "config": {
                "modular": {
                    "MODULE_MAP": {"old": "map"},
                    "EXPLICIT_VARIANTS_BY_VIDEOID": {"old": "variants"},
                    "ENABLED": False,
                }
            }
        }
        _write_json(preset_in, preset_data)

        # Merge
        preset_out = os.path.join(d, "preset_out.json")
        changed_keys = merge_config_into_preset(
            xlsx_path=xlsx,
            preset_path=preset_in,
            output_path=preset_out,
        )

        with open(preset_out, "r", encoding="utf-8") as f:
            merged = json.load(f)

        # Modular sheets replaced
        assert merged["config"]["modular"]["MODULE_MAP"]["A"]["ENABLED"] is True
        assert (
            "Travel_20s" in merged["config"]["modular"]["EXPLICIT_VARIANTS_BY_VIDEOID"]
        )

        # Other modular keys preserved
        assert merged["config"]["modular"]["ENABLED"] is False

        # Changed keys tracked
        assert "config.modular.MODULE_MAP" in changed_keys
        assert "config.modular.EXPLICIT_VARIANTS_BY_VIDEOID" in changed_keys
    finally:
        _cleanup_dir(d)


def test_merge_config_into_preset_idempotency():
    """Merging twice produces identical result."""
    openpyxl = pytest.importorskip("openpyxl")
    d = tempfile.mkdtemp()
    try:
        # Create XLSX
        xlsx = os.path.join(d, "config.xlsx")
        _write_minimal_xlsx(
            openpyxl,
            xlsx,
            layer_rows=[["logo", "logo_01", ""]],
            rule_rows=[["Logo", "BG", "Claim", "Disclaimer"]],
            timing_rows=[["logo", "timed"]],
        )

        # Create input preset
        preset_in = os.path.join(d, "preset_in.json")
        preset_data = {
            "config": {
                "addLayers": {
                    "TIMING_BEHAVIOR": {"other": "value"},
                }
            }
        }
        _write_json(preset_in, preset_data)

        # First merge
        preset_1 = os.path.join(d, "preset_1.json")
        merge_config_into_preset(
            xlsx_path=xlsx,
            preset_path=preset_in,
            output_path=preset_1,
        )

        # Second merge (using first output as input)
        preset_2 = os.path.join(d, "preset_2.json")
        changed_keys = merge_config_into_preset(
            xlsx_path=xlsx,
            preset_path=preset_1,
            output_path=preset_2,
        )

        # No changes on second merge (idempotent)
        assert changed_keys == []

        # Outputs are identical
        with open(preset_1, "r", encoding="utf-8") as f:
            result_1 = json.load(f)
        with open(preset_2, "r", encoding="utf-8") as f:
            result_2 = json.load(f)
        assert result_1 == result_2
    finally:
        _cleanup_dir(d)


# ──────────────────────────────────────────────────────────────────────────────
# CLI tests
# ──────────────────────────────────────────────────────────────────────────────


def test_merge_cli_missing_input_files():
    """CLI fails gracefully when input files don't exist."""
    proc = _run(
        _MERGE_TOOL,
        "/nonexistent/config.xlsx",
        "/nonexistent/preset.json",
        "/tmp/out.json",
    )
    assert proc.returncode != 0
    assert "No such file or directory" in proc.stderr


def test_merge_cli_empty_separator():
    """CLI rejects empty separator."""
    openpyxl = pytest.importorskip("openpyxl")
    d = tempfile.mkdtemp()
    try:
        xlsx = os.path.join(d, "config.xlsx")
        preset_in = os.path.join(d, "preset_in.json")
        out = os.path.join(d, "out.json")

        _write_minimal_xlsx(openpyxl, xlsx)
        _write_json(preset_in, {"config": {"addLayers": {}}})

        proc = _run(
            _MERGE_TOOL,
            xlsx,
            preset_in,
            out,
            "--separator",
            "",
        )
        assert proc.returncode != 0
        assert "--separator must not be empty" in (proc.stdout + proc.stderr)
    finally:
        _cleanup_dir(d)


def test_merge_cli_dry_run_no_output_file():
    """Dry-run prints summary but doesn't write output file."""
    openpyxl = pytest.importorskip("openpyxl")
    d = tempfile.mkdtemp()
    try:
        xlsx = os.path.join(d, "config.xlsx")
        preset_in = os.path.join(d, "preset_in.json")
        out = os.path.join(d, "out.json")

        _write_minimal_xlsx(
            openpyxl,
            xlsx,
            layer_rows=[["logo", "logo_01", ""]],
            rule_rows=[["Logo", "BG", "Claim", "Disclaimer"]],
            timing_rows=[["logo", "timed"]],
        )
        _write_json(
            preset_in, {"config": {"addLayers": {"TIMING_BEHAVIOR": {"old": "value"}}}}
        )

        proc = _run(_MERGE_TOOL, xlsx, preset_in, out, "--dry-run")
        assert proc.returncode == 0
        assert "Will update" in proc.stdout
        assert "config.addLayers.TIMING_BEHAVIOR" in proc.stdout
        assert "(dry-run: no output file written)" in proc.stdout
        assert not os.path.exists(out), "dry-run must not write output file"
    finally:
        _cleanup_dir(d)


def test_merge_cli_dry_run_no_changes():
    """Dry-run reports when converted config matches preset exactly."""
    openpyxl = pytest.importorskip("openpyxl")
    d = tempfile.mkdtemp()
    try:
        xlsx = os.path.join(d, "config.xlsx")
        preset_in = os.path.join(d, "preset_in.json")
        out = os.path.join(d, "out.json")

        _write_minimal_xlsx(openpyxl, xlsx, layer_rows=[["logo", "logo_01", ""]])
        # Preset already has LAYER_NAME_CONFIG matching the XLSX
        _write_json(
            preset_in,
            {
                "config": {
                    "addLayers": {
                        "LAYER_NAME_CONFIG": {
                            "logo": {"exact": ["logo_01"], "contains": []},
                            "recenterRules": {
                                "force": ["Logo"],
                                "noRecenter": ["BG"],
                                "alignH": ["Claim"],
                                "alignV": ["Disclaimer"],
                            },
                        }
                    }
                }
            },
        )

        proc = _run(_MERGE_TOOL, xlsx, preset_in, out, "--dry-run")
        assert proc.returncode == 0
        assert "No changes detected" in proc.stdout
    finally:
        _cleanup_dir(d)


def test_merge_cli_output_written():
    """CLI writes output file successfully."""
    openpyxl = pytest.importorskip("openpyxl")
    d = tempfile.mkdtemp()
    try:
        xlsx = os.path.join(d, "config.xlsx")
        preset_in = os.path.join(d, "preset_in.json")
        out = os.path.join(d, "out.json")

        _write_minimal_xlsx(openpyxl, xlsx)
        _write_json(preset_in, {"config": {"addLayers": {}}})

        proc = _run(_MERGE_TOOL, xlsx, preset_in, out)
        assert proc.returncode == 0
        assert os.path.isfile(out)

        with open(out, "r", encoding="utf-8") as f:
            result = json.load(f)
        assert "config" in result
        assert "addLayers" in result["config"]
    finally:
        _cleanup_dir(d)


def test_merge_cli_separator_passthrough():
    """CLI separator option is passed to converter correctly."""
    openpyxl = pytest.importorskip("openpyxl")
    d = tempfile.mkdtemp()
    try:
        xlsx = os.path.join(d, "config.xlsx")
        preset_in = os.path.join(d, "preset_in.json")
        out = os.path.join(d, "out.json")

        _write_minimal_xlsx(
            openpyxl,
            xlsx,
            layer_rows=[["logo", "logo_01;logo_02", "contains;values"]],
        )
        _write_json(preset_in, {"config": {"addLayers": {}}})

        # Use semicolon separator (explicit)
        proc = _run(
            _MERGE_TOOL,
            xlsx,
            preset_in,
            out,
            "--separator",
            ";",
        )
        assert proc.returncode == 0

        with open(out, "r", encoding="utf-8") as f:
            result = json.load(f)
        layer_config = result["config"]["addLayers"]["LAYER_NAME_CONFIG"]["logo"]
        assert layer_config["exact"] == ["logo_01", "logo_02"]
        assert layer_config["contains"] == ["contains", "values"]
    finally:
        _cleanup_dir(d)


def test_merge_cli_indent_passthrough():
    """CLI indent option is passed to converter and affects output format."""
    openpyxl = pytest.importorskip("openpyxl")
    d = tempfile.mkdtemp()
    try:
        xlsx = os.path.join(d, "config.xlsx")
        preset_in = os.path.join(d, "preset_in.json")
        out_compact = os.path.join(d, "out_compact.json")
        out_indent = os.path.join(d, "out_indent.json")

        _write_minimal_xlsx(openpyxl, xlsx)
        _write_json(preset_in, {"config": {"addLayers": {}}})

        # Compact output (indent=0)
        proc = _run(_MERGE_TOOL, xlsx, preset_in, out_compact, "--indent", "0")
        assert proc.returncode == 0

        # Indented output (indent=2)
        proc = _run(_MERGE_TOOL, xlsx, preset_in, out_indent, "--indent", "2")
        assert proc.returncode == 0

        # Compact output should be shorter
        with open(out_compact, "r", encoding="utf-8") as f:
            compact_size = len(f.read())
        with open(out_indent, "r", encoding="utf-8") as f:
            indent_size = len(f.read())
        assert compact_size < indent_size
    finally:
        _cleanup_dir(d)


def test_merge_cli_indent_3_array_flattening():
    """CLI indent=3 produces inline arrays in merged output."""
    openpyxl = pytest.importorskip("openpyxl")
    d = tempfile.mkdtemp()
    try:
        xlsx = os.path.join(d, "config.xlsx")
        preset_in = os.path.join(d, "preset_in.json")
        out = os.path.join(d, "out.json")

        # Create XLSX with multi-value arrays in items
        _write_minimal_xlsx(
            openpyxl,
            xlsx,
            layer_rows=[
                ["logo", "logo_01;logo_02", ""],
                ["text", "text_01", "contains_text"],
            ],
            rule_rows=[["Logo", "Claim", "Disclaimer", "Top"]],
        )
        _write_json(preset_in, {"config": {"addLayers": {}}})

        # Run with indent=3 and separator=; (array flattening)
        proc = _run(
            _MERGE_TOOL,
            xlsx,
            preset_in,
            out,
            "--indent",
            "3",
            "--separator",
            ";",
        )
        assert proc.returncode == 0

        # Read output as raw text to verify inline array format
        with open(out, "r", encoding="utf-8") as f:
            output_text = f.read()

        # Verify inline arrays (e.g., ["logo_01", "logo_02"] on single lines)
        # Indent=3 produces no whitespace inside arrays, so they appear inline
        assert '["logo_01", "logo_02"]' in output_text
        assert '["text_01"]' in output_text
        assert '["contains_text"]' in output_text

        # Verify it's valid JSON and arrays are correctly split
        with open(out, "r", encoding="utf-8") as f:
            result = json.load(f)
        assert "config" in result
        layer_config = result["config"]["addLayers"]["LAYER_NAME_CONFIG"]
        assert layer_config["logo"]["exact"] == ["logo_01", "logo_02"]
        assert layer_config["text"]["exact"] == ["text_01"]
        assert layer_config["text"]["contains"] == ["contains_text"]
    finally:
        _cleanup_dir(d)
