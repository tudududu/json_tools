import re
import sys
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple


_CONTROLLER_RECORD_RE = re.compile(r"^controller_(\d+)$", re.I)
_CONTROLLER_FLAG_RE = re.compile(r"^controller_(\d+)_flag$", re.I)


@dataclass
class UnifiedState:
    global_meta: Dict[str, Any] = field(default_factory=dict)
    job_number_per_country: Dict[str, str] = field(default_factory=dict)
    language_per_country: Dict[str, str] = field(default_factory=dict)
    videos: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    video_order: List[str] = field(default_factory=list)
    per_video_meta_local_country: Dict[str, Dict[str, Dict[str, Any]]] = field(
        default_factory=dict
    )
    global_flag_defaults_per_country: Dict[str, Dict[str, str]] = field(
        default_factory=dict
    )
    global_flag_targeted_per_country: Dict[str, Dict[str, Dict[str, str]]] = field(
        default_factory=dict
    )
    global_flags_seen: set[str] = field(default_factory=set)
    warned_logo_anim_legacy_country_scope: bool = False


def normalize_controller_record(name: str) -> Optional[str]:
    m = _CONTROLLER_RECORD_RE.match((name or "").strip())
    if not m:
        return None
    return f"controller_{int(m.group(1)):02d}"


def normalize_controller_flag(name: str) -> Optional[str]:
    m = _CONTROLLER_FLAG_RE.match((name or "").strip())
    if not m:
        return None
    return f"controller_{int(m.group(1)):02d}_flag"


def normalize_flag_key(name: str) -> Optional[str]:
    normalized_controller = normalize_controller_flag(name)
    if normalized_controller:
        return normalized_controller
    key = (name or "").strip()
    if key.lower().endswith("_flag"):
        return key
    return None


def normalize_duration_token(value: str) -> str:
    token = (value or "").strip()
    if not token:
        return ""
    if re.fullmatch(r"\d+", token):
        return str(int(token))
    return token


def collect_country_texts(
    row: List[str],
    countries: List[str],
    country_orientation_cols: Dict[str, Dict[str, Optional[int]]],
) -> Tuple[Dict[str, str], Dict[str, str]]:
    texts: Dict[str, str] = {}
    texts_portrait: Dict[str, str] = {}
    for c in countries:
        land_idx = country_orientation_cols[c]["landscape"]
        port_idx = country_orientation_cols[c]["portrait"]
        land_val = (
            row[land_idx].replace("\r", "").rstrip()
            if land_idx is not None and land_idx < len(row)
            else ""
        )
        port_val = (
            row[port_idx].replace("\r", "").rstrip()
            if port_idx is not None and port_idx < len(row)
            else ""
        )
        texts[c] = land_val
        texts_portrait[c] = port_val
    return texts, texts_portrait


def propagate_all_scope_texts(
    country_scope_val: str,
    texts: Dict[str, str],
    texts_portrait: Dict[str, str],
    countries: List[str],
) -> None:
    if country_scope_val != "ALL":
        return
    base_land = next((texts[c] for c in countries if texts[c]), "")
    base_port = next((texts_portrait[c] for c in countries if texts_portrait[c]), "")
    if base_land:
        for c in countries:
            if not texts[c]:
                texts[c] = base_land
    if base_port:
        for c in countries:
            if not texts_portrait[c]:
                texts_portrait[c] = base_port


def process_meta_global_row(
    *,
    state: UnifiedState,
    key_name: str,
    countries: List[str],
    texts: Dict[str, str],
    texts_portrait: Dict[str, str],
    metadata_cell_val: str,
    target_duration_val: str,
    country_scope_raw: str,
) -> bool:
    if not key_name:
        return True

    if key_name == "jobNumber":
        for c in countries:
            per_country_val = (texts.get(c, "") or texts_portrait.get(c, "")).strip()
            if per_country_val:
                state.job_number_per_country[c] = per_country_val
            elif c not in state.job_number_per_country:
                state.job_number_per_country[c] = ""
        if metadata_cell_val:
            for c in countries:
                if state.job_number_per_country.get(c) in (None, ""):
                    state.job_number_per_country[c] = metadata_cell_val
        for c in countries:
            if state.job_number_per_country.get(c) is None:
                state.job_number_per_country[c] = "noJobNumber"
        return True

    flag_key_name = normalize_flag_key(key_name)
    if flag_key_name:
        state.global_flags_seen.add(flag_key_name)
        duration_subkey = normalize_duration_token(target_duration_val)
        if not duration_subkey and flag_key_name == "logo_anim_flag":
            duration_subkey = normalize_duration_token(country_scope_raw)
            if duration_subkey and not state.warned_logo_anim_legacy_country_scope:
                print(
                    "Warning: logo_anim_flag duration from 'country_scope' is deprecated; use 'target_duration' column.",
                    file=sys.stderr,
                )
                state.warned_logo_anim_legacy_country_scope = True

        for c in countries:
            if flag_key_name == "logo_anim_flag":
                per_val = (
                    texts_portrait.get(c, "")
                    or texts.get(c, "")
                    or metadata_cell_val
                ).strip()
            else:
                per_val = (
                    texts.get(c, "")
                    or texts_portrait.get(c, "")
                    or metadata_cell_val
                ).strip()
            if not per_val:
                continue
            if duration_subkey:
                state.global_flag_targeted_per_country.setdefault(c, {}).setdefault(
                    flag_key_name, {}
                )[duration_subkey] = per_val
            else:
                state.global_flag_defaults_per_country.setdefault(c, {})[
                    flag_key_name
                ] = per_val
        return True

    if key_name == "language":
        for ctry in countries:
            val = (
                texts_portrait.get(ctry, "")
                or texts.get(ctry, "")
                or metadata_cell_val
                or ""
            ).strip()
            state.language_per_country[ctry] = val
        return True

    country_val = next((texts[c] for c in countries if texts[c]), "")
    value = country_val or metadata_cell_val
    if value != "":
        state.global_meta[key_name] = value
    return True


def process_meta_local_row(
    *,
    state: UnifiedState,
    key_name: str,
    video_id: str,
    countries: List[str],
    texts: Dict[str, str],
    texts_portrait: Dict[str, str],
    metadata_cell_val: str,
) -> bool:
    if not key_name or not video_id:
        return True

    if video_id not in state.videos:
        state.videos[video_id] = {
            "metadata": {},
            "sub_rows": [],
            "super_a_rows": [],
            "super_b_rows": [],
        }
        state.video_order.append(video_id)

    local_flag_key = normalize_flag_key(key_name)
    if local_flag_key:
        if video_id not in state.per_video_meta_local_country:
            state.per_video_meta_local_country[video_id] = {}
        for c in countries:
            val = (texts.get(c, "") or texts_portrait.get(c, "")).strip()
            if not val and metadata_cell_val:
                val = metadata_cell_val.strip()
            if val:
                bucket = state.per_video_meta_local_country[video_id].setdefault(c, {})
                bucket[local_flag_key] = val
    else:
        country_val = next((texts[c] for c in countries if texts[c]), "")
        value = country_val or metadata_cell_val
        if value != "":
            state.videos[video_id]["metadata"][key_name] = value
    return True
