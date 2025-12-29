"""
CSV → JSON media outputs list converter

Converts semicolon-delimited CSV with columns:
  AspectRatio;Dimensions;Creative;Media;Template;Template_name

into a JSON object of the form:

{
  "1x1|06s": [
  { "size": "640x640",  "media": "TikTok" },
  { "size": "1440x1440", "media": "MetaInFeed" }
  ],
  "9x16_tiktok|15s": [
  { "size": "720x1280", "media": "TikTok" },
  { "size": "720x1280", "media": "MetaInFeed" }
  ]
}

Rules:
- Key is `<AspectRatio>[ _<Template_name> if Template==extra ]|<duration>` where
  duration is parsed from `Creative` by dropping the trailing `C[1-5]` and zero‑padding to 2 digits when needed (e.g. `6sC1`→`06s`).
- For consecutive rows that differ only by the `Creative` number (C2–C5) while the other fields match, only the first row is kept.
- Values are arrays of objects `{ "size": Dimensions, "media": Media }`, preserving first-seen order; duplicates per key are not repeated.
- Media labels are trimmed but case is preserved.

Usage:
  python3 python/tools/csv_json_media.py input.csv output.json

Options:
  --delimiter <char>   CSV delimiter (default ';')
  --trim / --no-trim   Trim surrounding whitespace on fields (default: trim)
  --dry-run            Parse only; print summary and do not write output
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
from collections import OrderedDict
from typing import Dict, Iterable, List, Tuple


CREATIVE_RE = re.compile(r"^(?P<dur>[0-9]+s)(?:C(?P<idx>[1-5]))?\s*$", re.I)


def _pad_duration_token(token: str) -> str:
  # token like '6s', '15s' → ensure 2-digit seconds when <10 ('06s')
  m = re.match(r"^(\d+)(s)$", token.strip())
  if not m:
    return token.strip()
  num = int(m.group(1))
  suf = m.group(2)
  if num < 10:
    return f"{num:02d}{suf}"
  return f"{num}{suf}"


def parse_duration(creative: str) -> Tuple[str, int | None]:
  m = CREATIVE_RE.match(creative or "")
  if not m:
    raise ValueError(f"Invalid Creative value: {creative!r}")
  dur = _pad_duration_token(m.group("dur"))
  idx = m.group("idx")
  return dur, (int(idx) if idx else None)


def sanitize_suffix(name: str) -> str:
  # Remove spaces/underscores and non-alnum; preserve case
  if name is None:
    return ""
  s = re.sub(r"[\s_]+", "", name)
  s = re.sub(r"[^A-Za-z0-9]", "", s)
  return s


def build_key(aspect_ratio: str, creative: str, template: str, template_name: str, do_trim: bool = True) -> str:
  ar = aspect_ratio.strip() if do_trim else aspect_ratio
  dur, _ = parse_duration(creative.strip() if do_trim else creative)
  key_ar = ar
  if (template.strip() if do_trim else template) == "extra":
    suffix = sanitize_suffix(template_name.strip() if do_trim else template_name)
    if suffix:
      key_ar = f"{key_ar}_{suffix}"
  return f"{key_ar}|{dur}"


def convert_rows(rows: Iterable[dict], trim: bool = True) -> Dict[str, List[Dict[str, str]]]:
  out: Dict[str, List[Dict[str, str]]] = OrderedDict()
  seen_pairs: Dict[str, set] = {}

  # For contiguous duplicate suppression (C2–C5 following the first of same group)
  last_group_no_index: Tuple[str, str, str, str, str] | None = None

  for row in rows:
    ar = row.get("AspectRatio", "")
    dims = row.get("Dimensions", "")
    creative = row.get("Creative", "")
    media = row.get("Media", "")
    template = row.get("Template", "")
    template_name = row.get("Template_name", "")

    if trim:
      ar = ar.strip(); dims = dims.strip(); creative = creative.strip(); media = media.strip(); template = template.strip(); template_name = template_name.strip()

    dur, _idx = parse_duration(creative)

    # Suppress consecutive variants that differ only by Creative number
    group_no_idx = (ar, dims, media, template, template_name, dur)
    if last_group_no_index == group_no_idx:
      # Same group as previous line; skip this subsequent variant
      continue
    last_group_no_index = group_no_idx

    key = build_key(ar, creative, template, template_name, do_trim=False)
    item = {"size": dims, "media": media}
    if key not in out:
      out[key] = []
      seen_pairs[key] = set()
    pair = (item["size"], item["media"])
    if pair not in seen_pairs[key]:
      out[key].append(item)
      seen_pairs[key].add(pair)

  return out


def read_csv(path: str, delimiter: str = ";") -> List[dict]:
  # Read entire file to allow simple header-based delimiter detection fallback
  with open(path, "r", encoding="utf-8-sig", newline="") as f:
    content = f.read()
  lines = content.splitlines()
  # Skip leading blank lines to ensure the header is on the first line
  start_idx = 0
  while start_idx < len(lines) and lines[start_idx].strip() == "":
    start_idx += 1
  header = lines[start_idx] if start_idx < len(lines) else ""

  # Resolve delimiter: prefer provided value; if headers not split as expected, fallback heuristics
  delims_to_try = [delimiter]
  if ";" not in delims_to_try:
    delims_to_try.append(";")
  if "," not in delims_to_try:
    delims_to_try.append(",")

  expected = ["AspectRatio", "Dimensions", "Creative", "Media", "Template", "Template_name"]

  from io import StringIO
  for d in delims_to_try:
    reader = csv.DictReader(StringIO("\n".join(lines[start_idx:])), delimiter=d)
    if reader.fieldnames and all(h in reader.fieldnames for h in expected):
      return list(reader)

  # If we reach here, headers were not recognized with common delimiters
  raise ValueError("Missing required headers; tried delimiters: " + ", ".join(delims_to_try))


def write_json(path: str, data: dict) -> None:
  with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)


def main() -> None:
  p = argparse.ArgumentParser(description="CSV → JSON media outputs list converter")
  p.add_argument("input", help="Path to input CSV")
  p.add_argument("output", help="Path to output JSON")
  p.add_argument("--delimiter", default=";", help="CSV delimiter (default ';')")
  grp = p.add_mutually_exclusive_group()
  grp.add_argument("--trim", dest="trim", action="store_true", help="Trim whitespace on all fields (default)")
  grp.add_argument("--no-trim", dest="trim", action="store_false", help="Disable whitespace trimming")
  p.set_defaults(trim=True)
  p.add_argument("--dry-run", action="store_true", help="Parse only and print summary; do not write JSON")
  args = p.parse_args()

  rows = read_csv(args.input, delimiter=args.delimiter)
  result = convert_rows(rows, trim=args.trim)

  if args.dry_run:
    # Print a brief summary for inspection
    total_items = sum(len(v) for v in result.values())
    print(f"keys={len(result)}, items={total_items}")
    for k in result:
      print(f"- {k}: {len(result[k])}")
    return

  os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
  write_json(args.output, result)


if __name__ == "__main__":
  main()

