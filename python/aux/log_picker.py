"""Log picker

Collect selected lines from all ``*.log`` files in a given input directory and
write a condensed summary log into the repository's ``./log`` folder.

Selection criteria (line prefixes):
	RunId=
	ProjectPath:
	INFO {link_data} [data.json] ISO code used:
	Pipeline complete.
	Counts =>
	Timing (s) =>

Usage (CLI):
	python -m python.aux.log_picker --input-dir path/to/logs

Optional arguments:
	--output-file  Explicit path for the output log file (useful for tests)
	--encoding     Override file encoding used to read logs (default utf-8)
	--recursive    Recurse into sub-directories when gathering *.log files

The default output filename (if --output-file not supplied) is:
	./log/log_picker_<YYYYMMDD_HHMMSS>.log

Separator: A line consisting of 72 dashes plus the source filename.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import sys
from pathlib import Path
from typing import Iterable, List


PREFIXES: List[str] = [
	"RunId=",
	"ProjectPath:",
	"INFO {link_data} [data.json] ISO code used:",
	"Pipeline complete.",
	"Counts =>",
	"Timing (s) =>",
	# "INFO {add_layers} Processed",
]

SEPARATOR_WIDTH = 72


def find_repo_root() -> Path:
	"""Return repo root assuming this file lives in <root>/python/aux/.

	Falls back to current working directory if expected layout not found.
	"""
	here = Path(__file__).resolve()
	# Expect: .../<root>/python/aux/log_picker.py
	try:
		python_dir = here.parent.parent  # <root>/python
		root = python_dir.parent
		if (root / "log").is_dir():  # sanity check
			return root
	except Exception:
		pass
	return Path.cwd()


def iter_log_files(base: Path, recursive: bool) -> Iterable[Path]:
	"""Yield *.log files under base (non-recursive by default)."""
	if recursive:
		yield from (p for p in base.rglob("*.log") if p.is_file())
	else:
		yield from (p for p in base.glob("*.log") if p.is_file())


def pick_lines(path: Path, prefixes: List[str], encoding: str = "utf-8") -> List[str]:
	"""Return list of lines from file whose stripped content starts with any prefix.

	Lines are returned exactly as in file (no trailing newline removed except final strip).
	"""
	picked: List[str] = []
	try:
		with path.open("r", encoding=encoding, errors="replace") as f:
			for raw in f:
				line = raw.rstrip("\n")
				for pref in prefixes:
					if line.startswith(pref):
						picked.append(line)
						break
	except OSError as e:
		picked.append(f"<ERROR reading {path.name}: {e}>")
	return picked


def build_output_path(repo_root: Path, explicit: str | None) -> Path:
	log_dir = repo_root / "log"
	log_dir.mkdir(parents=True, exist_ok=True)
	if explicit:
		return Path(explicit).resolve()
	stamp = _dt.datetime.now().strftime("%Y%m%d_%H%M%S")
	return (log_dir / f"log_picker_{stamp}.log").resolve()


def write_summary(out_path: Path, gathered: List[tuple[Path, List[str]]]) -> None:
	with out_path.open("w", encoding="utf-8") as out:
		for idx, (src, lines) in enumerate(gathered, start=1):
			sep = f"{'-' * SEPARATOR_WIDTH} {src.name}"
			out.write(sep + "\n")
			if lines:
				for l in lines:
					out.write(l + "\n")
			else:
				out.write("<NO MATCHING LINES>\n")
			# Add blank line after each block for readability
			out.write("\n")
	# Provide a simple stdout notification
	print(f"Wrote summary: {out_path}")


def parse_args(argv: List[str]) -> argparse.Namespace:
	p = argparse.ArgumentParser(description="Pick selected lines from log files")
	p.add_argument("--input-dir", required=True, help="Directory containing *.log files")
	p.add_argument("--output-file", help="Explicit output file path")
	p.add_argument("--encoding", default="utf-8", help="Encoding for reading log files")
	p.add_argument("--recursive", action="store_true", help="Recurse into subdirectories")
	return p.parse_args(argv)


def main(argv: List[str] | None = None) -> int:
	ns = parse_args(argv or sys.argv[1:])
	input_dir = Path(ns.input_dir).expanduser().resolve()
	if not input_dir.is_dir():
		print(f"Input directory does not exist or is not a directory: {input_dir}", file=sys.stderr)
		return 2
	repo_root = find_repo_root()
	out_path = build_output_path(repo_root, ns.output_file)

	gathered: List[tuple[Path, List[str]]] = []
	files = sorted(iter_log_files(input_dir, ns.recursive))
	if not files:
		print(f"No .log files found in {input_dir}", file=sys.stderr)
	for f in files:
		picked = pick_lines(f, PREFIXES, encoding=ns.encoding)
		gathered.append((f, picked))

	write_summary(out_path, gathered)
	return 0


if __name__ == "__main__":  # pragma: no cover - manual invocation
	raise SystemExit(main())