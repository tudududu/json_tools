import re
import sys
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple


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
    claims_rows: List[Dict[str, Any]] = field(default_factory=list)
    per_video_claim_rows: Dict[str, List[Dict[str, Any]]] = field(default_factory=dict)
    disc_rows_raw: List[Dict[str, Any]] = field(default_factory=list)
    per_video_disc_rows_raw: Dict[str, List[Dict[str, Any]]] = field(default_factory=dict)
    disc_02_rows_raw: List[Dict[str, Any]] = field(default_factory=list)
    per_video_disc_02_rows_raw: Dict[str, List[Dict[str, Any]]] = field(
        default_factory=dict
    )
    logo_rows_raw: List[Dict[str, Any]] = field(default_factory=list)
    per_video_logo_rows_raw: Dict[str, List[Dict[str, Any]]] = field(default_factory=dict)
    endframe_rows_raw: List[Dict[str, Any]] = field(default_factory=list)
    per_video_endframe_rows_raw: Dict[str, List[Dict[str, Any]]] = field(
        default_factory=dict
    )
    controller_rows_raw: Dict[str, List[Dict[str, Any]]] = field(default_factory=dict)
    per_video_controller_rows_raw: Dict[str, Dict[str, List[Dict[str, Any]]]] = field(
        default_factory=dict
    )
    controller_keys_seen: set[str] = field(default_factory=set)
    auto_claim_line: int = 1
    auto_disc_line: int = 1
    auto_disc_02_line: int = 1
    auto_logo_line: int = 1
    auto_endframe_line: int = 1
    auto_claim_line_per_video: Dict[str, int] = field(default_factory=dict)
    auto_disc_line_per_video: Dict[str, int] = field(default_factory=dict)
    auto_disc_02_line_per_video: Dict[str, int] = field(default_factory=dict)
    auto_logo_line_per_video: Dict[str, int] = field(default_factory=dict)
    auto_endframe_line_per_video: Dict[str, int] = field(default_factory=dict)
    auto_controller_line_per_key: Dict[str, int] = field(default_factory=dict)
    auto_controller_line_per_video_per_key: Dict[str, Dict[str, int]] = field(
        default_factory=dict
    )
    auto_sub_line_per_video: Dict[str, int] = field(default_factory=dict)
    auto_super_a_line_per_video: Dict[str, int] = field(default_factory=dict)
    auto_super_b_line_per_video: Dict[str, int] = field(default_factory=dict)


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


def _ensure_video_bucket(state: UnifiedState, video_id: str) -> None:
    if video_id not in state.videos:
        state.videos[video_id] = {
            "metadata": {},
            "sub_rows": [],
            "super_a_rows": [],
            "super_b_rows": [],
        }
        state.video_order.append(video_id)


def process_claim_row(
    *,
    state: UnifiedState,
    video_id: str,
    line_num: Optional[int],
    start_tc: Optional[float],
    end_tc: Optional[float],
    texts: Dict[str, str],
    texts_portrait: Dict[str, str],
) -> bool:
    if video_id:
        if video_id not in state.per_video_claim_rows:
            state.per_video_claim_rows[video_id] = []
        if video_id not in state.auto_claim_line_per_video:
            state.auto_claim_line_per_video[video_id] = 1
        if line_num is None:
            line_num = state.auto_claim_line_per_video[video_id]
            state.auto_claim_line_per_video[video_id] += 1
        state.per_video_claim_rows[video_id].append(
            {
                "line": line_num,
                "start": start_tc,
                "end": end_tc,
                "texts": texts,
                "texts_portrait": texts_portrait,
            }
        )
    else:
        if line_num is None:
            line_num = state.auto_claim_line
            state.auto_claim_line += 1
        state.claims_rows.append(
            {
                "line": line_num,
                "start": start_tc,
                "end": end_tc,
                "texts": texts,
                "texts_portrait": texts_portrait,
            }
        )
    return True


def process_disclaimer_row(
    *,
    state: UnifiedState,
    video_id: str,
    line_num: Optional[int],
    start_tc: Optional[float],
    end_tc: Optional[float],
    texts: Dict[str, str],
    texts_portrait: Dict[str, str],
    is_disclaimer_02: bool,
) -> bool:
    if is_disclaimer_02:
        per_video_rows = state.per_video_disc_02_rows_raw
        global_rows = state.disc_02_rows_raw
        auto_line = state.auto_disc_02_line
        auto_line_per_video = state.auto_disc_02_line_per_video
    else:
        per_video_rows = state.per_video_disc_rows_raw
        global_rows = state.disc_rows_raw
        auto_line = state.auto_disc_line
        auto_line_per_video = state.auto_disc_line_per_video

    if video_id:
        if video_id not in per_video_rows:
            per_video_rows[video_id] = []
        if video_id not in auto_line_per_video:
            auto_line_per_video[video_id] = 1
        if line_num is None and (start_tc is not None or end_tc is not None):
            line_num = auto_line_per_video[video_id]
        if line_num is None:
            line_num = auto_line_per_video[video_id]
        else:
            auto_line_per_video[video_id] = line_num
        per_video_rows[video_id].append(
            {
                "line": line_num,
                "start": start_tc,
                "end": end_tc,
                "texts": texts,
                "texts_portrait": texts_portrait,
            }
        )
    else:
        if line_num is None and (start_tc is not None or end_tc is not None):
            line_num = auto_line
        if line_num is None:
            line_num = auto_line
        else:
            auto_line = line_num
        global_rows.append(
            {
                "line": line_num,
                "start": start_tc,
                "end": end_tc,
                "texts": texts,
                "texts_portrait": texts_portrait,
            }
        )

    if is_disclaimer_02:
        state.auto_disc_02_line = auto_line
    else:
        state.auto_disc_line = auto_line
    return True


