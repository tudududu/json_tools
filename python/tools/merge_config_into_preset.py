#!/usr/bin/env python3
"""
Merge converted XLSX config into an AE pipeline preset JSON.

Reads an XLSX workbook via config_converter, then merges the converted config
(addLayers and modular namespaces) into an existing pipeline preset file,
replacing only keys that are present in the conversion result while preserving
all other preset data untouched (replace-present mode).

Target keys that may be replaced (if present in converted result):
- addLayers: LAYER_NAME_CONFIG, TIMING_BEHAVIOR, TIMING_ITEM_SELECTOR, SKIP_COPY_CONFIG
- modular: MODULE_MAP, EXPLICIT_VARIANTS_BY_VIDEOID

Preset shape support:
- Preferred: top-level namespaces (`addLayers`, `modular`) used by pipeline.preset.json
- Backward-compatible: nested namespaces under `config`.
"""

from __future__ import annotations

import argparse
import json
import os
from typing import Any, Dict, List

from .config_converter import convert_workbook


def _deep_merge_replace_present(
    preset: Dict[str, Any], converted_config: Dict[str, Any]
) -> tuple[Dict[str, Any], List[str]]:
    """
    Merge converted config into preset, replacing only keys present in converted result.

    Returns (merged_preset, list_of_changed_keys).
    """
    changed_keys: List[str] = []
    preset = dict(preset)  # shallow copy for top level

    # Detect where namespaces live in the target preset.
    # pipeline.preset.json uses top-level addLayers/modular.
    if isinstance(preset.get("addLayers"), dict) or isinstance(
        preset.get("modular"), dict
    ):
        target_container = preset
        path_prefix = ""
    else:
        config = preset.get("config")
        if not isinstance(config, dict):
            config = {}
            preset["config"] = config
        else:
            config = dict(config)  # shallow copy
            preset["config"] = config
        target_container = config
        path_prefix = "config."

    converted = converted_config.get("config", {})

    # Handle addLayers namespace
    add_layers_converted = converted.get("addLayers")
    if isinstance(add_layers_converted, dict):
        add_layers = target_container.get("addLayers")
        if not isinstance(add_layers, dict):
            add_layers = {}
            target_container["addLayers"] = add_layers
        else:
            add_layers = dict(add_layers)  # shallow copy
            target_container["addLayers"] = add_layers

        for key in add_layers_converted:
            if add_layers.get(key) != add_layers_converted[key]:
                add_layers[key] = add_layers_converted[key]
                changed_keys.append(f"{path_prefix}addLayers.{key}")

    # Handle modular namespace
    modular_converted = converted.get("modular")
    if isinstance(modular_converted, dict):
        modular = target_container.get("modular")
        if not isinstance(modular, dict):
            modular = {}
            target_container["modular"] = modular
        else:
            modular = dict(modular)  # shallow copy
            target_container["modular"] = modular

        for key in modular_converted:
            if modular.get(key) != modular_converted[key]:
                modular[key] = modular_converted[key]
                changed_keys.append(f"{path_prefix}modular.{key}")

    return preset, changed_keys


def merge_config_into_preset(
    xlsx_path: str,
    preset_path: str,
    output_path: str,
    separator: str = ";",
    indent: int = 4,
) -> List[str]:
    """
    Merge XLSX config into a preset file using replace-present mode.

    Args:
        xlsx_path: Path to input XLSX config workbook
        preset_path: Path to input preset JSON file
        output_path: Path to output merged preset JSON file
        separator: Token separator for exact/contains cells (default: ';')
        indent: JSON output indentation (default: 4)

    Returns:
        List of changed keys (e.g., ['config.addLayers.LAYER_NAME_CONFIG', ...])
    """
    # Read preset
    with open(preset_path, "r", encoding="utf-8") as f:
        preset = json.load(f)

    # Convert XLSX to config
    converted = convert_workbook(
        in_path=xlsx_path,
        separator=separator,
    )

    # Merge using replace-present mode
    merged_preset, changed_keys = _deep_merge_replace_present(preset, converted)

    # Write output only if output_path is provided
    if output_path:
        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
        with open(output_path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(
                merged_preset,
                f,
                ensure_ascii=False,
                indent=None if indent <= 0 else indent,
            )
            f.write("\n")

    return changed_keys


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Merge converted XLSX config into AE pipeline preset JSON"
    )
    parser.add_argument("xlsx", help="Path to input XLSX config workbook")
    parser.add_argument("preset", help="Path to input pipeline preset JSON")
    parser.add_argument("output", help="Path to output merged preset JSON")
    parser.add_argument(
        "--separator",
        default=";",
        help="Token separator for exact/contains cells (default ';')",
    )
    parser.add_argument(
        "--indent",
        type=int,
        default=4,
        help="JSON output indentation (default 4; set 0 for compact)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and print summary of changes only (no output file written)",
    )
    args = parser.parse_args()

    if not args.separator:
        raise SystemExit("--separator must not be empty")
    if not os.path.isfile(args.xlsx):
        raise SystemExit(f"No such file or directory: '{args.xlsx}'")
    if not os.path.isfile(args.preset):
        raise SystemExit(f"No such file or directory: '{args.preset}'")

    changed_keys = merge_config_into_preset(
        xlsx_path=args.xlsx,
        preset_path=args.preset,
        output_path=args.output if not args.dry_run else "",
        separator=args.separator,
        indent=args.indent,
    )

    if not changed_keys:
        print("No changes detected in converted config.")
    else:
        print(f"Will update {len(changed_keys)} key(s):")
        for key in changed_keys:
            print(f"  - {key}")

    if args.dry_run:
        print("(dry-run: no output file written)")


if __name__ == "__main__":
    main()
