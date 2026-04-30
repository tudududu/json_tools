import re
from typing import Dict, List, Optional, Tuple


def _normalize_header_map(headers: List[str]) -> Dict[str, str]:
    return {re.sub(r"[^a-z]", "", h.lower()): h for h in headers}


def _resolve_column(
    headers: List[str],
    override: Optional[str],
    candidates: Tuple[str, ...],
) -> Optional[str]:
    if override:
        if override.isdigit():
            idx = int(override) - 1
            if 0 <= idx < len(headers):
                return headers[idx]
            raise IndexError(f"Column index {override} out of range 1..{len(headers)}")
        for h in headers:
            if h.lower().strip() == override.lower().strip():
                return h
        norm = _normalize_header_map(headers)
        key = re.sub(r"[^a-z]", "", override.lower())
        if key in norm:
            return norm[key]
        raise KeyError(f"Override column '{override}' not found in headers {headers}")

    norm = _normalize_header_map(headers)
    for key in candidates:
        if key in norm:
            return norm[key]
    return None


def detect_columns(
    headers: List[str],
    start_override: Optional[str] = None,
    end_override: Optional[str] = None,
    text_override: Optional[str] = None,
) -> Tuple[str, str, str]:
    start_key = _resolve_column(
        headers, start_override, ("starttime", "start", "in", "inpoint")
    )
    end_key = _resolve_column(
        headers, end_override, ("endtime", "end", "out", "outpoint")
    )
    text_key = _resolve_column(
        headers, text_override, ("text", "subtitle", "caption", "line")
    )

    if not (start_key and end_key and text_key):
        missing = [
            k
            for k, v in {"start": start_key, "end": end_key, "text": text_key}.items()
            if not v
        ]
        raise KeyError(
            f"Missing required column(s): {', '.join(missing)}. Found headers: {headers}"
        )

    return start_key, end_key, text_key
