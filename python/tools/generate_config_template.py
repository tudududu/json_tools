#!/usr/bin/env python3
"""
Generate an Excel template for LAYER_NAME_CONFIG from a sample JSON file.

Output workbook shape:
- Sheet "LAYER_NAME_CONFIG_items" with columns: key, exact, contains
- Sheet "LAYER_NAME_CONFIG_recenterRules" with columns: force, noRecenter, alignH, alignV
- Sheet "TIMING_BEHAVIOR" (optional) with columns: layerName, behavior
- Sheet "TIMING_ITEM_SELECTOR" (optional) with columns: itemName, mode, value
"""

from __future__ import annotations

import argparse
import json
import os
from typing import TYPE_CHECKING, Dict, List, Optional, Sequence, cast

if TYPE_CHECKING:
    from openpyxl.worksheet.worksheet import Worksheet as WorksheetType

try:
    from openpyxl import Workbook as _Workbook
    from openpyxl.worksheet.datavalidation import DataValidation as _DataValidation
except Exception:
    _Workbook = None
    _DataValidation = None

RE_CENTER_KEYS: Sequence[str] = ("force", "noRecenter", "alignH", "alignV")
VALID_SELECTOR_MODES: Sequence[str] = ("line", "index", "minMax")


def _to_list(value: object) -> List[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    token = str(value).strip()
    return [token] if token else []


def generate_template(
    input_json: str,
    output_xlsx: str,
    separator: str,
    root_key: str,
    layer_names_sheet: str,
    recenter_rules_sheet: str,
    timing_behavior_sheet: Optional[str],
) -> None:
    if _Workbook is None:
        raise RuntimeError(
            "XLSX support requires openpyxl. Install with: pip install openpyxl"
        )

    with open(input_json, "r", encoding="utf-8") as f:
        raw = json.load(f)

    body: Optional[Dict[str, object]] = None
    timing_behavior_map: Optional[Dict[str, object]] = None
    timing_item_selector_map: Optional[Dict[str, object]] = None

    if root_key in raw and isinstance(raw[root_key], dict):
        body = raw[root_key]
        tb_raw = raw.get("TIMING_BEHAVIOR")
        if isinstance(tb_raw, dict):
            timing_behavior_map = tb_raw
        tis_raw = raw.get("TIMING_ITEM_SELECTOR")
        if isinstance(tis_raw, dict):
            timing_item_selector_map = tis_raw
    else:
        config = raw.get("config")
        if isinstance(config, dict):
            add_layers = config.get("addLayers")
            if isinstance(add_layers, dict):
                maybe_body = add_layers.get(root_key)
                if isinstance(maybe_body, dict):
                    body = maybe_body
                tb_raw = add_layers.get("TIMING_BEHAVIOR")
                if isinstance(tb_raw, dict):
                    timing_behavior_map = tb_raw
                tis_raw = add_layers.get("TIMING_ITEM_SELECTOR")
                if isinstance(tis_raw, dict):
                    timing_item_selector_map = tis_raw

    if body is None:
        raise ValueError(f"Root key not found or invalid: {root_key}")

    wb = _Workbook()
    ws_layers = cast("WorksheetType", wb.active)
    ws_layers.title = layer_names_sheet
    ws_layers.append(["key", "exact", "contains"])

    for key, value in body.items():
        if key == "recenterRules":
            continue
        if not isinstance(value, dict):
            continue

        exact = _to_list(value.get("exact"))
        contains = _to_list(value.get("contains"))
        ws_layers.append([key, separator.join(exact), separator.join(contains)])

    ws_rules = wb.create_sheet(title=recenter_rules_sheet)
    ws_rules.append(list(RE_CENTER_KEYS))

    recenter = body.get("recenterRules")
    if isinstance(recenter, dict):
        columns = {k: _to_list(recenter.get(k)) for k in RE_CENTER_KEYS}
    else:
        columns = {k: [] for k in RE_CENTER_KEYS}

    max_rows = max((len(columns[k]) for k in RE_CENTER_KEYS), default=0)
    for i in range(max_rows):
        ws_rules.append(
            [
                columns["force"][i] if i < len(columns["force"]) else "",
                columns["noRecenter"][i] if i < len(columns["noRecenter"]) else "",
                columns["alignH"][i] if i < len(columns["alignH"]) else "",
                columns["alignV"][i] if i < len(columns["alignV"]) else "",
            ]
        )

    if timing_behavior_sheet and timing_behavior_map is not None:
        ws_tb = wb.create_sheet(title=timing_behavior_sheet)
        ws_tb.append(["layerName", "behavior"])
        for layer_name, behavior in timing_behavior_map.items():
            ws_tb.append([str(layer_name), str(behavior)])

        if _DataValidation is not None:
            dv = _DataValidation(
                type="list", formula1='"timed,span,asIs"', allow_blank=True
            )
            ws_tb.add_data_validation(dv)
            # Lock behavior values in column B for template editing.
            dv.add(f"B2:B{max(ws_tb.max_row, 2)}")

    if timing_item_selector_map is not None:
        ws_tis = wb.create_sheet(title="TIMING_ITEM_SELECTOR")
        ws_tis.append(["itemName", "mode", "value"])
        for item_name, config_value in timing_item_selector_map.items():
            if not isinstance(config_value, dict):
                continue
            mode = config_value.get("mode", "")
            value = config_value.get("value", "")
            ws_tis.append([str(item_name), str(mode), value])

        if _DataValidation is not None:
            dv = _DataValidation(
                type="list", formula1='"line,index,minMax"', allow_blank=True
            )
            ws_tis.add_data_validation(dv)
            dv.add(f"B2:B{max(ws_tis.max_row, 2)}")

    os.makedirs(os.path.dirname(output_xlsx) or ".", exist_ok=True)
    wb.save(output_xlsx)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate LAYER_NAME_CONFIG Excel template from JSON sample"
    )
    parser.add_argument("input", help="Path to input JSON sample")
    parser.add_argument("output", help="Path to output XLSX template")
    parser.add_argument(
        "--separator",
        default="; ",
        help="Separator used when writing list cells (default '; ')",
    )
    parser.add_argument(
        "--root-key",
        default="LAYER_NAME_CONFIG",
        help="Root key in input JSON (default LAYER_NAME_CONFIG)",
    )
    parser.add_argument(
        "--layer-names-sheet",
        default="LAYER_NAME_CONFIG_items",
        help="Name of the layer names sheet to create (default LAYER_NAME_CONFIG_items)",
    )
    parser.add_argument(
        "--recenter-rules-sheet",
        default="LAYER_NAME_CONFIG_recenterRules",
        help="Name of the recenter rules sheet to create (default LAYER_NAME_CONFIG_recenterRules)",
    )
    parser.add_argument(
        "--timing-behavior-sheet",
        default="TIMING_BEHAVIOR",
        help="TIMING_BEHAVIOR sheet name (created by default when input JSON contains config.addLayers.TIMING_BEHAVIOR)",
    )
    args = parser.parse_args()

    if not os.path.isfile(args.input):
        raise SystemExit(f"No such file or directory: '{args.input}'")

    generate_template(
        input_json=args.input,
        output_xlsx=args.output,
        separator=args.separator,
        root_key=args.root_key,
        layer_names_sheet=args.layer_names_sheet,
        recenter_rules_sheet=args.recenter_rules_sheet,
        timing_behavior_sheet=args.timing_behavior_sheet,
    )


if __name__ == "__main__":
    main()