def process_logo_row(
    *,
    state: UnifiedState,
    video_id: str,
    line_num: Optional[int],
    start_tc: Optional[float],
    end_tc: Optional[float],
    texts: Dict[str, str],
    texts_portrait: Dict[str, str],
) -> bool:
    if video_id:
        if video_id not in state.per_video_logo_rows_raw:
            state.per_video_logo_rows_raw[video_id] = []
        if video_id not in state.auto_logo_line_per_video:
            state.auto_logo_line_per_video[video_id] = 1
        if line_num is None and (start_tc is not None or end_tc is not None):
            line_num = state.auto_logo_line_per_video[video_id]
        if line_num is None:
            line_num = state.auto_logo_line_per_video[video_id]
        else:
            state.auto_logo_line_per_video[video_id] = line_num
        state.per_video_logo_rows_raw[video_id].append(
            {
                "line": line_num,
                "start": start_tc,
                "end": end_tc,
                "texts": texts,
                "texts_portrait": texts_portrait,
            }
        )
    else:
        if line_num is None and (start_tc is not None or end_tc is not None):
            line_num = state.auto_logo_line
        if line_num is None:
            line_num = state.auto_logo_line
        else:
            state.auto_logo_line = line_num
        state.logo_rows_raw.append(
            {
                "line": line_num,
                "start": start_tc,
                "end": end_tc,
                "texts": texts,
                "texts_portrait": texts_portrait,
            }
        )
    return True


def process_endframe_row(
    *,
    state: UnifiedState,
    video_id: str,
    line_num: Optional[int],
    start_tc: Optional[float],
    end_tc: Optional[float],
    texts: Dict[str, str],
    texts_portrait: Dict[str, str],
) -> bool:
    if video_id:
        if video_id not in state.per_video_endframe_rows_raw:
            state.per_video_endframe_rows_raw[video_id] = []
        if video_id not in state.auto_endframe_line_per_video:
            state.auto_endframe_line_per_video[video_id] = 1
        if line_num is None and (start_tc is not None or end_tc is not None):
            line_num = state.auto_endframe_line_per_video[video_id]
        if line_num is None:
            line_num = state.auto_endframe_line_per_video[video_id]
        else:
            state.auto_endframe_line_per_video[video_id] = line_num
        state.per_video_endframe_rows_raw[video_id].append(
            {
                "line": line_num,
                "start": start_tc,
                "end": end_tc,
                "texts": texts,
                "texts_portrait": texts_portrait,
            }
        )
    else:
        if line_num is None and (start_tc is not None or end_tc is not None):
            line_num = state.auto_endframe_line
        if line_num is None:
            line_num = state.auto_endframe_line
        else:
            state.auto_endframe_line = line_num
        state.endframe_rows_raw.append(
            {
                "line": line_num,
                "start": start_tc,
                "end": end_tc,
                "texts": texts,
                "texts_portrait": texts_portrait,
            }
        )
    return True


def process_sub_row(
    *,
    state: UnifiedState,
    video_id: str,
    line_num: Optional[int],
    start_tc: Optional[float],
    end_tc: Optional[float],
    texts: Dict[str, str],
    texts_portrait: Dict[str, str],
    start_line_index: int,
) -> bool:
    if not video_id:
        return True
    _ensure_video_bucket(state, video_id)
    if video_id not in state.auto_sub_line_per_video:
        state.auto_sub_line_per_video[video_id] = start_line_index
    if line_num is None:
        line_num = state.auto_sub_line_per_video[video_id]
        state.auto_sub_line_per_video[video_id] += 1
    else:
        state.auto_sub_line_per_video[video_id] = line_num + 1
    state.videos[video_id]["sub_rows"].append(
        {
            "line": line_num,
            "start": start_tc,
            "end": end_tc,
            "texts": texts,
            "texts_portrait": texts_portrait,
        }
    )
    return True


def process_super_a_row(
    *,
    state: UnifiedState,
    video_id: str,
    line_num: Optional[int],
    start_tc: Optional[float],
    end_tc: Optional[float],
    texts: Dict[str, str],
    texts_portrait: Dict[str, str],
    start_line_index: int,
) -> bool:
    if not video_id:
        return True
    _ensure_video_bucket(state, video_id)
    if video_id not in state.auto_super_a_line_per_video:
        state.auto_super_a_line_per_video[video_id] = start_line_index
    if line_num is None:
        line_num = state.auto_super_a_line_per_video[video_id]
        state.auto_super_a_line_per_video[video_id] += 1
    else:
        state.auto_super_a_line_per_video[video_id] = line_num + 1
    state.videos[video_id]["super_a_rows"].append(
        {
            "line": line_num,
            "start": start_tc,
            "end": end_tc,
            "texts": texts,
            "texts_portrait": texts_portrait,
        }
    )
    return True


def process_super_b_row(
    *,
    state: UnifiedState,
    video_id: str,
    line_num: Optional[int],
    start_tc: Optional[float],
    end_tc: Optional[float],
    texts: Dict[str, str],
    texts_portrait: Dict[str, str],
    start_line_index: int,
) -> bool:
    if not video_id:
        return True
    _ensure_video_bucket(state, video_id)
    if video_id not in state.auto_super_b_line_per_video:
        state.auto_super_b_line_per_video[video_id] = start_line_index
    if line_num is None:
        line_num = state.auto_super_b_line_per_video[video_id]
        state.auto_super_b_line_per_video[video_id] += 1
    else:
        state.auto_super_b_line_per_video[video_id] = line_num + 1
    state.videos[video_id]["super_b_rows"].append(
        {
            "line": line_num,
            "start": start_tc,
            "end": end_tc,
            "texts": texts,
            "texts_portrait": texts_portrait,
        }
    )
    return True


