# Standalone Binary Packaging (csv_to_json)

This folder contains the PyInstaller build helper for creating a one-file executable of the Python converter.

## Files

- `build_csv_to_json.py` - build entrypoint for PyInstaller
- `requirements.txt` - packaging dependency list

## Prerequisites

From repository root:

```sh
python3 -m pip install -r python/installer/requirements.txt
```

If your project uses a virtual environment, activate it first.

## Build Workflow (Rebuilt Binary)

Run from repository root:

```sh
python3 python/installer/build_csv_to_json.py
```

Build output:

- Executable: `python/build/csv_to_json/dist/csv_to_json`
- Work files: `python/build/csv_to_json/work/`
- Generated spec: `python/build/csv_to_json/spec/csv_to_json.spec`

The helper builds a `--onefile` binary and bundles required converter tooling (`media_converter.py`, `config_converter.py`) so `--media-config` and `--layer-config` work in the executable.

## Quick Validation

From repository root:

```sh
./python/build/csv_to_json/dist/csv_to_json --help
```

Basic conversion:

```sh
./python/build/csv_to_json/dist/csv_to_json in/data_in.xlsx out/data_{country}.json --split-by-country
```

Conversion with both integration inputs:

```sh
./python/build/csv_to_json/dist/csv_to_json in/data_in.xlsx out/data_{country}.json \
  --split-by-country \
  --layer-config in/config_in.xlsx \
  --media-config in/media_in.xlsx
```

## Notes

- On macOS/Linux, `--add-data` path syntax uses `source:target` and is handled by `build_csv_to_json.py`.
- If the executable does not appear, inspect `python/build/csv_to_json/work/` logs and re-run the build helper.
