from __future__ import annotations

from datetime import datetime
import hashlib
import os
import platform
import subprocess
from typing import Any, Dict, Optional


def inject_generation_metadata(
    obj: Dict[str, Any],
    *,
    input_path: str,
    converter_version: str,
    script_file_path: str,
) -> None:
    try:
        h = hashlib.sha256()
        with open(input_path, "rb") as f_in:
            for chunk in iter(lambda: f_in.read(8192), b""):
                h.update(chunk)
        checksum = h.hexdigest()
    except Exception:
        checksum = ""

    try:
        utc_now = datetime.now(datetime.UTC)  # type: ignore[attr-defined]
    except AttributeError:
        from datetime import timezone

        utc_now = datetime.now(timezone.utc)
    timestamp = utc_now.replace(microsecond=0).isoformat().replace("+00:00", "Z")

    git_commit: Optional[str] = None
    try:
        git_commit = (
            subprocess.check_output(
                ["git", "rev-parse", "--short", "HEAD"], stderr=subprocess.DEVNULL
            )
            .decode("utf-8")
            .strip()
            or None
        )
    except Exception:
        git_commit = None

    py_version = __import__("sys").version.split()[0]
    impl = platform.python_implementation()
    platform_str = platform.platform()

    last_change_id: Optional[str] = None
    try:
        py_dir = os.path.dirname(os.path.abspath(script_file_path))
        changelog_candidates = [
            os.path.join(py_dir, "CHANGELOG.md"),
            os.path.join(py_dir, "readMe", "CHANGELOG.md"),
        ]
        for changelog_path in changelog_candidates:
            if os.path.isfile(changelog_path):
                with open(changelog_path, "r", encoding="utf-8") as chf:
                    for line in chf:
                        stripped_line = line.strip()
                        if stripped_line.startswith("#"):
                            last_change_id = stripped_line.lstrip("#").strip()
                            break
                        if (
                            stripped_line
                            and ("202" in stripped_line or "20" in stripped_line)
                            and any(c.isdigit() for c in stripped_line)
                        ):
                            last_change_id = stripped_line
                            break
                    if last_change_id:
                        break
    except Exception:
        last_change_id = None

    def _augment_payload(pld: Dict[str, Any]) -> None:
        if "metadataGlobal" in pld and isinstance(pld.get("metadataGlobal"), dict):
            mg = pld["metadataGlobal"]
            mg["generatedAt"] = timestamp
            mg["inputSha256"] = checksum
            mg.setdefault("inputFileName", os.path.basename(input_path))
            mg["converterVersion"] = converter_version
            if git_commit and "converterCommit" not in mg:
                mg["converterCommit"] = git_commit
            mg.setdefault("pythonVersion", py_version)
            mg.setdefault("pythonImplementation", impl)
            mg.setdefault("platform", platform_str)
            if last_change_id and "lastChangeId" not in mg:
                mg["lastChangeId"] = last_change_id
        elif "metadata" in pld and isinstance(pld.get("metadata"), dict):
            mg = pld["metadata"]
            mg["generatedAt"] = timestamp
            mg["inputSha256"] = checksum
            mg.setdefault("inputFileName", os.path.basename(input_path))
            mg["converterVersion"] = converter_version
            if git_commit and "converterCommit" not in mg:
                mg["converterCommit"] = git_commit
            mg.setdefault("pythonVersion", py_version)
            mg.setdefault("pythonImplementation", impl)
            mg.setdefault("platform", platform_str)
            if last_change_id and "lastChangeId" not in mg:
                mg["lastChangeId"] = last_change_id

    if (
        isinstance(obj, dict)
        and obj.get("_multi")
        and isinstance(obj.get("byCountry"), dict)
    ):
        for _, p in obj.get("byCountry", {}).items():
            if isinstance(p, dict):
                _augment_payload(p)
    elif isinstance(obj, dict):
        _augment_payload(obj)
