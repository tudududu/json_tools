import re
from typing import Any, Dict, List, Optional, Tuple

from .timecode import parse_timecode


def convert_sectioned_mode(
    rows: List[List[str]],
    headers: List[str],
    effective_fps: float,
    start_line_index: int,
    round_ndigits: Optional[int],
    times_as_string: bool,
    strip_text: bool,
    skip_empty_text: bool,
    text_col: Optional[str],
) -> Dict[str, Any]:
    norm_headers = [re.sub(r"[^a-z]", "", (h or "").lower()) for h in headers]

    def find_col(names: Tuple[str, ...]) -> Optional[int]:
        for i, nh in enumerate(norm_headers):
            if nh in names:
                return i
        return None

    idx_line = find_col(("line",))
    idx_start = find_col(("starttime", "start", "in", "inpoint"))
    idx_end = find_col(("endtime", "end", "out", "outpoint"))

    text_cols = [i for i, nh in enumerate(norm_headers) if nh == "text"]

    idx_section = 0 if headers and headers[0] else 0

    if not text_cols:
        if text_col and text_col.isdigit():
            text_cols = [int(text_col) - 1]
        else:
            text_cols = [len(headers) - 1]

    country_codes: List[str] = []
    per_country: Dict[str, Dict[str, Any]] = {}

    def ensure_country(idx: int, code: Optional[str] = None) -> str:
        nonlocal country_codes
        if idx >= len(country_codes):
            for k in range(len(country_codes), idx + 1):
                country_codes.append(
                    code or f"col{k - (len(text_cols) - len(country_codes)) + 1}"
                )
        c = country_codes[idx]
        if c not in per_country:
            per_country[c] = {
                "subtitles": [],
                "claim": [],
                "disclaimer": [],
                "disclaimer_02": [],
                "metadata": {},
            }
        return c

    def fmt_time_sectioned(val: float) -> Any:
        if round_ndigits is not None:
            val = round(val, round_ndigits)
        if times_as_string:
            if round_ndigits is None:
                return f"{val:.2f}"
            return f"{val:.{round_ndigits}f}"
        return float(val)

    current_section = (headers[0] or "subtitles").strip().lower()
    auto_line = start_line_index
    for r in rows:
        if len(r) < len(headers):
            r = r + [""] * (len(headers) - len(r))

        if r[idx_section].strip():
            current_section = r[idx_section].strip().lower()

        if current_section == "metadata":
            key_col = min(text_cols) - 1 if min(text_cols) > 0 else 0
            key_raw = r[key_col].strip() if key_col < len(r) else ""
            if not key_raw:
                continue
            key_norm = key_raw.strip()
            for ti, tcol in enumerate(text_cols):
                val = r[tcol].strip() if tcol < len(r) else ""
                code = None
                if key_norm.lower() == "country":
                    code = val or None
                ccode = ensure_country(ti, code)
                if key_norm.lower() == "country" and val:
                    country_codes[ti] = val
                    if ccode != val:
                        per_country[val] = per_country.pop(
                            ccode,
                            {
                                "subtitles": [],
                                "claim": [],
                                "disclaimer": [],
                                "disclaimer_02": [],
                                "metadata": {},
                            },
                        )
                    ccode = val
                if key_norm.lower() != "country":
                    per_country[ccode]["metadata"][key_norm] = val
            continue

        if current_section in ("subtitles", "claim", "disclaimer", "disclaimer_02"):
            if idx_line is not None and idx_line < len(r) and str(r[idx_line]).strip():
                try:
                    line_no_val = int(str(r[idx_line]).strip())
                except Exception:
                    line_no_val = auto_line
            else:
                line_no_val = auto_line

            try:
                tin = parse_timecode(
                    str(r[idx_start]).strip() if idx_start is not None else "",
                    effective_fps,
                )
                tout = parse_timecode(
                    str(r[idx_end]).strip() if idx_end is not None else "",
                    effective_fps,
                )
            except Exception:
                continue

            for ti, tcol in enumerate(text_cols):
                text_val = r[tcol] if tcol < len(r) else ""
                text_val = (
                    text_val.strip()
                    if strip_text and isinstance(text_val, str)
                    else text_val
                )
                if skip_empty_text and (
                    text_val is None or str(text_val).strip() == ""
                ):
                    continue
                ccode = ensure_country(ti)
                item = {
                    "line": line_no_val,
                    "in": fmt_time_sectioned(tin),
                    "out": fmt_time_sectioned(tout),
                    "text": text_val,
                }
                per_country[ccode][current_section].append(item)

            auto_line += 1
            continue

        continue

    if not country_codes:
        country_codes = ["default"]
        if "default" not in per_country:
            per_country["default"] = {
                "subtitles": [],
                "claim": [],
                "disclaimer": [],
                "disclaimer_02": [],
                "metadata": {},
            }

    if len(country_codes) == 1:
        c = country_codes[0]
        return {
            "subtitles": per_country[c]["subtitles"],
            "claim": per_country[c]["claim"],
            "disclaimer": per_country[c]["disclaimer"],
            "disclaimer_02": per_country[c]["disclaimer_02"],
            "metadata": per_country[c]["metadata"],
        }

    return {
        "_multi": True,
        "countries": country_codes,
        "byCountry": per_country,
    }
