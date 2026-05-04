#!/usr/bin/env python3
"""Bundle AE expression source files into expressions_library.jsx.

This tool reads canonical expression files under expression_ae/ and emits
inline registry assignments in script/ae/template/expressions_library.jsx.

Usage examples:
  python3 -m python.tools.express_lib_bundler --write
  python3 -m python.tools.express_lib_bundler --check
  python3 -m python.tools.express_lib_bundler --write --sources script/ae/config/expressions_bundle_sources.json
  python3 -m python.tools.express_lib_bundler --write --strict-unused-pool

Config schema — two mutually exclusive modes:

  Legacy sources mode:
    { "sources": [ { "key": "...", "path": "...", "group"?: "..." }, ... ] }
    or a direct JSON array of entries (object or 2-item [key, path] tuple).

  Pool/bindings mode:
    {
      "pool":     [ { "id": "...", "path": "..." }, ... ],
      "bindings": [ { "key": "...", "expr": "...", "group"?: "..." }, ... ]
    }
    pool.id must be unique.
    binding.expr must reference an existing pool.id.
    binding.key must be unique.
    Mixing 'sources' with 'pool'/'bindings' in one config is an error.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Iterable, List, NamedTuple, Optional, Sequence, Set, Tuple

START_MARKER = "// >>> AE_EXPRESSIONS_BUNDLE:START"
END_MARKER = "// <<< AE_EXPRESSIONS_BUNDLE:END"
DEFAULT_SOURCES_CONFIG_REL = "script/ae/config/expressions_bundle_sources.json"


# ── Data models ───────────────────────────────────────────────────────────────


class SourceEntry(NamedTuple):
    key: str
    path: str
    group: str


class PoolEntry(NamedTuple):
    id: str
    path: str


class BindingEntry(NamedTuple):
    key: str
    expr: str  # references PoolEntry.id
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


# ── Config loading ────────────────────────────────────────────────────────────


def _load_raw_config(
    root: Path, sources_arg: Optional[str]
) -> Tuple[object, Optional[Path]]:
    """Load raw JSON config. Returns (raw_json, config_path) or (None, None) for fallback."""
    if sources_arg:
        config_path = Path(sources_arg)
        if not config_path.is_absolute():
            config_path = root / config_path
        if not config_path.is_file():
            raise FileNotFoundError(f"Sources config not found: {config_path}")
        try:
            raw = json.loads(config_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON in {config_path}: {e}") from e
        return raw, config_path

    default_path = root / DEFAULT_SOURCES_CONFIG_REL
    if default_path.is_file():
        try:
            raw = json.loads(default_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON in {default_path}: {e}") from e
        return raw, default_path

    return None, None


def _detect_schema_mode(raw: object) -> str:
    """Detect schema mode from raw JSON config.

    Returns one of: 'pool_bindings', 'sources', 'fallback'.
    Raises ValueError when sources and pool/bindings are mixed in one config.
    """
    if raw is None:
        return "fallback"
    if not isinstance(raw, dict):
        # Direct array -> legacy sources mode.
        return "sources"

    has_sources = "sources" in raw
    has_pool = "pool" in raw
    has_bindings = "bindings" in raw

    if has_sources and (has_pool or has_bindings):
        raise ValueError(
            "Mixed schema: config contains both 'sources' and 'pool'/'bindings'. "
            "Use either 'sources' (legacy) or 'pool'+'bindings' (new), not both."
        )

    if has_pool or has_bindings:
        return "pool_bindings"

    return "sources"


# ── Pool/bindings parsers ─────────────────────────────────────────────────────


def _parse_pool_entries(raw: dict, config_path: Path, root: Path) -> List[PoolEntry]:
    pool_raw = raw.get("pool")
    if not isinstance(pool_raw, list):
        raise ValueError(f"'pool' in {config_path}: expected a non-empty array")
    if not pool_raw:
        raise ValueError(f"'pool' in {config_path}: must not be empty")

    parsed: List[PoolEntry] = []
    seen_ids: Set[str] = set()

    for idx, item in enumerate(pool_raw):
        if not isinstance(item, dict):
            raise ValueError(
                f"pool[{idx}] in {config_path}: expected object {{id, path}}"
            )
        pool_id = str(item.get("id") or "").strip()
        rel_path = str(item.get("path") or "").strip()

        if not pool_id:
            raise ValueError(f"pool[{idx}] in {config_path}: empty id")
        if not rel_path:
            raise ValueError(f"pool[{idx}] in {config_path}: empty path")
        if pool_id in seen_ids:
            raise ValueError(f"Duplicate pool id '{pool_id}' in {config_path}")

        source_path = root / rel_path
        if not source_path.is_file():
            raise FileNotFoundError(
                f"pool[{idx}] in {config_path}: source file not found: {source_path}"
            )

        seen_ids.add(pool_id)
        parsed.append(PoolEntry(id=pool_id, path=rel_path))

    return parsed


def _parse_binding_entries(
    raw: dict, config_path: Path, pool_ids: Set[str]
) -> List[BindingEntry]:
    bindings_raw = raw.get("bindings")
    if not isinstance(bindings_raw, list):
        raise ValueError(f"'bindings' in {config_path}: expected a non-empty array")
    if not bindings_raw:
        raise ValueError(f"'bindings' in {config_path}: must not be empty")

    parsed: List[BindingEntry] = []
    seen_keys: Set[str] = set()

    for idx, item in enumerate(bindings_raw):
        if not isinstance(item, dict):
            raise ValueError(
                f"bindings[{idx}] in {config_path}: expected object {{key, expr[, group]}}"
            )
        key = str(item.get("key") or "").strip()
        expr = str(item.get("expr") or "").strip()
        raw_group = str(item.get("group") or "").strip()
        group = raw_group if raw_group else _default_group_for_key(key)

        if not key:
            raise ValueError(f"bindings[{idx}] in {config_path}: empty key")
        if not expr:
            raise ValueError(f"bindings[{idx}] in {config_path}: empty expr")
        if key in seen_keys:
            raise ValueError(f"Duplicate binding key '{key}' in {config_path}")
        if expr not in pool_ids:
            raise ValueError(
                f"bindings[{idx}] in {config_path}: "
                f"expr '{expr}' does not reference any pool id"
            )

        seen_keys.add(key)
        parsed.append(BindingEntry(key=key, expr=expr, group=group))

    if not parsed:
        raise ValueError(f"No bindings found in {config_path}")

    return parsed


# ── Renderers ─────────────────────────────────────────────────────────────────


def _render_generated_region(
    root: Path, expression_sources: Sequence[SourceEntry]
) -> str:
    """Legacy sources renderer — unchanged behaviour."""
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


def _render_pool_block(pool_id: str, rel_path: str, lines: Iterable[str]) -> str:
    """Render a full expression body assignment into __POOL (pool/bindings mode)."""
    out: List[str] = []
    out.append(f"    // {pool_id} — {rel_path}")
    out.append(f'    __POOL["{pool_id}"] = [')

    src_lines = list(lines)
    for idx, line in enumerate(src_lines):
        escaped = _js_quote_single(line)
        suffix = "," if idx < len(src_lines) - 1 else ""
        out.append(f"        '{escaped}'{suffix}")

    out.append('    ].join("\\n");')
    return "\n".join(out)


def _render_generated_region_pool(
    root: Path,
    pool: Sequence[PoolEntry],
    bindings: Sequence[BindingEntry],
    strict_unused: bool = False,
) -> str:
    """Pool/bindings renderer — each expression body emitted once; keys point into pool."""
    sections: List[str] = []
    sections.append("    // AUTO-GENERATED: AE expressions bundle (pool/bindings mode)")
    sections.append("    // Do not edit this block manually.")
    sections.append("    // Source of truth lives in expression_ae/*.js files.")
    sections.append("")

    # Warn (or fail) on unused pool entries.
    used_ids: Set[str] = {b.expr for b in bindings}
    unused_ids = [p.id for p in pool if p.id not in used_ids]
    if unused_ids:
        msg = f"Unused pool entries: {', '.join(unused_ids)}"
        if strict_unused:
            raise ValueError(msg)
        print(f"WARNING: {msg}", file=sys.stderr)

    # ── Pool section ──────────────────────────────────────────────────────────
    sections.append("    // ── EXPRESSION POOL " + "─" * 53)
    sections.append("")
    sections.append("    var __POOL = {};")
    sections.append("")

    for entry in pool:
        source_path = root / entry.path
        src_lines = _read_source_lines(source_path)
        sections.append(_render_pool_block(entry.id, entry.path, src_lines))
        sections.append("")

    # ── Bindings section (grouped) ────────────────────────────────────────────
    last_group = ""
    for binding in bindings:
        group = binding.group
        if group != last_group:
            if sections and sections[-1] != "":
                sections.append("")
            sections.append(
                "    // ── " + group + " (generated) " + "─" * max(1, 57 - len(group))
            )
            sections.append("")
            last_group = group

        sections.append(f"    // {binding.key} \u2192 {binding.expr}")
        sections.append(
            f'    globalObj.AE_EXPRESSIONS["{binding.key}"] = __POOL["{binding.expr}"];'
        )
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
    parser.add_argument(
        "--strict-unused-pool",
        action="store_true",
        default=False,
        help=(
            "Pool/bindings mode only: fail if any pool entry is not referenced "
            "by at least one binding."
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

    # Load raw config and detect schema mode.
    raw, config_path = _load_raw_config(root, args.sources)
    mode = _detect_schema_mode(raw)

    if mode == "pool_bindings":
        assert config_path is not None
        pool = _parse_pool_entries(raw, config_path, root)
        pool_ids: Set[str] = {p.id for p in pool}
        bindings = _parse_binding_entries(raw, config_path, pool_ids)
        generated = _render_generated_region_pool(
            root, pool, bindings, strict_unused=args.strict_unused_pool
        )
    elif mode == "sources":
        assert config_path is not None
        expression_sources = _parse_source_entries(raw, config_path)
        generated = _render_generated_region(root, expression_sources)
    else:  # fallback — no config file found
        expression_sources = _fallback_sources()
        generated = _render_generated_region(root, expression_sources)

    original = target.read_text(encoding="utf-8")
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
