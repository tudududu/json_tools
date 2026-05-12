#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path


def build_pyinstaller_args(
    source_file: Path,
    repo_root: Path,
    dist_dir: Path,
    work_dir: Path,
    spec_dir: Path,
    merge_tool: Path,
    config_tool: Path,
) -> list[str]:
    args = [
        str(source_file),
        "--name=merge_config_into_preset",
        "--onefile",
        "--clean",
        "--noconfirm",
        f"--distpath={dist_dir}",
        f"--workpath={work_dir}",
        f"--specpath={spec_dir}",
        f"--paths={repo_root}",
        f"--add-data={merge_tool}:tools",
        f"--add-data={config_tool}:tools",
        "--hidden-import=openpyxl",
        "--hidden-import=python.tools.merge_config_into_preset",
        "--hidden-import=python.tools.config_converter",
        "--hidden-import=python.tools.sheet_names_config",
    ]

    sheet_names_tool = config_tool.parent / "sheet_names_config.py"
    if sheet_names_tool.is_file():
        args.append(f"--add-data={sheet_names_tool}:tools")

    return args


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build standalone merge_config_into_preset executable with PyInstaller"
    )
    parser.parse_args()

    import PyInstaller.__main__ as pyinstaller_main

    installer_dir = Path(__file__).resolve().parent
    python_dir = installer_dir.parent
    repo_root = python_dir.parent
    source_file = python_dir / "merge_config_into_preset.py"

    build_root = python_dir / "build" / "merge_config_into_preset"
    dist_dir = build_root / "dist"
    work_dir = build_root / "work"
    spec_dir = build_root / "spec"
    merge_tool = python_dir / "tools" / "merge_config_into_preset.py"
    config_tool = python_dir / "tools" / "config_converter.py"

    for path in (dist_dir, work_dir, spec_dir):
        path.mkdir(parents=True, exist_ok=True)

    executable_path = dist_dir / "merge_config_into_preset"
    if executable_path.exists():
        executable_path.unlink()

    pyinstaller_main.run(
        build_pyinstaller_args(
            source_file=source_file,
            repo_root=repo_root,
            dist_dir=dist_dir,
            work_dir=work_dir,
            spec_dir=spec_dir,
            merge_tool=merge_tool,
            config_tool=config_tool,
        )
    )

    if not executable_path.exists():
        raise FileNotFoundError(
            f"PyInstaller completed without producing expected executable: {executable_path}"
        )

    print(f"Built executable: {executable_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
