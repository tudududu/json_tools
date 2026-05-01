from typing import Any, Dict, List, Optional

from .columns import detect_columns
from .timecode import parse_timecode


def convert_simple_mode(
    rows: List[List[str]],
    headers: List[str],
    effective_fps: float,
    start_line_index: int,
    round_ndigits: Optional[int],
    times_as_string: bool,
    strip_text: bool,
    skip_empty_text: bool,
    start_col: Optional[str],
    end_col: Optional[str],
    text_col: Optional[str],
) -> Dict[str, Any]:
    dict_rows = []
    for r in rows:
        d = {headers[i]: (r[i] if i < len(r) else "") for i in range(len(headers))}
        dict_rows.append(d)

    start_name, end_name, text_name = detect_columns(
        headers,
        start_override=start_col,
        end_override=end_col,
        text_override=text_col,
    )

    def fmt_time_simple(val: float) -> Any:
        if round_ndigits is not None:
            val = round(val, round_ndigits)
        if times_as_string:
            if round_ndigits is None:
                return f"{val:.2f}"
            return f"{val:.{round_ndigits}f}"
        return float(val)

    out_items: List[Dict[str, Any]] = []
    line_no = start_line_index
    for d in dict_rows:
        text_val = d.get(text_name, "")
        text = (
            text_val.strip() if strip_text and isinstance(text_val, str) else text_val
        )
        if skip_empty_text and (text is None or str(text).strip() == ""):
            continue
        try:
            tin = parse_timecode(str(d.get(start_name, "")).strip(), effective_fps)
            tout = parse_timecode(str(d.get(end_name, "")).strip(), effective_fps)
        except Exception as e:
            raise ValueError(f"Failed to parse timecodes for row {d}: {e}")
        item = {
            "line": line_no,
            "in": fmt_time_simple(tin),
            "out": fmt_time_simple(tout),
            "text": text,
        }
        out_items.append(item)
        line_no += 1
    return {"subtitles": out_items}
