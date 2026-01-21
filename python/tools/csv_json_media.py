"""
CSV → JSON media outputs list converter

Accepts semicolon-delimited CSV with columns:
  AspectRatio;Dimensions;Duration;Title;Creative;Media;Template;Template_name

Notes:
- `Duration` and `Title` are the preferred source; `Creative` may remain present for backward compatibility but is not required.

Emits a JSON object of the form:

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
- Key is `<AspectRatio>[ _<Template_name> if Template==extra ]|<duration>`.
- Duration is sourced from the `Duration` column when available, normalized to a token like `06s`, `15s`, `30s`. If `Duration` is missing/empty, it is parsed from `Creative` by dropping a trailing `C[1-5]` and zero‑padding when needed (e.g., `6sC1`→`06s`).
- For consecutive rows that differ only by creative variant/title while other fields match, only the first row is kept (consecutive dedup).
- Values are arrays of objects `{ "size": Dimensions, "media": Media }`, preserving first-seen order; duplicates per key are not repeated.
- Media labels are trimmed but case is preserved.

Usage:
  python3 python/tools/csv_json_media.py input.csv output.json

Options:
  --delimiter <char>   CSV delimiter (default ';')
  --trim / --no-trim   Trim surrounding whitespace on fields (default: trim)
  --dry-run            Parse only; print summary and do not write output
  --compact            Write JSON with inline array items (e.g., { "size":"..", "media":".." })
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
from collections import OrderedDict
from typing import Dict, Iterable, List, Tuple, DefaultDict


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


def normalize_duration(raw: str) -> str:
  """
  Normalize various inputs like '6', '06', '6s', '06s' into a token '06s'.
  Leaves already-normalized multi-digit tokens like '15s' unchanged.
  """
  s = (raw or "").strip()
  if not s:
    return s
  # If suffix 's' is missing, append it
  if re.match(r"^\d+$", s):
    s = s + "s"
  # If in the form '<digits>s', zero-pad when <10
  return _pad_duration_token(s)


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


def build_key_with_duration(aspect_ratio: str, duration_token: str, template: str, template_name: str, do_trim: bool = True) -> str:
  """
  Build key using a provided duration token (from the Duration column).
  """
  ar = aspect_ratio.strip() if do_trim else aspect_ratio
  dur = normalize_duration(duration_token.strip() if do_trim else duration_token)
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
    # Safely extract values (DictReader may set missing fields to None)
    ar = (row.get("AspectRatio") or "")
    dims = (row.get("Dimensions") or "")
    creative = (row.get("Creative") or "")
    duration = (row.get("Duration") or "")
    media = (row.get("Media") or "")
    template = (row.get("Template") or "")
    template_name = (row.get("Template_name") or "")

    if trim:
      ar = ar.strip(); dims = dims.strip(); creative = creative.strip(); duration = duration.strip(); media = media.strip(); template = template.strip(); template_name = template_name.strip()

    # Skip spacer/blank rows and rows without essential fields.
    # Essential: ar, dims, media; plus at least one of duration or creative.
    if (not ar or not dims or not media or (not duration and not creative)):
      # Common sheet separators may contain ellipsis '…' — treat as blank
      continue

    # Determine duration token: prefer Duration column; fallback to Creative
    if duration:
      dur = normalize_duration(duration)
      _idx = None
    else:
      dur, _idx = parse_duration(creative)

    # Suppress consecutive variants that differ only by Creative number
    group_no_idx = (ar, dims, media, template, template_name, dur)
    if last_group_no_index == group_no_idx:
      # Same group as previous line; skip this subsequent variant
      continue
    last_group_no_index = group_no_idx

    key = (
      build_key_with_duration(ar, dur, template, template_name, do_trim=False)
      if duration
      else build_key(ar, creative, template, template_name, do_trim=False)
    )
    # Normalize dimensions: remove whitespaces (e.g., '1440 x 1800' → '1440x1800')
    norm_dims = re.sub(r"\s+", "", dims)
    item = {"size": norm_dims, "media": media}
    if key not in out:
      out[key] = []
      seen_pairs[key] = set()
    pair = (item["size"], item["media"])
    if pair not in seen_pairs[key]:
      out[key].append(item)
      seen_pairs[key].add(pair)

  return out


def group_by_country_language(
  rows: Iterable[dict],
  country_col: str = "Country",
  language_col: str = "Language",
  trim: bool = True,
) -> Dict[Tuple[str, str], List[dict]]:
  groups: DefaultDict[Tuple[str, str], List[dict]] = OrderedDict()  # preserve insertion order
  for row in rows:
    country = (row.get(country_col) or "")
    language = (row.get(language_col) or "")
    if trim:
      country = (country or "").strip()
      language = (language or "").strip()
    key = (country, language)
    groups.setdefault(key, []).append(row)
  return groups


def _sanitize_token_for_filename(token: str) -> str:
  if token is None:
    return ""
  s = token.strip()
  # Replace spaces with underscores, drop non-filename-safe chars
  s = re.sub(r"\s+", "_", s)
  s = re.sub(r"[^A-Za-z0-9_\-]", "", s)
  return s


def expand_output_pattern(pattern: str, country: str, language: str) -> str:
  """
  Expand a filename pattern with tokens and optional segments:
  Tokens supported:
    {country}, {COUNTRY} → raw or uppercased country
    {lang}, {LANG}       → raw or uppercased language
  Optional segments may be wrapped in square brackets: [ ... ]
  A bracketed segment is included only if any token inside it expands to a non-empty value.
  """
  country_raw = _sanitize_token_for_filename(country or "")
  language_raw = _sanitize_token_for_filename(language or "")
  mapping = {
    "country": country_raw,
    "COUNTRY": country_raw.upper(),
    "lang": language_raw,
    "LANG": language_raw.upper(),
  }

  # Handle optional bracketed segments first
  def repl_optional(m: re.Match) -> str:
    inner = m.group(1)
    # Include segment only if any token inside has a non-empty value
    tokens_in_inner = re.findall(r"\{(country|COUNTRY|lang|LANG)\}", inner)
    should_include = any(mapping[t] for t in tokens_in_inner)
    if not should_include:
      return ""
    expanded = inner
    for k, v in mapping.items():
      expanded = expanded.replace("{" + k + "}", v)
    return expanded

  pat = re.sub(r"\[([^\]]+)\]", repl_optional, pattern)
  for k, v in mapping.items():
    pat = pat.replace("{" + k + "}", v)
  # Ensure .json extension present
  if not pat.lower().endswith(".json"):
    pat = pat + ".json"
  return pat


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

  base_required = ["AspectRatio", "Dimensions", "Media", "Template", "Template_name"]
  one_of = ["Duration", "Creative"]

  from io import StringIO
  for d in delims_to_try:
    reader = csv.DictReader(StringIO("\n".join(lines[start_idx:])), delimiter=d)
    if reader.fieldnames:
      has_base = all(h in reader.fieldnames for h in base_required)
      has_any = any(h in reader.fieldnames for h in one_of)
      if has_base and has_any:
        return list(reader)

  # If we reach here, headers were not recognized with common delimiters
  raise ValueError("Missing required headers; tried delimiters: " + ", ".join(delims_to_try))


def write_json(path: str, data: dict, compact: bool = False) -> None:
  with open(path, "w", encoding="utf-8") as f:
    if not compact:
      json.dump(data, f, ensure_ascii=False, indent=2)
      return
    # Compact formatter: keep arrays multiline but items inline
    f.write("{\n")
    items = list(data.items())
    for ki, (key, arr) in enumerate(items):
      f.write(f"  \"{key}\": [ \n")
      for ai, it in enumerate(arr):
        size_js = json.dumps(it.get("size", ""), ensure_ascii=False)
        media_js = json.dumps(it.get("media", ""), ensure_ascii=False)
        f.write(f"    {{ \"size\":{size_js}, \"media\":{media_js} }}")
        if ai < len(arr) - 1:
          f.write(",\n")
        else:
          f.write("\n")
      f.write("  ]")
      if ki < len(items) - 1:
        f.write(",\n")
      else:
        f.write("\n")
    f.write("}\n")


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
  p.add_argument("--compact", action="store_true", help="Write JSON with inline array items")
  # Split-by-country/language options
  p.add_argument("--split-by-country", action="store_true", help="Split outputs per Country/Language columns")
  p.add_argument("--country-col", default="Country", help="Column name used for country grouping (default 'Country')")
  p.add_argument("--language-col", default="Language", help="Column name used for language grouping (default 'Language')")
  p.add_argument(
    "--output-pattern",
    default="media_{COUNTRY}[_{LANG}].json",
    help="Filename pattern for split outputs; supports tokens {country},{COUNTRY},{lang},{LANG}; bracketed segments are optional",
  )
  args = p.parse_args()

  rows = read_csv(args.input, delimiter=args.delimiter)
  
  if args.split_by_country:
    groups = group_by_country_language(rows, country_col=args.country_col, language_col=args.language_col, trim=args.trim)
    if args.dry_run:
      print(f"groups={len(groups)}")
      for (country, language), g_rows in groups.items():
        result = convert_rows(g_rows, trim=args.trim)
        total_items = sum(len(v) for v in result.values())
        label = (country or "ALL") + ("_" + language if language else "")
        print(f"- {label}: keys={len(result)}, items={total_items}")
      return

    # Determine base output directory from provided output arg
    base_dir = args.output
    # If a file path with extension is provided, use its directory; otherwise treat as directory
    if os.path.splitext(base_dir)[1]:
      base_dir = os.path.dirname(base_dir) or "."
    os.makedirs(base_dir or ".", exist_ok=True)

    for (country, language), g_rows in groups.items():
      fname = expand_output_pattern(args.output_pattern, country, language)
      out_path = os.path.join(base_dir, fname)
      result = convert_rows(g_rows, trim=args.trim)
      # Skip writing empty groups (e.g., separator-only rows)
      if not result:
        continue
      write_json(out_path, result, compact=args.compact)
    return

  # Single-output mode
  result = convert_rows(rows, trim=args.trim)
  if args.dry_run:
    # Print a brief summary for inspection
    total_items = sum(len(v) for v in result.values())
    print(f"keys={len(result)}, items={total_items}")
    for k in result:
      print(f"- {k}: {len(result[k])}")
    return

  os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
  write_json(args.output, result, compact=args.compact)


if __name__ == "__main__":
  main()

