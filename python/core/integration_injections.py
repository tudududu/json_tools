from __future__ import annotations

import copy
from typing import Any, Dict, Tuple


def inject_media_mapping(
    payload: Dict[str, Any],
    country_code: str,
    media_groups_map: Dict[Tuple[str, str], Dict[str, Any]],
) -> None:
    if not media_groups_map:
        return
    mg = payload.get("metadataGlobal") if isinstance(payload, dict) else None
    if not isinstance(mg, dict):
        return
    try:
        lang = str(mg.get("language") or "").strip()
    except Exception:
        lang = ""
    media_map = media_groups_map.get((country_code, lang))
    if not media_map:
        return

    config = payload.setdefault("config", {})
    if isinstance(config, dict):
        pack = config.setdefault("pack", {})
        if isinstance(pack, dict):
            pack["EXTRA_OUTPUT_COMPS"] = media_map


def inject_layer_config_payload(
    payload: Dict[str, Any],
    layer_config_payload: Dict[str, Any] | None,
) -> None:
    if not layer_config_payload:
        return
    config = payload.setdefault("config", {})
    if isinstance(config, dict):
        config["addLayers"] = copy.deepcopy(layer_config_payload)
