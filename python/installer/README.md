# Standalone Binary Packaging (json_converter)

This folder contains the PyInstaller build helper for creating a one-file executable of the Python converter.

## Files

- `build_json_converter.py` - build entrypoint for PyInstaller
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
python3 python/installer/build_json_converter.py
```

Optional explicit version bake-in:

```sh
python3 python/installer/build_json_converter.py --converter-version 1.10.5
```

Build output:

- Executable: `python/build/json_converter/dist/json_converter`
- Work files: `python/build/json_converter/work/`
- Generated spec: `python/build/json_converter/spec/json_converter.spec`

The helper builds a `--onefile` binary and bundles required converter tooling (`media_converter.py`, `config_converter.py`) so `--media-config` and `--layer-config` work in the executable.

During build, a PyInstaller runtime hook is generated to bake `CONVERTER_VERSION` into the standalone binary.
Default resolution order for baked version is:

1. Build-time environment variable `CONVERTER_VERSION`
2. First heading in `CHANGELOG.md` (repo root), then `python/readMe/CHANGELOG.md`
3. Latest git tag
4. `0.0.0+<shortcommit>`
5. `dev`

This prevents frozen-runtime fallback drift caused by file-location differences.

## Quick Validation

From repository root:

```sh
./python/build/json_converter/dist/json_converter --help
```

Basic conversion:

```sh
./python/build/json_converter/dist/json_converter in/data_in.xlsx out/data_{country}.json --split-by-country
```

Conversion with both integration inputs:

```sh
./python/build/json_converter/dist/json_converter in/data_in.xlsx out/data_{country}.json \
  --split-by-country \
  --layer-config in/config_in.xlsx \
  --media-config in/media_in.xlsx
```

## Notes

- On macOS/Linux, `--add-data` path syntax uses `source:target` and is handled by `build_json_converter.py`.
- If the executable does not appear, inspect `python/build/json_converter/work/` logs and re-run the build helper.