def process_controller_row(
    *,
    state: UnifiedState,
    controller_key: str,
    video_id: str,
    line_num: Optional[int],
    start_tc: Optional[float],
    end_tc: Optional[float],
    texts: Dict[str, str],
    texts_portrait: Dict[str, str],
    start_line_index: int,
) -> bool:
    state.controller_keys_seen.add(controller_key)
    if video_id:
        _ensure_video_bucket(state, video_id)
        state.per_video_controller_rows_raw.setdefault(controller_key, {})
        state.per_video_controller_rows_raw[controller_key].setdefault(video_id, [])
        state.auto_controller_line_per_video_per_key.setdefault(controller_key, {})
        if video_id not in state.auto_controller_line_per_video_per_key[controller_key]:
            state.auto_controller_line_per_video_per_key[controller_key][
                video_id
            ] = start_line_index
        if line_num is None:
            line_num = state.auto_controller_line_per_video_per_key[controller_key][
                video_id
            ]
            state.auto_controller_line_per_video_per_key[controller_key][
                video_id
            ] += 1
        else:
            state.auto_controller_line_per_video_per_key[controller_key][
                video_id
            ] = line_num + 1
        state.per_video_controller_rows_raw[controller_key][video_id].append(
            {
                "line": line_num,
                "start": start_tc,
                "end": end_tc,
                "texts": texts,
                "texts_portrait": texts_portrait,
            }
        )
    else:
        state.controller_rows_raw.setdefault(controller_key, [])
        if controller_key not in state.auto_controller_line_per_key:
            state.auto_controller_line_per_key[controller_key] = 1
        if line_num is None:
            line_num = state.auto_controller_line_per_key[controller_key]
            state.auto_controller_line_per_key[controller_key] += 1
        else:
            state.auto_controller_line_per_key[controller_key] = line_num + 1
        state.controller_rows_raw[controller_key].append(
            {
                "line": line_num,
                "start": start_tc,
                "end": end_tc,
                "texts": texts,
                "texts_portrait": texts_portrait,
            }
        )
    return True


def _clone_timed_text_row(
    row: Dict[str, Any],
    countries: List[str],
) -> Dict[str, Any]:
    return {
        "line": row["line"],
        "start": row["start"],
        "end": row["end"],
        "texts": {c: row["texts"][c] for c in countries},
        "texts_portrait": {
            c: row.get("texts_portrait", {}).get(c, "") for c in countries
        },
    }


def merge_disclaimer_blocks(
    rows_raw: List[Dict[str, Any]],
    countries: List[str],
    merge_enabled: bool,
) -> List[Dict[str, Any]]:
    if not merge_enabled:
        return rows_raw

    merged: List[Dict[str, Any]] = []
    current_block: Optional[Dict[str, Any]] = None
    for row in rows_raw:
        if row["start"] is not None and row["end"] is not None:
            if current_block:
                merged.append(current_block)
            current_block = _clone_timed_text_row(row, countries)
            continue

        if not current_block:
            current_block = _clone_timed_text_row(row, countries)
            continue

        for c in countries:
            extra = row["texts"][c]
            if extra:
                if current_block["texts"][c]:
                    current_block["texts"][c] += "\n" + extra
                else:
                    current_block["texts"][c] = extra

            extra_p = row.get("texts_portrait", {}).get(c, "")
            if extra_p:
                if current_block.get("texts_portrait", {}).get(c, ""):
                    current_block["texts_portrait"][c] += "\n" + extra_p
                else:
                    current_block["texts_portrait"][c] = extra_p

    if current_block:
        merged.append(current_block)
    return merged


def merge_disclaimer_rows_by_video(
    per_video_rows_raw: Dict[str, List[Dict[str, Any]]],
    countries: List[str],
    merge_enabled: bool,
) -> Dict[str, List[Dict[str, Any]]]:
    result: Dict[str, List[Dict[str, Any]]] = {}
    for vid, rows_raw in per_video_rows_raw.items():
        result[vid] = merge_disclaimer_blocks(
            rows_raw=rows_raw,
            countries=countries,
            merge_enabled=merge_enabled,
        )
    return result


def merge_rows_with_same_line(
    rows: List[Dict[str, Any]],
    countries: List[str],
    merge_enabled: bool,
) -> List[Dict[str, Any]]:
    if not merge_enabled:
        return rows

    merged: List[Dict[str, Any]] = []
    prev: Optional[Dict[str, Any]] = None
    for row in rows:
        if (
            prev
            and row["line"] == prev["line"]
            and (
                (row["start"] is None and row["end"] is None)
                or (row["start"] == prev["start"] and row["end"] == prev["end"])
            )
        ):
            for c in countries:
                t = row["texts"][c]
                if t:
                    if prev["texts"][c]:
                        prev["texts"][c] += "\n" + t
                    else:
                        prev["texts"][c] = t
                t_p = row.get("texts_portrait", {}).get(c, "")
                if t_p:
                    if prev.get("texts_portrait", {}).get(c, ""):
                        prev["texts_portrait"][c] += "\n" + t_p
                    else:
                        if "texts_portrait" not in prev:
                            prev["texts_portrait"] = {}
                        prev["texts_portrait"][c] = t_p
            continue

        if prev:
            merged.append(prev)
        prev = row

    if prev:
        merged.append(prev)
    return merged


def deduplicate_rows_by_line_timing(
    rows: List[Dict[str, Any]],
    countries: List[str],
) -> List[Dict[str, Any]]:
    grouped: Dict[Tuple[int, Optional[float], Optional[float]], Dict[str, Any]] = {}
    order: List[Tuple[int, Optional[float], Optional[float]]] = []
    for row in rows:
        key = (row["line"], row["start"], row["end"])
        if key not in grouped:
            grouped[key] = {
                "line": row["line"],
                "start": row["start"],
                "end": row["end"],
                "texts": {c: row["texts"].get(c, "") for c in countries},
                "texts_portrait": {
                    c: row.get("texts_portrait", {}).get(c, "") for c in countries
                },
            }
            order.append(key)
            continue

        for c in countries:
            extra_l = row["texts"].get(c, "")
            if extra_l:
                existing = grouped[key]["texts"][c]
                if not existing:
                    grouped[key]["texts"][c] = extra_l
                elif extra_l not in existing.split("\n"):
                    grouped[key]["texts"][c] += "\n" + extra_l

            extra_p = row.get("texts_portrait", {}).get(c, "")
            if extra_p:
                existing_p = grouped[key]["texts_portrait"][c]
                if not existing_p:
                    grouped[key]["texts_portrait"][c] = extra_p
                elif extra_p not in existing_p.split("\n"):
                    grouped[key]["texts_portrait"][c] += "\n" + extra_p

    return [grouped[k] for k in order]


