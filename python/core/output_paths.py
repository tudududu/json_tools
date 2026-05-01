from __future__ import annotations

import os
from typing import Any, Dict, Optional


def ensure_country_placeholder(pattern: str) -> str:
    if "{country}" in pattern:
        return pattern
    root, ext = os.path.splitext(pattern)
    return f"{root}_{{country}}{ext}"


def build_country_token(country_code: str, metadata_global: Any) -> str:
    lang = ""
    if isinstance(metadata_global, dict):
        try:
            lang = str(metadata_global.get("language") or "").strip()
        except Exception:
            lang = ""
    return f"{country_code}_{lang}" if lang else country_code


def resolve_country_output_path(
    pattern: str,
    country_code: str,
    metadata_global: Any,
) -> str:
    return ensure_country_placeholder(pattern).replace(
        "{country}",
        build_country_token(country_code, metadata_global),
    )


def resolve_single_country_output_path(
    output: str,
    output_pattern: Optional[str],
    country_code: str,
    metadata_global: Any,
) -> str:
    if "{country}" in (output or ""):
        return output.replace(
            "{country}",
            build_country_token(country_code, metadata_global),
        )

    if output_pattern:
        return resolve_country_output_path(
            pattern=output_pattern,
            country_code=country_code,
            metadata_global=metadata_global,
        )

    return output


def trim_logo_anim_flag_for_country(payload: Dict[str, Any], country_code: str) -> None:
    mg = payload.get("metadataGlobal") if isinstance(payload, dict) else None
    if not isinstance(mg, dict) or "logo_anim_flag" not in mg:
        return

    overview = mg["logo_anim_flag"]
    if not isinstance(overview, dict):
        return

    trimmed: Dict[str, Any] = {}
    for dur, val in overview.items():
        if isinstance(val, dict) and "_default" in val:
            trimmed[dur] = val.get(country_code, val.get("_default"))
        else:
            trimmed[dur] = val
    mg["logo_anim_flag"] = trimmed
