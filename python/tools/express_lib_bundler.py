#!/usr/bin/env python3
"""Bundle AE expression source files into expressions_library.jsx.

This tool reads canonical expression files under expression_ae/ and emits
inline registry assignments in script/ae/template/expressions_library.jsx.

Usage examples:
  python3 -m python.tools.express_lib_bundler --write
  python3 -m python.tools.express_lib_bundler --check
  python3 -m python.tools.express_lib_bundler --write --sources script/ae/config/expressions_bundle_sources.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Iterable, List, NamedTuple, Sequence, Tuple

START_MARKER = "// >>> AE_EXPRESSIONS_BUNDLE:START"
END_MARKER = "// <<< AE_EXPRESSIONS_BUNDLE:END"
DEFAULT_SOURCES_CONFIG_REL = "script/ae/config/expressions_bundle_sources.json"


class SourceEntry(NamedTuple):
    key: str
    path: str
    group: str


# Hardcoded fallback list if no JSON source config is provided.
# (symbolic key, source path relative to repository root)
EXPRESSION_SOURCES: Sequence[Tuple[str, str]] = (
    ("info_source_text", "expression_ae/sourceText/sourceText_json_info.js"),
    ("claim_source_text", "expression_ae/claim/sourceText_json_wire_simple.js"),
    ("claim_anchor", "expression_ae/claim/anchor_baseline_centered_text.js"),
    (
        "claim_position",
        "expression_ae/claim/position_baseline_locked_text_multiline.js",
    ),
    ("claim_scale", "expression_ae/claim/scale_uniform_contain_v02.js"),
    ("claim_opacity", "expression_ae/opacity/opacity_fadein_onTime_v08.js"),
)


def _repo_root() -> Path:
    # .../repo/python/tools/express_lib_bundler.py -> parents[2] == repo root
    return Path(__file__).resolve().parents[2]


def _default_group_for_key(key: str) -> str:
    token = key.split("_", 1)[0].strip()
    return token if token else "misc"


def _js_quote_single(s: str) -> str:
    # Escape only what is needed for single-quoted JS string literals.
    return s.replace("\\", "\\\\").replace("'", "\\'")


def _read_source_lines(path: Path) -> List[str]:
    if not path.is_file():
        raise FileNotFoundError(f"Source file not found: {path}")
    raw = path.read_text(encoding="utf-8")
    normalized = raw.replace("\r\n", "\n").replace("\r", "\n")
    lines = normalized.split("\n")
    # Drop a single trailing empty line caused by final newline in source file.
    if lines and lines[-1] == "":
        lines = lines[:-1]
    return lines


def _render_assignment_block(key: str, rel_path: str, lines: Iterable[str]) -> str:
    out: List[str] = []
    out.append(f"    // {key} — {rel_path}")
    out.append(f'    globalObj.AE_EXPRESSIONS["{key}"] = [')

    src_lines = list(lines)
    for idx, line in enumerate(src_lines):
        escaped = _js_quote_single(line)
        suffix = "," if idx < len(src_lines) - 1 else ""
        out.append(f"        '{escaped}'{suffix}")

    out.append('    ].join("\\n");')
    return "\n".join(out)


def _parse_source_entries(raw: object, config_path: Path) -> List[SourceEntry]:
    if isinstance(raw, dict):
        entries = raw.get("sources")
    else:
        entries = raw

    if not isinstance(entries, list):
        raise ValueError(
            f"Invalid sources list in {config_path}: expected list or object with 'sources' list"
        )

    parsed: List[SourceEntry] = []
    seen = set()

    for idx, item in enumerate(entries):
        key: str
        rel_path: str
        group: str

        if isinstance(item, dict):
            key_obj = item.get("key")
            path_obj = item.get("path")
            group_obj = item.get("group")
            key = str(key_obj or "").strip()
            rel_path = str(path_obj or "").strip()
            raw_group = str(group_obj or "").strip()
            group = raw_group if raw_group else _default_group_for_key(key)
        elif isinstance(item, list) and len(item) == 2:
            key = str(item[0] or "").strip()
            rel_path = str(item[1] or "").strip()
            group = _default_group_for_key(key)
        else:
            raise ValueError(
                f"Invalid entry at index {idx} in {config_path}: "
                "expected object {key,path[,group]} or [key,path]"
            )

        if not key:
            raise ValueError(
                f"Invalid entry at index {idx} in {config_path}: empty key"
            )
        if not rel_path:
            raise ValueError(
                f"Invalid entry at index {idx} in {config_path}: empty path"
            )
        if key in seen:
            raise ValueError(f"Duplicate key '{key}' in {config_path}")

        seen.add(key)
        parsed.append(SourceEntry(key=key, path=rel_path, group=group))

    if not parsed:
        raise ValueError(f"No expression sources found in {config_path}")

    return parsed


def _fallback_sources() -> List[SourceEntry]:
    return [
        SourceEntry(key=key, path=rel_path, group=_default_group_for_key(key))
        for key, rel_path in EXPRESSION_SOURCES
    ]


def _load_expression_sources(root: Path, sources_arg: str | None) -> List[SourceEntry]:
    if sources_arg:
        config_path = Path(sources_arg)
        if not config_path.is_absolute():
            config_path = root / config_path
        if not config_path.is_file():
            raise FileNotFoundError(f"Sources config not found: {config_path}")
        raw = json.loads(config_path.read_text(encoding="utf-8"))
        return _parse_source_entries(raw, config_path)

    default_path = root / DEFAULT_SOURCES_CONFIG_REL
    if default_path.is_file():
        raw = json.loads(default_path.read_text(encoding="utf-8"))
        return _parse_source_entries(raw, default_path)

    return _fallback_sources()


def _render_generated_region(
    root: Path, expression_sources: Sequence[SourceEntry]
) -> str:
    sections: List[str] = []
    sections.append("    // AUTO-GENERATED: AE expressions bundle")
    sections.append("    // Do not edit this block manually.")
    sections.append("    // Source of truth lives in expression_ae/*.js files.")
    sections.append("")

    last_group = ""
    for entry in expression_sources:
        group = entry.group
        if group != last_group:
            if sections and sections[-1] != "":
                sections.append("")
            sections.append(
                "    // ── " + group + " (generated) " + "─" * max(1, 57 - len(group))
            )
            sections.append("")
            last_group = group

        source_path = root / entry.path
        src_lines = _read_source_lines(source_path)
        sections.append(_render_assignment_block(entry.key, entry.path, src_lines))
        sections.append("")

    # Trim trailing blank line for stable idempotent writes.
    while sections and sections[-1] == "":
        sections.pop()

    return "\n".join(sections)


def _replace_between_markers(content: str, generated: str) -> str:
    if content.count(START_MARKER) != 1:
        raise ValueError(
            f"Expected exactly one start marker '{START_MARKER}', "
            f"found {content.count(START_MARKER)}"
        )
    if content.count(END_MARKER) != 1:
        raise ValueError(
            f"Expected exactly one end marker '{END_MARKER}', "
            f"found {content.count(END_MARKER)}"
        )

    start_idx = content.find(START_MARKER)
    end_idx = content.find(END_MARKER)
    if end_idx < start_idx:
        raise ValueError("End marker appears before start marker")

    body_start = start_idx + len(START_MARKER)
    body_end = end_idx

    return content[:body_start] + "\n" + generated + "\n" + content[body_end:]


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Bundle expression_ae source files into expressions_library.jsx"
    )
    parser.add_argument(
        "--root",
        default=None,
        help="Repository root path (default: auto-detected from script location)",
    )
    parser.add_argument(
        "--sources",
        default=None,
        help=(
            "Optional JSON source-list path, repo-relative or absolute. "
            "If omitted, uses script/ae/config/expressions_bundle_sources.json when present; "
            "otherwise falls back to hardcoded EXPRESSION_SOURCES."
        ),
    )

    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument(
        "--write",
        action="store_true",
        help="Write generated bundle into expressions_library.jsx",
    )
    mode.add_argument(
        "--check",
        action="store_true",
        help="Exit non-zero if expressions_library.jsx is out-of-date",
    )

    return parser.parse_args()


def main() -> int:
    args = _parse_args()

    root = Path(args.root).resolve() if args.root else _repo_root()
    target = root / "script/ae/template/expressions_library.jsx"

    if not target.is_file():
        raise FileNotFoundError(f"Target file not found: {target}")

    expression_sources = _load_expression_sources(root, args.sources)

    original = target.read_text(encoding="utf-8")
    generated = _render_generated_region(root, expression_sources)
    updated = _replace_between_markers(original, generated)

    if args.check:
        if updated == original:
            print("OK: expressions_library.jsx is up to date")
            return 0
        print("OUTDATED: expressions_library.jsx differs from bundled sources")
        return 1

    target.write_text(updated, encoding="utf-8", newline="\n")
    print(f"UPDATED: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