def merge_and_dedup_video_rows(
    videos: Dict[str, Dict[str, Any]],
    countries: List[str],
    merge_subtitles: bool,
) -> None:
    row_keys = ("sub_rows", "super_a_rows", "super_b_rows")
    for _, vdata in videos.items():
        for row_key in row_keys:
            rows = vdata.get(row_key, [])
            if not rows:
                continue
            merged_rows = merge_rows_with_same_line(
                rows=rows,
                countries=countries,
                merge_enabled=merge_subtitles,
            )
            vdata[row_key] = deduplicate_rows_by_line_timing(
                rows=merged_rows,
                countries=countries,
            )


def _maybe_cast_metadata_value(value: Any, cast_metadata: bool) -> Any:
    if not cast_metadata:
        return value
    if isinstance(value, str):
        v = value.strip()
        if re.fullmatch(r"[-+]?[0-9]+", v):
            try:
                return int(v)
            except Exception:
                return value
        if re.fullmatch(r"[-+]?[0-9]*\.[0-9]+", v):
            try:
                return float(v)
            except Exception:
                return value
    return value


def build_country_orientation_data(
    *,
    country_code: str,
    claims_rows: List[Dict[str, Any]],
    disclaimers_rows_merged: List[Dict[str, Any]],
    disclaimers_02_rows_merged: List[Dict[str, Any]],
    logo_rows_raw: List[Dict[str, Any]],
    controller_keys_sorted: List[str],
    controller_rows_raw: Dict[str, List[Dict[str, Any]]],
    video_order: List[str],
    videos: Dict[str, Dict[str, Any]],
    global_flag_defaults_per_country: Dict[str, Dict[str, str]],
    global_flag_targeted_per_country: Dict[str, Dict[str, Dict[str, str]]],
    per_video_meta_local_country: Dict[str, Dict[str, Dict[str, Any]]],
    skip_empty_text: bool,
    fmt_time: Callable[[float], Any],
) -> Dict[str, Any]:
    claim_landscape: List[str] = []
    claim_portrait: List[str] = []
    for row in claims_rows:
        txt_l = (row["texts"].get(country_code, "") or "").rstrip()
        txt_p = (row.get("texts_portrait", {}).get(country_code, "") or "").rstrip()
        claim_landscape.append(txt_l)
        claim_portrait.append(txt_p if txt_p else txt_l)

    disc_landscape: List[str] = []
    disc_portrait: List[str] = []
    for row in disclaimers_rows_merged:
        txt_l = (row["texts"].get(country_code, "") or "").rstrip()
        txt_p = (row.get("texts_portrait", {}).get(country_code, "") or "").rstrip()
        disc_landscape.append(txt_l)
        disc_portrait.append(txt_p if txt_p else txt_l)
    if not disc_landscape:
        disc_landscape = [""]
    if not disc_portrait and disc_landscape:
        disc_portrait = disc_landscape.copy()

    disc_02_landscape: List[str] = []
    disc_02_portrait: List[str] = []
    for row in disclaimers_02_rows_merged:
        txt_l = (row["texts"].get(country_code, "") or "").rstrip()
        txt_p = (row.get("texts_portrait", {}).get(country_code, "") or "").rstrip()
        disc_02_landscape.append(txt_l)
        disc_02_portrait.append(txt_p if txt_p else txt_l)
    if not disc_02_landscape:
        disc_02_landscape = [""]
    if not disc_02_portrait and disc_02_landscape:
        disc_02_portrait = disc_02_landscape.copy()

    logo_landscape: List[str] = []
    logo_portrait: List[str] = []
    for row in logo_rows_raw:
        txt_l = (row["texts"].get(country_code, "") or "").rstrip()
        txt_p = (row.get("texts_portrait", {}).get(country_code, "") or "").rstrip()
        logo_landscape.append(txt_l)
        logo_portrait.append(txt_p if txt_p else txt_l)
    if not logo_portrait and logo_landscape:
        logo_portrait = logo_landscape.copy()

    controller_top_land: Dict[str, List[str]] = {}
    controller_top_port: Dict[str, List[str]] = {}
    for gk in controller_keys_sorted:
        g_land: List[str] = []
        g_port: List[str] = []
        for grow in controller_rows_raw.get(gk, []):
            txt_l = (grow.get("texts", {}).get(country_code, "") or "").rstrip()
            txt_p = (grow.get("texts_portrait", {}).get(country_code, "") or "").rstrip()
            g_land.append(txt_l)
            g_port.append(txt_p if txt_p else txt_l)
        controller_top_land[gk] = g_land
        controller_top_port[gk] = g_port

    videos_list: List[Dict[str, Any]] = []
    for vid in video_order:
        vdata = videos[vid]
        subs_land: List[Dict[str, Any]] = []
        subs_port: List[Dict[str, Any]] = []
        for srow in vdata.get("sub_rows", []):
            txt_l = (srow["texts"].get(country_code, "") or "").rstrip()
            txt_p = (srow.get("texts_portrait", {}).get(country_code, "") or "").rstrip()
            if skip_empty_text and not txt_l:
                continue
            if srow["start"] is None or srow["end"] is None:
                continue
            subs_land.append(
                {
                    "line": srow["line"],
                    "in": fmt_time(srow["start"]),
                    "out": fmt_time(srow["end"]),
                    "text": txt_l,
                }
            )
            txt_port_final = txt_p if txt_p else txt_l
            subs_port.append(
                {
                    "line": srow["line"],
                    "in": fmt_time(srow["start"]),
                    "out": fmt_time(srow["end"]),
                    "text": txt_port_final,
                }
            )

        super_a_land: List[Dict[str, Any]] = []
        super_a_port: List[Dict[str, Any]] = []
        super_b_land: List[Dict[str, Any]] = []
        super_b_port: List[Dict[str, Any]] = []
        for sarow in vdata.get("super_a_rows", []):
            txt_l = (sarow["texts"].get(country_code, "") or "").rstrip()
            txt_p = (sarow.get("texts_portrait", {}).get(country_code, "") or "").rstrip()
            if skip_empty_text and not txt_l:
                continue
            if sarow["start"] is None or sarow["end"] is None:
                continue
            super_a_land.append(
                {
                    "line": sarow["line"],
                    "in": fmt_time(sarow["start"]),
                    "out": fmt_time(sarow["end"]),
                    "text": txt_l,
                }
            )
            txt_port_final = txt_p if txt_p else txt_l
            super_a_port.append(
                {
                    "line": sarow["line"],
                    "in": fmt_time(sarow["start"]),
                    "out": fmt_time(sarow["end"]),
                    "text": txt_port_final,
                }
            )

        for sbrow in vdata.get("super_b_rows", []):
            txt_l = (sbrow["texts"].get(country_code, "") or "").rstrip()
            txt_p = (sbrow.get("texts_portrait", {}).get(country_code, "") or "").rstrip()
            if skip_empty_text and not txt_l and not txt_p:
                continue
            if sbrow["start"] is None or sbrow["end"] is None:
                continue
            super_b_land.append(
                {
                    "line": sbrow["line"],
                    "in": fmt_time(sbrow["start"]),
                    "out": fmt_time(sbrow["end"]),
                    "text": txt_l,
                }
            )
            txt_port_final_b = txt_p if txt_p else txt_l
            super_b_port.append(
                {
                    "line": sbrow["line"],
                    "in": fmt_time(sbrow["start"]),
                    "out": fmt_time(sbrow["end"]),
                    "text": txt_port_final_b,
                }
            )

        base_meta = vdata.get("metadata", {}).copy()
        dur_key = normalize_duration_token(str(base_meta.get("duration", "")))
        defaults_for_country = global_flag_defaults_per_country.get(country_code, {})
        for mk, mv in defaults_for_country.items():
            if mk not in base_meta:
                base_meta.setdefault(mk, mv)
        if dur_key:
            targeted_for_country = global_flag_targeted_per_country.get(country_code, {})
            for mk, duration_map in targeted_for_country.items():
                if dur_key in duration_map:
                    base_meta[mk] = duration_map[dur_key]
        if vid in per_video_meta_local_country and country_code in per_video_meta_local_country[vid]:
            for mk, mv in per_video_meta_local_country[vid][country_code].items():
                base_meta[mk] = mv

        land_meta = base_meta.copy()
        land_meta["orientation"] = "landscape"
        port_meta = base_meta.copy()
        port_meta["orientation"] = "portrait"
        videos_list.append(
            {
                "videoId": f"{vid}_landscape",
                "metadata": land_meta,
                "subtitles": subs_land,
                "super_A": super_a_land,
                "super_B": super_b_land,
            }
        )
        videos_list.append(
            {
                "videoId": f"{vid}_portrait",
                "metadata": port_meta,
                "subtitles": subs_port,
                "super_A": super_a_port,
                "super_B": super_b_port,
            }
        )

    return {
        "claim_landscape": claim_landscape,
        "claim_portrait": claim_portrait,
        "disc_landscape": disc_landscape,
        "disc_portrait": disc_portrait,
        "disc_02_landscape": disc_02_landscape,
        "disc_02_portrait": disc_02_portrait,
        "logo_landscape": logo_landscape,
        "logo_portrait": logo_portrait,
        "controller_top_land": controller_top_land,
        "controller_top_port": controller_top_port,
        "videos_list": videos_list,
    }


