from __future__ import annotations

import json
import os
from typing import Any, Dict, Optional


def write_validation_report(
    report_path: str,
    report_obj: Dict[str, Any],
) -> Optional[str]:
    try:
        os.makedirs(
            os.path.dirname(os.path.abspath(report_path)),
            exist_ok=True,
        )
        with open(report_path, "w", encoding="utf-8") as report_file:
            json.dump(report_obj, report_file, ensure_ascii=False, indent=2)
        return None
    except Exception as ex:
        return str(ex)
