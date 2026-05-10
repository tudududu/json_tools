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
    config_tool: Path,
) -> list[str]:
    args = [
        str(source_file),
        "--name=config_converter",
        "--onefile",
        "--clean",
        "--noconfirm",
        f"--distpath={dist_dir}",
        f"--workpath={work_dir}",
        f"--specpath={spec_dir}",
        f"--paths={repo_root}",
        f"--add-data={config_tool}:tools",
        "--hidden-import=openpyxl",
        "--hidden-import=python.tools.config_converter",
        "--hidden-import=python.tools.sheet_names_config",
        "--hidden-import=python.tools.merge_config_into_preset",
    ]

    sheet_names_tool = config_tool.parent / "sheet_names_config.py"
    if sheet_names_tool.is_file():
        args.append(f"--add-data={sheet_names_tool}:tools")

    merge_tool = config_tool.parent / "merge_config_into_preset.py"
    if merge_tool.is_file():
        args.append(f"--add-data={merge_tool}:tools")

    return args


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build standalone config_converter executable with PyInstaller"
    )
    parser.parse_args()

    import PyInstaller.__main__ as pyinstaller_main

    installer_dir = Path(__file__).resolve().parent
    python_dir = installer_dir.parent
    repo_root = python_dir.parent
    source_file = python_dir / "config_converter.py"

    build_root = python_dir / "build" / "config_converter"
    dist_dir = build_root / "dist"
    work_dir = build_root / "work"
    spec_dir = build_root / "spec"
    config_tool = python_dir / "tools" / "config_converter.py"

    for path in (dist_dir, work_dir, spec_dir):
        path.mkdir(parents=True, exist_ok=True)

    executable_path = dist_dir / "config_converter"
    if executable_path.exists():
        executable_path.unlink()

    pyinstaller_main.run(
        build_pyinstaller_args(
            source_file=source_file,
            repo_root=repo_root,
            dist_dir=dist_dir,
            work_dir=work_dir,
            spec_dir=spec_dir,
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
