#!/usr/bin/env python3
"""Helper: Inspect per-country outputs for specific metadata flags.

Usage:
  python3 python/tools/inspect_flags.py out/v14_test_*.json --keys disclaimer_flag,subtitle_flag,jobNumber

Glob patterns are expanded by the shell. You can also pass directories; the script will scan for *.json inside.

Outputs one line per file with found key/value pairs (missing keys omitted unless --show-missing).
"""
from __future__ import annotations
import argparse, json, os, sys, glob
from typing import List

def gather_json_files(paths: List[str]) -> List[str]:
    files: List[str] = []
    for p in paths:
        if os.path.isdir(p):
            for root, _dirs, fnames in os.walk(p):
                for fn in fnames:
                    if fn.lower().endswith('.json'):
                        files.append(os.path.join(root, fn))
        else:
            # Expand glob if wildcards present
            if any(ch in p for ch in '*?[]'):
                files.extend(glob.glob(p))
            else:
                files.append(p)
    # Deduplicate preserving order
    seen = set()
    out = []
    for f in files:
        if f not in seen:
            seen.add(f)
            out.append(f)
    return out

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Inspect JSON outputs for selected metadata keys")
    ap.add_argument('paths', nargs='+', help='JSON files, directories, or glob patterns')
    ap.add_argument('--keys', default='disclaimer_flag,subtitle_flag,jobNumber', help='Comma list of metadata keys to extract (default: disclaimer_flag,subtitle_flag,jobNumber)')
    ap.add_argument('--show-missing', action='store_true', help='Include keys with value <MISSING> when absent')
    ap.add_argument('--per-video', action='store_true', help='List keys per video instead of only metadataGlobal')
    args = ap.parse_args(argv)

    keys = [k.strip() for k in args.keys.split(',') if k.strip()]
    files = gather_json_files(args.paths)
    if not files:
        print('No files matched', file=sys.stderr)
        return 1

    for path in files:
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception as ex:
            print(f"{path}: <ERROR reading JSON: {ex}>")
            continue
        # Determine if multi-country wrapper
        def emit_line(context: str, source: dict):
            parts = []
            for k in keys:
                if k in source:
                    parts.append(f"{k}={source[k]!r}")
                elif args.show_missing:
                    parts.append(f"{k}=<MISSING>")
            print(f"{path}{context} :: " + (', '.join(parts) if parts else '(no keys)'))

        if data.get('_multi') and isinstance(data.get('byCountry'), dict):
            for country, payload in data['byCountry'].items():
                mg = payload.get('metadataGlobal', {}) if isinstance(payload, dict) else {}
                emit_line(f"[{country}][metadataGlobal]", mg)
                if args.per_video:
                    for v in payload.get('videos', []):
                        if isinstance(v, dict):
                            meta = v.get('metadata', {})
                            emit_line(f"[{country}][video:{v.get('videoId')}]", meta)
        else:
            # Single-country payload
            mg = data.get('metadataGlobal') or data.get('metadata') or {}
            emit_line("[metadataGlobal]", mg)
            if args.per_video:
                for v in data.get('videos', []):
                    if isinstance(v, dict):
                        emit_line(f"[video:{v.get('videoId')}]", v.get('metadata', {}))
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
