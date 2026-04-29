#!/usr/bin/env python3
"""Extract workbook theme XML from an XLSX template.

Reads `xl/theme/theme1.xml` from a source XLSX file and writes it to an XML
file that can be reused by `srt_to_csv.py` via `--xlsx-theme-file`.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import zipfile


DEFAULT_OUTPUT = Path(__file__).resolve().parent / "themes" / "subtitles_theme.xml"
_THEME_MEMBER = "xl/theme/theme1.xml"


def extract_theme_xml(template_xlsx: Path, output_xml: Path) -> None:
    if not template_xlsx.is_file():
        raise SystemExit(f"Template XLSX not found: {template_xlsx}")

    try:
        with zipfile.ZipFile(template_xlsx, "r") as zf:
            try:
                theme_bytes = zf.read(_THEME_MEMBER)
            except KeyError:
                raise SystemExit(
                    f"Template does not contain '{_THEME_MEMBER}': {template_xlsx}"
                )
    except zipfile.BadZipFile:
        raise SystemExit(f"Invalid XLSX/ZIP file: {template_xlsx}")

    output_xml.parent.mkdir(parents=True, exist_ok=True)
    output_xml.write_bytes(theme_bytes)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Refresh subtitles theme XML from a template XLSX"
    )
    parser.add_argument(
        "template",
        help="Path to source XLSX template",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT),
        help=(f"Output XML file path (default: {DEFAULT_OUTPUT})"),
    )
    args = parser.parse_args()

    template = Path(args.template).expanduser().resolve()
    output = Path(args.output).expanduser().resolve()

    extract_theme_xml(template, output)
    print(f"Theme extracted: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