def populate_video_level_fields(
    *,
    country_code: str,
    videos_list: List[Dict[str, Any]],
    claims_rows: List[Dict[str, Any]],
    per_video_claim_rows: Dict[str, List[Dict[str, Any]]],
    claim_landscape: List[str],
    claim_portrait: List[str],
    disclaimers_rows_merged: List[Dict[str, Any]],
    per_video_disc_rows_raw: Dict[str, List[Dict[str, Any]]],
    merge_disclaimer: bool,
    disclaimers_02_rows_merged: List[Dict[str, Any]],
    per_video_disc_02_rows_raw: Dict[str, List[Dict[str, Any]]],
    merge_disclaimer_02: bool,
    logo_rows_raw: List[Dict[str, Any]],
    per_video_logo_rows_raw: Dict[str, List[Dict[str, Any]]],
    endframe_rows_raw: List[Dict[str, Any]],
    per_video_endframe_rows_raw: Dict[str, List[Dict[str, Any]]],
    controller_keys_sorted: List[str],
    controller_rows_raw: Dict[str, List[Dict[str, Any]]],
    per_video_controller_rows_raw: Dict[str, Dict[str, List[Dict[str, Any]]]],
    controller_top_land: Dict[str, List[str]],
    controller_top_port: Dict[str, List[str]],
    prefer_local_claim_disclaimer: bool,
    test_mode: bool,
    claims_as_objects: bool,
    controller_always_emit: bool,
    fmt_time: Callable[[float], Any],
) -> None:
    def timing_key(r: Dict[str, Any]) -> Tuple[Optional[float], Optional[float]]:
        return (r.get("start"), r.get("end"))

    global_claim_map_land = {
        timing_key(r): (r["texts"].get(country_code, "") or "").strip()
        for r in claims_rows
    }
    global_claim_map_port = {
        timing_key(r): (
            r.get("texts_portrait", {}).get(country_code, "") or ""
        ).strip()
        for r in claims_rows
    }
    global_controller_map_land: Dict[
        str, Dict[Tuple[Optional[float], Optional[float]], str]
    ] = {}
    global_controller_map_port: Dict[
        str, Dict[Tuple[Optional[float], Optional[float]], str]
    ] = {}
    for gk in controller_keys_sorted:
        global_controller_map_land[gk] = {
            timing_key(r): (r.get("texts", {}).get(country_code, "") or "").strip()
            for r in controller_rows_raw.get(gk, [])
        }
        global_controller_map_port[gk] = {
            timing_key(r): (
                r.get("texts_portrait", {}).get(country_code, "") or ""
            ).strip()
            for r in controller_rows_raw.get(gk, [])
        }

    global_disc_land = [
        (r.get("texts", {}).get(country_code, "") or "").rstrip()
        for r in disclaimers_rows_merged
    ]
    global_disc_port = [
        (r.get("texts_portrait", {}).get(country_code, "") or "").rstrip()
        for r in disclaimers_rows_merged
    ]
    global_disc_02_land = [
        (r.get("texts", {}).get(country_code, "") or "").rstrip()
        for r in disclaimers_02_rows_merged
    ]
    global_disc_02_port = [
        (r.get("texts_portrait", {}).get(country_code, "") or "").rstrip()
        for r in disclaimers_02_rows_merged
    ]
    global_logo_land = [
        (r.get("texts", {}).get(country_code, "") or "").strip()
        for r in logo_rows_raw
    ]
    global_logo_port = [
        (r.get("texts_portrait", {}).get(country_code, "") or "").strip()
        for r in logo_rows_raw
    ]
    global_endframe_land = [
        (r.get("texts", {}).get(country_code, "") or "").strip()
        for r in endframe_rows_raw
    ]
    global_endframe_port = [
        (r.get("texts_portrait", {}).get(country_code, "") or "").strip()
        for r in endframe_rows_raw
    ]

    per_video_disc_merged = merge_disclaimer_rows_by_video(
        per_video_rows_raw=per_video_disc_rows_raw,
        countries=[country_code],
        merge_enabled=merge_disclaimer,
    )
    per_video_disc_02_merged = merge_disclaimer_rows_by_video(
        per_video_rows_raw=per_video_disc_02_rows_raw,
        countries=[country_code],
        merge_enabled=merge_disclaimer_02,
    )

    for vobj in videos_list:
        vid_full = vobj["videoId"]
        base_video_id = vid_full.rsplit("_", 1)[0]
        orientation = "portrait" if vid_full.endswith("_portrait") else "landscape"
        global_claim_map = (
            global_claim_map_port if orientation == "portrait" else global_claim_map_land
        )
        global_disc_texts = (
            global_disc_port if orientation == "portrait" else global_disc_land
        )
        global_disc_02_texts = (
            global_disc_02_port if orientation == "portrait" else global_disc_02_land
        )
        global_logo_texts = (
            global_logo_port if orientation == "portrait" else global_logo_land
        )

        src_claims = per_video_claim_rows.get(base_video_id) or claims_rows
        claim_items: List[Dict[str, Any]] = []
        claim_texts_global = (
            claim_portrait if orientation == "portrait" else claim_landscape
        )
        for idx, row in enumerate(src_claims):
            txt_local = (
                (
                    row.get("texts_portrait", {})
                    if orientation == "portrait"
                    else row.get("texts", {})
                ).get(country_code, "")
                or ""
            ).rstrip()
            if orientation == "portrait" and prefer_local_claim_disclaimer and not txt_local:
                alt_land_local = (row.get("texts", {}).get(country_code, "") or "").rstrip()
                if alt_land_local:
                    txt_local = alt_land_local
            txt_global_timing = global_claim_map.get(timing_key(row), "")
            txt_global_index = (
                claim_texts_global[idx]
                if idx < len(claim_texts_global)
                else (claim_texts_global[0] if claim_texts_global else "")
            )
            if txt_local:
                text_value = txt_local
            else:
                text_value = txt_global_timing or txt_global_index or txt_local
            if test_mode and text_value:
                text_value = f"{vid_full}_{text_value}"
            entry: Dict[str, Any] = {"line": row.get("line", idx + 1), "text": text_value}
            if row.get("start") is not None and row.get("end") is not None:
                entry["in"] = fmt_time(row["start"])
                entry["out"] = fmt_time(row["end"])
            claim_items.append(entry)
        if len(claim_items) == 1:
            base = claim_items[0]
            text2 = (
                claim_texts_global[1]
                if len(claim_texts_global) >= 2
                else (
                    claim_texts_global[0]
                    if claim_texts_global
                    else base.get("text", "")
                )
            )
            if test_mode and text2 and not str(text2).startswith(f"{vid_full}_"):
                text2 = f"{vid_full}_{text2}"
            second: Dict[str, Any] = {"line": 2, "text": text2}
            if "in" in base:
                second["in"] = base["in"]
            if "out" in base:
                second["out"] = base["out"]
            claim_items.append(second)
        vobj["claim"] = claim_items
        if claims_as_objects:
            for i, item in enumerate(claim_items, start=1):
                vobj[f"claim_{i:02d}"] = [item]
            del vobj["claim"]

        src_discs = per_video_disc_merged.get(base_video_id) or disclaimers_rows_merged
        disc_items: List[Dict[str, Any]] = []
        for i, row in enumerate(src_discs):
            if orientation == "portrait":
                txt_local = (row.get("texts_portrait", {}).get(country_code, "") or "").rstrip()
            else:
                txt_local = (row.get("texts", {}).get(country_code, "") or "").rstrip()
            if orientation == "portrait" and prefer_local_claim_disclaimer and not txt_local:
                alt_land_local = (row.get("texts", {}).get(country_code, "") or "").rstrip()
                if alt_land_local:
                    txt_local = alt_land_local
            txt_global = (
                global_disc_texts[i]
                if i < len(global_disc_texts)
                else (global_disc_texts[0] if global_disc_texts else "")
            )
            if orientation == "portrait" and not txt_local and not txt_global:
                if i < len(global_disc_land):
                    txt_global = global_disc_land[i]
            text_value = (
                txt_local if (prefer_local_claim_disclaimer and txt_local) else txt_global
            )
            if test_mode and text_value:
                text_value = f"{vid_full}_{text_value}"
            entry = {"line": row.get("line", i + 1), "text": text_value}
            if row.get("start") is not None and row.get("end") is not None:
                entry["in"] = fmt_time(row["start"])
                entry["out"] = fmt_time(row["end"])
            else:
                entry["in"] = None
                entry["out"] = None
            disc_items.append(entry)
        vobj["disclaimer"] = disc_items

        src_discs_02 = per_video_disc_02_merged.get(base_video_id) or disclaimers_02_rows_merged
        disc_02_items: List[Dict[str, Any]] = []
        for i, row in enumerate(src_discs_02):
            if orientation == "portrait":
                txt_local = (row.get("texts_portrait", {}).get(country_code, "") or "").rstrip()
            else:
                txt_local = (row.get("texts", {}).get(country_code, "") or "").rstrip()
            if orientation == "portrait" and prefer_local_claim_disclaimer and not txt_local:
                alt_land_local = (row.get("texts", {}).get(country_code, "") or "").rstrip()
                if alt_land_local:
                    txt_local = alt_land_local
            txt_global = (
                global_disc_02_texts[i]
                if i < len(global_disc_02_texts)
                else (global_disc_02_texts[0] if global_disc_02_texts else "")
            )
            if orientation == "portrait" and not txt_local and not txt_global:
                if i < len(global_disc_02_land):
                    txt_global = global_disc_02_land[i]
            text_value = (
                txt_local if (prefer_local_claim_disclaimer and txt_local) else txt_global
            )
            if test_mode and text_value:
                text_value = f"{vid_full}_{text_value}"
            entry = {"line": row.get("line", i + 1), "text": text_value}
            if row.get("start") is not None and row.get("end") is not None:
                entry["in"] = fmt_time(row["start"])
                entry["out"] = fmt_time(row["end"])
            else:
                entry["in"] = None
                entry["out"] = None
            disc_02_items.append(entry)
        vobj["disclaimer_02"] = disc_02_items

        src_logos = per_video_logo_rows_raw.get(base_video_id) or logo_rows_raw
        logo_items: List[Dict[str, Any]] = []
        for i, row in enumerate(src_logos):
            if orientation == "portrait":
                txt_local = (row.get("texts_portrait", {}).get(country_code, "") or "").rstrip()
            else:
                txt_local = (row.get("texts", {}).get(country_code, "") or "").rstrip()
            if orientation == "portrait" and prefer_local_claim_disclaimer and not txt_local:
                alt_land_local = (row.get("texts", {}).get(country_code, "") or "").rstrip()
                if alt_land_local:
                    txt_local = alt_land_local
            txt_global = (
                global_logo_texts[i]
                if i < len(global_logo_texts)
                else (global_logo_texts[0] if global_logo_texts else "")
            )
            if orientation == "portrait" and not txt_local and not txt_global:
                if i < len(global_logo_land):
                    txt_global = global_logo_land[i]
            text_value = (
                txt_local if (prefer_local_claim_disclaimer and txt_local) else txt_global
            )
            if test_mode and text_value:
                text_value = f"{vid_full}_{text_value}"
            entry = {"line": row.get("line", i + 1), "text": text_value}
            if row.get("start") is not None and row.get("end") is not None:
                entry["in"] = fmt_time(row["start"])
                entry["out"] = fmt_time(row["end"])
            else:
                entry["in"] = None
                entry["out"] = None
            logo_items.append(entry)
        vobj["logo"] = logo_items

        src_end = per_video_endframe_rows_raw.get(base_video_id) or endframe_rows_raw
        end_items: List[Dict[str, Any]] = []
        for i, row in enumerate(src_end):
            if orientation == "portrait":
                txt_local = (row.get("texts_portrait", {}).get(country_code, "") or "").rstrip()
            else:
                txt_local = (row.get("texts", {}).get(country_code, "") or "").rstrip()
            if orientation == "portrait" and prefer_local_claim_disclaimer and not txt_local:
                alt_land_local = (row.get("texts", {}).get(country_code, "") or "").rstrip()
                if alt_land_local:
                    txt_local = alt_land_local
            txt_global = (
                (
                    global_endframe_port[i]
                    if orientation == "portrait"
                    else global_endframe_land[i]
                )
                if i
                < (
                    len(global_endframe_port)
                    if orientation == "portrait"
                    else len(global_endframe_land)
                )
                else (
                    (
                        global_endframe_port[0]
                        if orientation == "portrait"
                        else global_endframe_land[0]
                    )
                    if (
                        global_endframe_port
                        if orientation == "portrait"
                        else global_endframe_land
                    )
                    else ""
                )
            )
            if orientation == "portrait" and not txt_local and not txt_global:
                if i < len(global_endframe_land):
                    txt_global = global_endframe_land[i]
            text_value = (
                txt_local if (prefer_local_claim_disclaimer and txt_local) else txt_global
            )
            if test_mode and text_value:
                text_value = f"{vid_full}_{text_value}"
            entry = {"line": row.get("line", i + 1), "text": text_value}
            if row.get("start") is not None and row.get("end") is not None:
                entry["in"] = fmt_time(row["start"])
                entry["out"] = fmt_time(row["end"])
            else:
                entry["in"] = None
                entry["out"] = None
            end_items.append(entry)
        vobj["endFrame"] = end_items

        for gk in controller_keys_sorted:
            local_controller = per_video_controller_rows_raw.get(gk, {}).get(base_video_id, [])
            src_controller = (
                local_controller or controller_rows_raw.get(gk, [])
                if controller_always_emit
                else local_controller
            )
            controller_items: List[Dict[str, Any]] = []
            controller_texts_global = (
                controller_top_port[gk] if orientation == "portrait" else controller_top_land[gk]
            )
            global_controller_map = (
                global_controller_map_port[gk]
                if orientation == "portrait"
                else global_controller_map_land[gk]
            )
            for idx, grow in enumerate(src_controller):
                txt_local = (
                    (
                        grow.get("texts_portrait", {})
                        if orientation == "portrait"
                        else grow.get("texts", {})
                    ).get(country_code, "")
                    or ""
                ).rstrip()
                if orientation == "portrait" and prefer_local_claim_disclaimer and not txt_local:
                    alt_land_local = (grow.get("texts", {}).get(country_code, "") or "").rstrip()
                    if alt_land_local:
                        txt_local = alt_land_local
                txt_global_timing = global_controller_map.get(timing_key(grow), "")
                txt_global_index = (
                    controller_texts_global[idx]
                    if idx < len(controller_texts_global)
                    else (controller_texts_global[0] if controller_texts_global else "")
                )
                text_value = (
                    txt_local if txt_local else (txt_global_timing or txt_global_index or txt_local)
                )
                if test_mode and text_value:
                    text_value = f"{vid_full}_{text_value}"
                entry = {"line": grow.get("line", idx + 1), "text": text_value}
                if grow.get("start") is not None and grow.get("end") is not None:
                    entry["in"] = fmt_time(grow["start"])
                    entry["out"] = fmt_time(grow["end"])
                controller_items.append(entry)
            vobj[gk] = controller_items


