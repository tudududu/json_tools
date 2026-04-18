#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import subprocess
from typing import Optional


_SEMVER_HEADING_RE = re.compile(r"\[?v?([0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.]+)?)")


def resolve_converter_version(
    requested: str,
    repo_root: Path,
    python_dir: Path,
) -> str:
    if requested and requested not in ("auto", "dev"):
        return requested.strip()

    env_val = os.getenv("CONVERTER_VERSION", "").strip()
    if env_val:
        return env_val

    changelog_candidates = [
        repo_root / "CHANGELOG.md",
        python_dir / "readMe" / "CHANGELOG.md",
    ]
    for changelog_path in changelog_candidates:
        if not changelog_path.is_file():
            continue
        try:
            with changelog_path.open("r", encoding="utf-8") as handle:
                for raw_line in handle:
                    line = raw_line.strip()
                    if not line.startswith("#"):
                        continue
                    heading = line.lstrip("#").strip()
                    match = _SEMVER_HEADING_RE.match(heading)
                    if match:
                        return match.group(1)
                    token = heading.split()[0] if heading else ""
                    if re.match(r"v?[0-9]+\.[0-9]+(\.[0-9]+)?", token):
                        return token.lstrip("v")
                    break
        except Exception:
            continue

    try:
        tag = (
            subprocess.check_output(
                ["git", "describe", "--tags", "--abbrev=0"],
                stderr=subprocess.DEVNULL,
                cwd=repo_root,
            )
            .decode("utf-8")
            .strip()
        )
        if tag:
            return tag[1:] if tag.startswith("v") else tag
    except Exception:
        pass

    try:
        short_commit = (
            subprocess.check_output(
                ["git", "rev-parse", "--short", "HEAD"],
                stderr=subprocess.DEVNULL,
                cwd=repo_root,
            )
            .decode("utf-8")
            .strip()
        )
        if short_commit:
            return f"0.0.0+{short_commit}"
    except Exception:
        pass

    return "dev"


def render_runtime_hook(
    template_path: Path,
    output_path: Path,
    converter_version: str,
) -> None:
    template_text = template_path.read_text(encoding="utf-8")
    rendered = template_text.replace(
        "__CSV_TO_JSON_CONVERTER_VERSION__",
        repr(converter_version),
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(rendered, encoding="utf-8")


def build_pyinstaller_args(
    source_file: Path,
    repo_root: Path,
    dist_dir: Path,
    work_dir: Path,
    spec_dir: Path,
    media_tool: Path,
    config_tool: Path,
    runtime_hook: Optional[Path] = None,
) -> list[str]:
    args = [
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
    if runtime_hook is not None:
        args.append(f"--runtime-hook={runtime_hook}")
    return args


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build standalone csv_to_json executable with PyInstaller"
    )
    parser.add_argument(
        "--converter-version",
        default="auto",
        help=(
            "Version baked into standalone runtime via CONVERTER_VERSION. "
            "Use explicit value or 'auto' (default) to resolve from env/changelog/git."
        ),
    )
    cli_args = parser.parse_args()

    import PyInstaller.__main__ as pyinstaller_main

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
    runtime_hook_template = installer_dir / "runtime_hook_converter_version.py"
    runtime_hook_rendered = work_dir / "runtime_hook_converter_version.py"

    for path in (dist_dir, work_dir, spec_dir):
        path.mkdir(parents=True, exist_ok=True)

    converter_version = resolve_converter_version(
        requested=cli_args.converter_version,
        repo_root=repo_root,
        python_dir=python_dir,
    )
    render_runtime_hook(
        template_path=runtime_hook_template,
        output_path=runtime_hook_rendered,
        converter_version=converter_version,
    )

    executable_path = dist_dir / "csv_to_json"
    if executable_path.exists():
        executable_path.unlink()

    pyinstaller_main.run(
        build_pyinstaller_args(
            source_file=source_file,
            repo_root=repo_root,
            dist_dir=dist_dir,
            work_dir=work_dir,
            spec_dir=spec_dir,
            media_tool=media_tool,
            config_tool=config_tool,
            runtime_hook=runtime_hook_rendered,
        )
    )

    if not executable_path.exists():
        raise FileNotFoundError(
            f"PyInstaller completed without producing expected executable: {executable_path}"
        )

    print(f"Built executable: {executable_path}")
    print(f"Baked converter version: {converter_version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
