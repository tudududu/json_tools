#!/usr/bin/env python3
"""
Shared sheet name configuration for config_converter.py and generate_config_template.py.

Defines the mapping between JSON object names (keys) and XLSX sheet names.
All sheet names can be customized here; JSON keys are fixed.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class SheetConfig:
    """Sheet metadata: maps JSON key to XLSX sheet name."""

    json_key: str
    """JSON object key name (e.g., TIMING_BEHAVIOR, MODULE_MAP). Fixed across tools."""

    default_sheet_name: str
    """Default XLSX sheet name for this key. Customizable point."""

    is_required: bool
    """If True, sheet must exist; conversion fails if missing."""

    namespace: Literal["addLayers", "modular"]
    """Where in JSON this key belongs: config.addLayers or config.modular."""


# All sheets: required and optional
SHEETS = [
    # Required sheets (must exist in workbook)
    SheetConfig(
        json_key="LAYER_NAME_CONFIG_items",
        default_sheet_name="a_LAYER_NAME_CONFIG_items",
        is_required=True,
        namespace="addLayers",
    ),
    SheetConfig(
        json_key="LAYER_NAME_CONFIG_recenterRules",
        default_sheet_name="a_LAYER_NAME_CONFIG_recenterRul",
        is_required=True,
        namespace="addLayers",
    ),
    # Optional sheets (addLayers namespace)
    SheetConfig(
        json_key="TIMING_BEHAVIOR",
        default_sheet_name="a_TIMING_BEHAVIOR",
        is_required=False,
        namespace="addLayers",
    ),
    SheetConfig(
        json_key="TIMING_ITEM_SELECTOR",
        default_sheet_name="a_TIMING_ITEM_SELECTOR",
        is_required=False,
        namespace="addLayers",
    ),
    SheetConfig(
        json_key="SKIP_COPY_CONFIG",
        default_sheet_name="a_SKIP_COPY_CONFIG",
        is_required=False,
        namespace="addLayers",
    ),
    # Optional sheets (modular namespace)
    SheetConfig(
        json_key="MODULE_MAP",
        default_sheet_name="m_MODULE_MAP",
        is_required=False,
        namespace="modular",
    ),
    SheetConfig(
        json_key="EXPLICIT_VARIANTS_BY_VIDEOID",
        default_sheet_name="m_EXPLICIT_VARIANTS_BY_VIDEOID",
        is_required=False,
        namespace="modular",
    ),
]

# Convenience lookup by json_key
SHEETS_BY_KEY = {sheet.json_key: sheet for sheet in SHEETS}

# Convenience lookup by namespace
SHEETS_BY_NAMESPACE = {
    "addLayers": [s for s in SHEETS if s.namespace == "addLayers"],
    "modular": [s for s in SHEETS if s.namespace == "modular"],
}
