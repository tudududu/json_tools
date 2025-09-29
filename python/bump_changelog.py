#!/usr/bin/env python3
"""
CHANGELOG auto-bump helper.

Purpose:
  Automates creating a new release heading at the top of CHANGELOG.md while preserving the
  project's expectation that the FIRST markdown heading line contains the latest semantic version.
  The converter's auto version detection reads that first heading.

Features:
  * Increment semantic version: --part patch|minor|major
  * Or set explicit version via --set 1.4.0
  * Optional pre-release label: --pre rc1  -> 1.4.0-rc1
  * Custom date override (YYYY-MM-DD) or auto (UTC today)
  * Capture any '(unreleased)' bullet section (lines following a line containing '(unreleased)')
    and migrate those bullets under the new version heading.
  * Optional git commit and/or git tag creation.
  * Dry-run mode prints proposed CHANGELOG to stdout without writing.

Usage examples:
  Dry run bump patch:
    python3 python/bump_changelog.py --part patch --dry-run

  Explicit new version:
    python3 python/bump_changelog.py --set 2.0.0

  Pre-release:
    python3 python/bump_changelog.py --part minor --pre beta1

  With git commit + tag:
    python3 python/bump_changelog.py --part patch --commit --tag

Notes:
  * The script assumes CHANGELOG.md is located at repository root (one directory up from this file's parent).
  * It will refuse to overwrite an existing tag unless --force-tag is provided.
  * Generated heading format: '# <version> - <YYYY-MM-DD>'
  * Placeholder sections 'Added:' will be included if no migrated unreleased bullets are found.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import os
import re
import subprocess
import sys
from typing import List, Tuple, Optional

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHANGELOG_PATH = os.path.join(ROOT, 'CHANGELOG.md')

SEMVER_RE = re.compile(r'^(?:\[)?v?(?P<ver>[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.]+)?)(?:\])?')


def read_changelog() -> List[str]:
    if not os.path.isfile(CHANGELOG_PATH):
        print(f"ERROR: CHANGELOG.md not found at {CHANGELOG_PATH}", file=sys.stderr)
        sys.exit(2)
    with open(CHANGELOG_PATH, 'r', encoding='utf-8') as f:
        return f.read().splitlines()


def write_changelog(lines: List[str]):
    with open(CHANGELOG_PATH, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines).rstrip() + '\n')


def extract_current_version(lines: List[str]) -> Optional[str]:
    for line in lines:
        ls = line.strip()
        if ls.startswith('#'):
            m = SEMVER_RE.search(ls.lstrip('#').strip())
            if m:
                return m.group('ver')
            break  # first heading not semantic
    return None


def bump_version(cur: str, part: str, pre: Optional[str]) -> str:
    # Strip pre-release/build metadata for numeric bump
    core = re.split(r'[-+]', cur)[0]
    major, minor, patch = [int(x) for x in core.split('.')[:3]]
    if part == 'major':
        major += 1; minor = 0; patch = 0
    elif part == 'minor':
        minor += 1; patch = 0
    else:  # patch
        patch += 1
    new_ver = f"{major}.{minor}.{patch}"
    if pre:
        new_ver += f"-{pre}"
    return new_ver


def gather_unreleased(lines: List[str]) -> Tuple[List[str], List[str]]:
    """If a line containing '(unreleased)' exists, capture following bullet lines until blank/heading.
    Returns (captured_bullets, new_lines_without_unreleased_section)
    """
    out_lines = []
    capture = False
    captured: List[str] = []
    skipping = False
    for i, line in enumerate(lines):
        if not capture and '(unreleased)' in line.lower():
            capture = True
            skipping = True
            continue  # drop marker line
        if capture:
            if line.strip().startswith('#'):
                # stop at new heading
                capture = False
            elif not line.strip():
                # blank terminates unreleased block
                capture = False
            elif line.strip().startswith('-') or line.strip().startswith('*'):
                captured.append(line.strip())
                continue  # don't include original bullet (will be relocated)
            else:
                # Non-bullet ends the block
                capture = False
        if not capture and not (skipping and not line.strip()):
            out_lines.append(line)
        if not capture:
            skipping = False
    return captured, out_lines


def git_run(args: List[str]) -> Tuple[int, str]:
    try:
        res = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False, text=True)
        return res.returncode, (res.stdout.strip() or res.stderr.strip())
    except Exception as e:
        return 1, str(e)


def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(description="Auto-bump CHANGELOG.md and optionally create git commit/tag")
    g = p.add_mutually_exclusive_group()
    g.add_argument('--part', choices=['patch','minor','major'], default='patch', help='Semantic version component to increment (ignored if --set provided)')
    g.add_argument('--set', dest='set_version', help='Explicit version to set (overrides --part)')
    p.add_argument('--pre', help='Pre-release label to append (e.g. rc1)')
    p.add_argument('--date', help='Override release date (YYYY-MM-DD). Default: today UTC')
    p.add_argument('--dry-run', action='store_true', help='Print result to stdout; do not modify file')
    p.add_argument('--commit', action='store_true', help='Create a git commit for the bumped CHANGELOG')
    p.add_argument('--tag', action='store_true', help='Create git tag v<version> after bump (implies --commit)')
    p.add_argument('--force-tag', action='store_true', help='Overwrite existing tag if it already exists')
    p.add_argument('--no-placeholder', action='store_true', help='Do not add placeholder section when no unreleased bullets')

    args = p.parse_args(argv)

    lines = read_changelog()
    current = extract_current_version(lines)
    if not current and not args.set_version:
        print('ERROR: Could not detect current version from first heading and no --set provided.', file=sys.stderr)
        return 2

    unreleased_bullets, lines_wo_unrel = gather_unreleased(lines)

    if args.set_version:
        new_version = args.set_version.strip().lstrip('v')
    else:
        new_version = bump_version(current, args.part, args.pre)

    # If setting explicitly and includes pre part via --pre, ensure appended
    if args.set_version and args.pre and not new_version.endswith(f'-{args.pre}'):
        if '+' in new_version:  # don't append before build metadata
            base, plus = new_version.split('+',1)
            new_version = f"{base}-{args.pre}+{plus}"
        else:
            new_version = f"{new_version}-{args.pre}"

    # Date
    if args.date:
        rel_date = args.date
    else:
        rel_date = _dt.datetime.utcnow().date().isoformat()

    # Build new heading block
    heading = f"# {new_version} - {rel_date}"

    new_block: List[str] = [heading, '']
    if unreleased_bullets:
        new_block.append('Changes:')
        new_block.extend(unreleased_bullets)
        new_block.append('')
    elif not args.no_placeholder:
        new_block.extend(['Added:', '- (placeholder)', ''])

    # Assemble new content (prepend new block before previous content)
    new_lines = new_block + lines_wo_unrel

    if args.dry_run:
        print('\n'.join(new_lines))
    else:
        write_changelog(new_lines)
        print(f"CHANGELOG bumped: {current or 'N/A'} -> {new_version}")

    # Git operations (only if not dry-run)
    if (args.commit or args.tag) and not args.dry_run:
        # Stage CHANGELOG
        code, out = git_run(['git','add','CHANGELOG.md'])
        if code != 0:
            print(f"WARN: git add failed: {out}")
        # Commit
        msg = f"chore: release {new_version}" if not unreleased_bullets else f"chore: bump to {new_version}" 
        code, out = git_run(['git','commit','-m', msg])
        if code != 0:
            print(f"WARN: git commit failed: {out}")
        else:
            print(f"Git commit created: {msg}")
        if args.tag:
            tag_name = f"v{new_version}"
            # Check if tag exists
            code, out = git_run(['git','rev-parse','-q','--verify', f"refs/tags/{tag_name}"])
            if code == 0 and not args.force_tag:
                print(f"ERROR: tag {tag_name} already exists (use --force-tag to overwrite)")
                return 3
            if code == 0 and args.force_tag:
                git_run(['git','tag','-d', tag_name])
            code, out = git_run(['git','tag', tag_name])
            if code != 0:
                print(f"WARN: failed to create tag {tag_name}: {out}")
            else:
                print(f"Git tag created: {tag_name}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
