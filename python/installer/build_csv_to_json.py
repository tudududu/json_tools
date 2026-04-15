#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

import PyInstaller.__main__


def main() -> int:
    installer_dir = Path(__file__).resolve().parent
    python_dir = installer_dir.parent
    repo_root = python_dir.parent
    source_file = python_dir / "csv_to_json.py"

    build_root = python_dir / "build" / "csv_to_json"
    dist_dir = build_root / "dist"
    work_dir = build_root / "work"
    spec_dir = build_root / "spec"
    tools_dir = python_dir / "tools"
    media_tool = tools_dir / "media_converter.py"
    config_tool = tools_dir / "config_converter.py"

    for path in (dist_dir, work_dir, spec_dir):
        path.mkdir(parents=True, exist_ok=True)

    executable_path = dist_dir / "csv_to_json"
    if executable_path.exists():
        executable_path.unlink()

    PyInstaller.__main__.run(
        [
            str(source_file),
            "--name=csv_to_json",
            "--onefile",
            "--clean",
            "--noconfirm",
            f"--distpath={dist_dir}",
            f"--workpath={work_dir}",
            f"--specpath={spec_dir}",
            f"--paths={repo_root}",
            f"--add-data={media_tool}:tools",
            f"--add-data={config_tool}:tools",
            "--hidden-import=openpyxl",
            "--hidden-import=python.tools.media_converter",
            "--hidden-import=python.tools.config_converter",
        ]
    )

    if not executable_path.exists():
        raise FileNotFoundError(
            f"PyInstaller completed without producing expected executable: {executable_path}"
        )

    print(f"Built executable: {executable_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())