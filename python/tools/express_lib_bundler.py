#!/usr/bin/env python3
"""Bundle AE expression source files into expressions_library.jsx.

This tool reads canonical expression files under expression_ae/ and emits
inline registry assignments in script/ae/template/expressions_library.jsx.

Usage examples:
  python3 -m python.tools.express_lib_bundler --write
  python3 -m python.tools.express_lib_bundler --check
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Iterable, List, Sequence, Tuple

START_MARKER = "// >>> AE_EXPRESSIONS_BUNDLE:START"
END_MARKER = "// <<< AE_EXPRESSIONS_BUNDLE:END"

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
    out.append(f"    globalObj.AE_EXPRESSIONS[\"{key}\"] = [")

    src_lines = list(lines)
    for idx, line in enumerate(src_lines):
        escaped = _js_quote_single(line)
        suffix = "," if idx < len(src_lines) - 1 else ""
        out.append(f"        '{escaped}'{suffix}")

    out.append('    ].join("\\n");')
    return "\n".join(out)


def _render_generated_region(root: Path) -> str:
    sections: List[str] = []
    sections.append("    // AUTO-GENERATED: AE expressions bundle")
    sections.append("    // Do not edit this block manually.")
    sections.append("    // Source of truth lives in expression_ae/*.js files.")
    sections.append("")

    last_group = ""
    for key, rel in EXPRESSION_SOURCES:
        group = key.split("_", 1)[0]
        if group != last_group:
            if sections and sections[-1] != "":
                sections.append("")
            sections.append(
                "    // ── " + group + " (generated) " + "─" * max(1, 57 - len(group))
            )
            sections.append("")
            last_group = group

        source_path = root / rel
        src_lines = _read_source_lines(source_path)
        sections.append(_render_assignment_block(key, rel, src_lines))
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

    original = target.read_text(encoding="utf-8")
    generated = _render_generated_region(root)
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