def build_country_payload(
    *,
    country_code: str,
    global_meta: Dict[str, Any],
    global_flag_defaults_per_country: Dict[str, Dict[str, str]],
    global_flag_targeted_per_country: Dict[str, Dict[str, Dict[str, str]]],
    job_number_per_country: Dict[str, str],
    language_per_country: Dict[str, str],
    videos_list: List[Dict[str, Any]],
    controller_keys_sorted: List[str],
    controller_top_land: Dict[str, List[str]],
    controller_top_port: Dict[str, List[str]],
    claim_landscape: List[str],
    claim_portrait: List[str],
    disc_landscape: List[str],
    disc_portrait: List[str],
    disc_02_landscape: List[str],
    disc_02_portrait: List[str],
    logo_landscape: List[str],
    logo_portrait: List[str],
    cast_metadata: bool,
    claims_as_objects: bool,
    flags_overview_object_always: bool,
    schema_version: str,
    no_orientation: bool,
) -> Dict[str, Any]:
    gm_cast = {
        k: _maybe_cast_metadata_value(v, cast_metadata)
        for k, v in global_meta.copy().items()
    }

    defaults_for_country = global_flag_defaults_per_country.get(country_code, {})
    targeted_for_country = global_flag_targeted_per_country.get(country_code, {})
    flag_keys_for_country = sorted(
        set(defaults_for_country.keys()) | set(targeted_for_country.keys())
    )
    for flag_key in flag_keys_for_country:
        dur_map = targeted_for_country.get(flag_key, {})
        default_value = defaults_for_country.get(flag_key)
        if flags_overview_object_always:
            overview_obj: Dict[str, Any] = {}
            if default_value is not None:
                overview_obj["_default"] = default_value
            for dur in sorted(dur_map.keys(), key=lambda x: (len(x), x)):
                overview_obj[dur] = dur_map[dur]
            if overview_obj:
                gm_cast[flag_key] = overview_obj
            continue

        if dur_map:
            overview_obj = {}
            if default_value is not None:
                overview_obj["_default"] = default_value
            for dur in sorted(dur_map.keys(), key=lambda x: (len(x), x)):
                overview_obj[dur] = dur_map[dur]
            gm_cast[flag_key] = overview_obj
        elif default_value is not None:
            gm_cast[flag_key] = default_value

    if country_code in job_number_per_country:
        gm_cast["jobNumber"] = job_number_per_country[country_code]
    else:
        gm_cast.setdefault("jobNumber", "noJobNumber")
    gm_cast["language"] = language_per_country.get(country_code, "")
    gm_cast.pop("orientation", None)

    vlist_cast: List[Dict[str, Any]] = []
    for vobj in videos_list:
        meta_cast = {
            k: _maybe_cast_metadata_value(v, cast_metadata)
            for k, v in vobj["metadata"].items()
        }
        base = {
            "videoId": vobj["videoId"],
            "metadata": meta_cast,
            "subtitles": vobj["subtitles"],
            "super_A": vobj.get("super_A", []),
            "super_B": vobj.get("super_B", []),
            "claim": vobj.get("claim", []),
            "disclaimer": vobj.get("disclaimer", []),
            "disclaimer_02": vobj.get("disclaimer_02", []),
            "logo": vobj.get("logo", []),
            "endFrame": vobj.get("endFrame", []),
        }
        for gk in controller_keys_sorted:
            base[gk] = vobj.get(gk, [])
        if claims_as_objects:
            for k, val in vobj.items():
                if isinstance(k, str) and k.startswith("claim_"):
                    base[k] = val
            base.pop("claim", None)
        else:
            base["claim"] = vobj.get("claim", [])
        vlist_cast.append(base)

    if "schemaVersion" not in gm_cast:
        gm_cast["schemaVersion"] = schema_version
    if "country" not in gm_cast:
        gm_cast["country"] = country_code

    if no_orientation:
        payload: Dict[str, Any] = {
            "metadataGlobal": gm_cast,
            "claim": claim_landscape,
            "disclaimer": disc_landscape if disc_landscape else [""],
            "disclaimer_02": disc_02_landscape if disc_02_landscape else [""],
            "logo": logo_landscape,
        }
        for gk in controller_keys_sorted:
            payload[gk] = controller_top_land.get(gk, [])
        payload["videos"] = vlist_cast
        return payload

    payload = {
        "metadataGlobal": gm_cast,
        "claim": {"landscape": claim_landscape, "portrait": claim_portrait},
        "disclaimer": {
            "landscape": disc_landscape,
            "portrait": disc_portrait,
        },
        "disclaimer_02": {
            "landscape": disc_02_landscape,
            "portrait": disc_02_portrait,
        },
        "logo": {"landscape": logo_landscape, "portrait": logo_portrait},
    }
    for gk in controller_keys_sorted:
        payload[gk] = {
            "landscape": controller_top_land.get(gk, []),
            "portrait": controller_top_port.get(gk, []),
        }
    payload["videos"] = vlist_cast
    return payload
