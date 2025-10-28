# json_tools: AE Scripts + CSV→JSON tools

This repository contains two main parts:

1) Adobe After Effects scripting pipeline (ExtendScript) for composition setup, output pathing, and queueing to AME.
2) A Python CLI that converts campaign CSVs to structured JSON consumed by the AE pipeline.

Use this page as a docs index to navigate the project.

## Documentation index

- After Effects pipeline
  - Guide: `script/ae/readMe/README.md` (Step-by-step behavior, options, and logging)
- CSV → JSON Converter (Python)
  - Guide: `python/README.md` (schema, CLI flags, validation rules, examples)
- Expressions library for AE
  - Folder: `expression_ae/` (small expression snippets used in comps)
- Samples and inputs
  - Inputs: `in/`
  - Samples: `samples/`
- Notes / How‑tos / logs
  - Folder: `doku/`

## Overview

The pipeline converts CSV briefs into JSON and drives AE to produce batched renders:

- Python app parses CSV (multi‑country, multi‑video), validates structure, and writes JSON.
- AE scripts read JSON, resolve ISO/country and duration, set output folders/files, optionally apply Output Module templates, and queue to AME.
- Logging is designed for large batches: compact per‑item lines, verbose toggles, and reliable overflow indicators.

## Quick start

1) Convert your CSV to JSON using the Python CLI.
2) Open the AE project prepared for the campaign.
3) Run the AE pipeline (see `script/ae/readMe/README.md` for Step 1–7), which will set destinations and queue to AME.

Details, flags, and edge cases are covered in the linked guides above.

## Repository layout

```
README.md                      # This index
script/ae/readMe/README.md     # AE pipeline guide
python/README.md               # Python converter guide (moved from root)
expression_ae/                 # AE expressions
in/                            # Input CSVs and variants
samples/                       # Sample CSV/JSON data
doku/                          # Notes and process docs
```

## Changelog

See component‑specific READMEs for recent changes:
- AE: `script/ae/readMe/README.md` (integration notes)
- Python: `python/README.md` (schema and CLI updates)
