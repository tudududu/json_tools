#!/usr/bin/env python3
"""
Generate an Excel template for LAYER_NAME_CONFIG from a sample JSON file.

Output workbook shape:
- Sheet "LayerNames" with columns: key, exact, contains
- Sheet "RecenterRules" with columns: force, noRecenter, alignH, alignV
"""

from __future__ import annotations

import argparse
import json
import os
from typing import TYPE_CHECKING, Dict, List, Sequence, cast

if TYPE_CHECKING:
    from openpyxl.worksheet.worksheet import Worksheet as WorksheetType

try:
    from openpyxl import Workbook as _Workbook
except Exception:
    _Workbook = None

RE_CENTER_KEYS: Sequence[str] = ("force", "noRecenter", "alignH", "alignV")


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
) -> None:
    if _Workbook is None:
        raise RuntimeError(
            "XLSX support requires openpyxl. Install with: pip install openpyxl"
        )

    with open(input_json, "r", encoding="utf-8") as f:
        raw = json.load(f)

    if root_key not in raw or not isinstance(raw[root_key], dict):
        raise ValueError(f"Root key not found or invalid: {root_key}")

    body: Dict[str, object] = raw[root_key]

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
        default="LayerNames",
        help="Name of the layer names sheet to create (default LayerNames)",
    )
    parser.add_argument(
        "--recenter-rules-sheet",
        default="RecenterRules",
        help="Name of the recenter rules sheet to create (default RecenterRules)",
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
    )


if __name__ == "__main__":
    main()
