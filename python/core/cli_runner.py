from __future__ import annotations

import argparse
import copy
import json
import os
import re
import subprocess
import sys
from typing import Any, Callable, Dict, List, Optional, Tuple, cast

from .generation_metadata import inject_generation_metadata
from .integration_injections import (
    inject_layer_config_payload,
    inject_media_mapping,
)
from .output_paths import (
    ensure_country_placeholder,
    resolve_country_output_path,
    resolve_single_country_output_path,
    trim_logo_anim_flag_for_country,
)
from .validation_reports import write_validation_report


def build_cli_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Convert subtitle CSV/XLSX to JSON")
    p.add_argument("input", help="Path to input CSV file")
    p.add_argument("output", help="Path to output JSON file")
    p.add_argument(
        "--fps",
        type=float,
        default=None,
        help="Frames per second for HH:MM:SS:FF timecodes. Default: use input meta_global fps when present, otherwise 25. Use this flag to override input FPS.",
    )
    p.add_argument(
        "--no-orientation",
        action="store_true",
        help="Emit legacy non-orientation shape: flat claim/disclaimer/logo arrays and single videoId (landscape only)",
    )
    p.add_argument(
        "--start-line",
        type=int,
        default=1,
        help="Starting line index in output (default: 1)",
    )
    p.add_argument(
        "--round",
        dest="round_digits",
        type=int,
        default=2,
        help="Round seconds to N digits (default: 2; use -1 to disable)",
    )
    p.add_argument(
        "--times-as-string",
        action="store_true",
        help="Write time values as strings (keeps trailing zeros)",
    )
    p.add_argument(
        "--no-strip-text",
        action="store_true",
        help="Do not strip whitespace from text cells",
    )
    p.add_argument(
        "--keep-empty-text",
        action="store_true",
        help="Keep rows where text is empty/whitespace",
    )
    p.add_argument(
        "--encoding", default="utf-8-sig", help="CSV file encoding (default: utf-8-sig)"
    )
    p.add_argument(
        "--delimiter",
        default="auto",
        help=(
            "CSV delimiter. One of: auto (default), comma, semicolon, tab, pipe, or a single character. "
            "If auto, the script will sniff among , ; TAB |"
        ),
    )
    p.add_argument(
        "--xlsx-sheet",
        default=None,
        help="XLSX only: sheet name to read (default: 'data' if present, otherwise first sheet)",
    )
    p.add_argument(
        "--start-col",
        help="Override Start column by name or 1-based index",
        default=None,
    )
    p.add_argument(
        "--end-col", help="Override End column by name or 1-based index", default=None
    )
    p.add_argument(
        "--text-col", help="Override Text column by name or 1-based index", default=None
    )
    p.add_argument(
        "--verbose", action="store_true", help="Print detected delimiter and headers"
    )
    p.add_argument(
        "--schema-version",
        default="v2",
        help="Schema version tag to use if not supplied via meta_global 'schemaVersion' row (default v2)",
    )
    p.add_argument(
        "--no-merge-subtitles",
        action="store_true",
        help="Disable merging of multi-line subtitles with same line number",
    )
    p.add_argument(
        "--merge-disclaimer",
        action="store_false",
        help="Disable merging of multi-line disclaimer continuation lines",
    )
    p.add_argument(
        "--merge-disclaimer-02",
        action="store_false",
        help="Disable merging of multi-line disclaimer_02 continuation lines",
    )
    p.add_argument(
        "--cast-metadata",
        action="store_true",
        help="Attempt numeric casting of metadata values (int/float detection)",
    )
    p.add_argument(
        "--join-claim",
        action="store_true",
        help="Join multiple claim rows with same timing into one block (newline separated)",
    )
    p.add_argument(
        "--prefer-local-claim-disclaimer",
        action="store_false",
        dest="prefer_local_claim_disclaimer",
        help="(Deprecated name) Disable per-video local claim/disclaimer override (default: enabled)",
    )
    p.add_argument(
        "--no-local-claim-override",
        action="store_false",
        dest="prefer_local_claim_disclaimer",
        help="Alias: disable per-video local claim/disclaimer override (default: enabled)",
    )
    p.add_argument(
        "--test-mode",
        action="store_true",
        help="Prefix per-video claim/disclaimer/disclaimer_02 text with '<videoId>_' for testing",
    )
    p.add_argument(
        "--claims-as-objects",
        action="store_true",
        help="In each video, output claims as claim_01, claim_02, ... objects instead of a single 'claim' array",
    )
    p.add_argument(
        "--check",
        action="store_true",
        help="Run validation + inspection preview only; do not write output files",
    )
    p.add_argument(
        "--strict",
        action="store_true",
        help="With --check: return non-zero when validation errors are present",
    )
    p.add_argument(
        "--required-global-keys",
        default="briefVersion,fps",
        help="Comma-separated list of required keys that must appear in metadataGlobal (default: briefVersion,fps). Empty string to disable.",
    )
    p.add_argument(
        "--missing-keys-warn",
        action="store_true",
        help="Treat missing required global metadata keys as warnings (do not fail validation)",
    )
    p.add_argument(
        "--validation-report",
        default=None,
        help="Write a JSON validation report to this path during --check",
    )
    p.add_argument(
        "--auto-output",
        action="store_true",
        help="Derive output name from input base (adds _{country} when splitting)",
    )
    p.add_argument(
        "--output-dir",
        default=None,
        help="Directory for auto-derived outputs (default: input file directory)",
    )
    p.add_argument(
        "--split-by-country",
        action="store_true",
        help="When multiple Text columns exist, write one JSON per country using output pattern",
    )
    p.add_argument(
        "--country-column",
        type=int,
        default=None,
        help="1-based index among Text columns to select when not splitting",
    )
    p.add_argument(
        "--output-pattern",
        default=None,
        help="Pattern for outputs; use {country}. Applies to split mode and to single-country exports with --country-column. If omitted, infer from output path by inserting _{country} before extension.",
    )
    p.add_argument(
        "--country-variant-index",
        type=int,
        default=None,
        help=(
            "Select which duplicated country column pair (variant) to use (0-based). When omitted, first pair is used."
        ),
    )
    p.add_argument(
        "--sample",
        action="store_true",
        help="Also write a truncated preview JSON alongside each output (adds _sample before extension)",
    )
    p.add_argument(
        "--converter-version",
        default="auto",
        help=(
            "Converter build/version tag. If set to 'auto' (default) or left as 'dev', the tool will attempt to derive a version automatically. "
            "Source runs prefer CHANGELOG heading first; frozen runs use CONVERTER_VERSION env when available. "
            "Fallback order then uses latest git tag, then '0.0.0+<shortcommit>', else 'dev'."
        ),
    )
    p.add_argument(
        "--no-generation-meta",
        action="store_true",
        help="Disable injection of generation metadata (generatedAt, inputSha256, converterVersion, etc.)",
    )
    p.add_argument(
        "--no-logo-anim-overview",
        action="store_true",
        help="Do not embed aggregated logo_anim_flag mapping object in metadataGlobal (CSV to JSON 47)",
    )
    p.add_argument(
        "--flags-overview-object-always",
        action="store_true",
        help="Emit metadataGlobal *_flag overviews always as objects (default behavior emits scalar when default-only and object when targeted exists)",
    )
    p.add_argument(
        "--controller-always-emit",
        action="store_true",
        help="Legacy behavior: emit per-video controller_NN rows from global controller_NN when local rows are missing",
    )

    p.add_argument(
        "--media-config",
        default=None,
        help="Optional path to media config CSV/XLSX for injection per country/language (exact match only)",
    )
    p.add_argument(
        "--media-delimiter", default=";", help="Delimiter for media CSV (default ';')"
    )
    p.add_argument(
        "--media-country-col",
        default="Country",
        help="Country column name in media CSV (default 'Country')",
    )
    p.add_argument(
        "--media-language-col",
        default="Language",
        help="Language column name in media CSV (default 'Language')",
    )
    p.add_argument(
        "--layer-config",
        default=None,
        help="Optional path to layer config XLSX for injection into config.addLayers",
    )
    p.add_argument(
        "--layer-config-required",
        action="store_true",
        help=(
            "Treat all --layer-config failures as fatal: missing file, converter unavailable, "
            "and conversion errors all abort with rc=1. "
            "By default all three are non-fatal warnings and conversion continues."
        ),
    )
    return p


def run_cli(
    argv: Optional[List[str]],
    *,
    convert_csv_to_json: Callable[..., Dict[str, Any]],
    script_file_path: str,
    layercfg_convert_workbook: Optional[Callable[..., Any]],
    media_read_csv: Optional[Callable[..., Any]],
    media_group_by_country_language: Optional[Callable[..., Any]],
    media_convert_rows: Optional[Callable[..., Any]],
) -> int:
    p = build_cli_parser()
    args = p.parse_args(argv)

    runtime_error_count = 0

    def _report_runtime_error(message: str):
        nonlocal runtime_error_count
        runtime_error_count += 1
        print(message, file=sys.stderr)

    def _print_conversion_summary(files_written: int, validation_errors: int = 0):
        print(
            f"Conversion complete: Files written: {files_written}, Errors: {runtime_error_count + validation_errors}"
        )

    if not os.path.exists(args.input):
        _report_runtime_error(
            f"FileNotFoundError: [Errno 2] No such file or directory: '{args.input}'"
        )
        _print_conversion_summary(0)
        return 1

    def _auto_version() -> str:
        env_val = os.getenv("CONVERTER_VERSION")
        # In frozen binaries, the runtime hook bakes this value and source files
        # may be unavailable. Prefer env in that context only.
        if getattr(sys, "frozen", False) and env_val and env_val.strip():
            return env_val.strip()
        try:
            repo_root = os.path.dirname(
                os.path.dirname(os.path.abspath(script_file_path))
            )
            py_dir = os.path.dirname(os.path.abspath(script_file_path))
            changelog_candidates = [
                os.path.join(repo_root, "CHANGELOG.md"),
                os.path.join(py_dir, "readMe", "CHANGELOG.md"),
            ]
            for changelog_path in changelog_candidates:
                if os.path.isfile(changelog_path):
                    with open(changelog_path, "r", encoding="utf-8") as chf:
                        for line in chf:
                            stripped_line = line.strip()
                            if stripped_line.startswith("#"):
                                heading = stripped_line.lstrip("#").strip()
                                m = re.match(
                                    r"\[?v?([0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.]+)?)",
                                    heading,
                                )
                                if m:
                                    return m.group(1)
                                token = heading.split()[0]
                                if re.match(r"v?[0-9]+\.[0-9]+(\.[0-9]+)?", token):
                                    return token.lstrip("v")
                                break
        except Exception:
            pass
        # For source runs, allow env fallback only when changelog parsing fails.
        if env_val and env_val.strip():
            return env_val.strip()
        try:
            tag = (
                subprocess.check_output(
                    ["git", "describe", "--tags", "--abbrev=0"],
                    stderr=subprocess.DEVNULL,
                )
                .decode("utf-8")
                .strip()
            )
            if tag:
                return tag[1:] if tag.startswith("v") else tag
        except Exception:
            pass
        try:
            sc = (
                subprocess.check_output(
                    ["git", "rev-parse", "--short", "HEAD"], stderr=subprocess.DEVNULL
                )
                .decode("utf-8")
                .strip()
            )
            if sc:
                return f"0.0.0+{sc}"
        except Exception:
            pass
        return "dev"

    if args.converter_version in ("auto", "dev", "", None):  # type: ignore[arg-type]
        try:
            args.converter_version = _auto_version()
        except Exception:
            args.converter_version = "dev"

    if args.auto_output:
        in_base = os.path.splitext(os.path.basename(args.input))[0]
        out_dir = (
            args.output_dir
            or os.path.dirname(os.path.abspath(args.input))
            or os.getcwd()
        )
        if (
            args.split_by_country
            or ("{country}" in (args.output or ""))
            or args.output_pattern
            or args.country_column
        ):
            args.output = os.path.join(out_dir, f"{in_base}_{{country}}.json")
        else:
            args.output = os.path.join(out_dir, f"{in_base}.json")

    round_ndigits: Optional[int]
    if args.round_digits is not None and args.round_digits >= 0:
        round_ndigits = args.round_digits
    else:
        round_ndigits = None

    data = convert_csv_to_json(
        input_csv=args.input,
        fps=args.fps,
        start_line_index=args.start_line,
        round_ndigits=round_ndigits,
        times_as_string=args.times_as_string,
        strip_text=not args.no_strip_text,
        skip_empty_text=not args.keep_empty_text,
        encoding=args.encoding,
        delimiter=args.delimiter,
        start_col=args.start_col,
        end_col=args.end_col,
        text_col=args.text_col,
        verbose=args.verbose,
        schema_version=args.schema_version,
        merge_subtitles=not args.no_merge_subtitles,
        merge_disclaimer=not args.merge_disclaimer,
        merge_disclaimer_02=not args.merge_disclaimer_02,
        cast_metadata=args.cast_metadata,
        join_claim=args.join_claim,
        prefer_local_claim_disclaimer=args.prefer_local_claim_disclaimer,
        test_mode=args.test_mode,
        claims_as_objects=args.claims_as_objects,
        no_orientation=args.no_orientation,
        country_variant_index=args.country_variant_index,
        flags_overview_object_always=args.flags_overview_object_always,
        xlsx_sheet=args.xlsx_sheet,
        controller_always_emit=args.controller_always_emit,
    )

    if args.no_logo_anim_overview and isinstance(data, dict):

        def _strip(obj: Dict[str, Any]):
            mg = obj.get("metadataGlobal") or obj.get("metadata")
            if isinstance(mg, dict) and "logo_anim_flag" in mg:
                del mg["logo_anim_flag"]

        if data.get("_multi"):
            for _c, node in (data.get("byCountry") or {}).items():
                if isinstance(node, dict):
                    _strip(node)
        else:
            _strip(data)

    if (not args.no_generation_meta) and (not getattr(args, "check", False)):
        inject_generation_metadata(
            data,
            input_path=args.input,
            converter_version=args.converter_version,
            script_file_path=script_file_path,
        )

    layer_config_payload: Optional[Dict[str, Any]] = None
    if args.layer_config:
        if not os.path.isfile(args.layer_config):
            _report_runtime_error(
                f"Warning: failed to load layer config '{args.layer_config}': "
                f"[Errno 2] No such file or directory: '{args.layer_config}'"
            )
            if args.layer_config_required:
                _print_conversion_summary(0)
                return 1
        elif layercfg_convert_workbook is None:
            _report_runtime_error(
                "Layer config converter not available; cannot process --layer-config"
            )
            if args.layer_config_required:
                _print_conversion_summary(0)
                return 1
        else:
            try:
                converted = layercfg_convert_workbook(
                    in_path=args.layer_config,
                    separator=";",
                    layer_names_sheet="LAYER_NAME_CONFIG_items",
                    recenter_rules_sheet="LAYER_NAME_CONFIG_recenterRules",
                    root_key="LAYER_NAME_CONFIG",
                )
                if isinstance(converted, dict):
                    add_layers_payload: Optional[Dict[str, Any]] = None
                    cfg = converted.get("config")
                    if isinstance(cfg, dict):
                        add_layers = cfg.get("addLayers")
                        if isinstance(add_layers, dict):
                            add_layers_payload = cast(Dict[str, Any], add_layers)
                    if add_layers_payload is None:
                        legacy_add_layers = converted.get("addLayers")
                        if isinstance(legacy_add_layers, dict):
                            add_layers_payload = cast(Dict[str, Any], legacy_add_layers)
                    if add_layers_payload is None:
                        legacy = converted.get("LAYER_NAME_CONFIG")
                        if isinstance(legacy, dict):
                            add_layers_payload = {"LAYER_NAME_CONFIG": legacy}

                    if isinstance(add_layers_payload, dict):
                        layer_config_payload = add_layers_payload
                    else:
                        raise ValueError(
                            "layer config payload missing config.addLayers/LAYER_NAME_CONFIG"
                        )
            except Exception as ex:
                _report_runtime_error(
                    f"Failed to load layer config '{args.layer_config}': {ex}"
                )
                if args.layer_config_required:
                    _print_conversion_summary(0)
                    return 1

    media_groups_map: Dict[Tuple[str, str], Dict[str, Any]] = {}
    if args.media_config:
        if (
            media_read_csv is None
            or media_group_by_country_language is None
            or media_convert_rows is None
        ):
            print(
                "Warning: media tools not available; skipping --media-config integration",
                file=sys.stderr,
            )
        elif not os.path.isfile(args.media_config):
            _report_runtime_error(
                f"Warning: failed to load media config '{args.media_config}': "
                f"[Errno 2] No such file or directory: '{args.media_config}'"
            )
        else:
            try:
                m_rows = media_read_csv(
                    args.media_config, delimiter=args.media_delimiter
                )
                groups = media_group_by_country_language(
                    m_rows,
                    country_col=args.media_country_col,
                    language_col=args.media_language_col,
                    trim=True,
                )
                for (ctry, lang), g_rows in groups.items():
                    mapping = media_convert_rows(g_rows, trim=True)
                    if mapping:
                        media_groups_map[(ctry, lang)] = mapping
            except Exception as ex:
                print(
                    f"Warning: failed to load media config '{args.media_config}': {ex}",
                    file=sys.stderr,
                )

    def _validate_structure(obj: Dict[str, Any]) -> Dict[str, List[str]]:
        errs: List[str] = []
        warnings: List[str] = []
        raw_keys = args.required_global_keys.strip()
        if raw_keys in ("", '""', "none", "off", "disable", "disabled"):
            required_global_keys = []
        else:
            parts = []
            for segment in raw_keys.split(","):
                seg = segment.strip().strip('"').strip("'")
                if seg:
                    parts.append(seg)
            required_global_keys = parts
        if (
            any(k in obj for k in ("subtitles", "claim", "disclaimer", "disclaimer_02"))
            and "videos" not in obj
        ):
            for arr_name in ("subtitles", "claim", "disclaimer", "disclaimer_02"):
                arr = obj.get(arr_name)
                if arr is None:
                    continue
                if not isinstance(arr, list):
                    errs.append(f"{arr_name} is not a list")
                    continue
                prev_out: Optional[float] = None
                for i, item in enumerate(arr):
                    if not isinstance(item, dict):
                        errs.append(f"{arr_name}[{i}] not an object")
                        continue
                    tin = item.get("in")
                    tout = item.get("out")
                    try:
                        if tin is not None and tout is not None:
                            ftin = float(tin)
                            ftout = float(tout)
                            if ftin > ftout:
                                errs.append(
                                    f"{arr_name}[{i}] in > out ({tin} > {tout})"
                                )
                            if prev_out is not None and ftin < prev_out:
                                errs.append(
                                    f"{arr_name}[{i}] overlaps previous (start {ftin} < prev end {prev_out})"
                                )
                            prev_out = ftout
                    except Exception:
                        pass
            return {"errors": errs, "warnings": warnings}

        if args.no_orientation:
            for nm in ("claim", "disclaimer", "disclaimer_02", "logo"):
                val = obj.get(nm)
                if val is not None and not isinstance(val, list):
                    errs.append(f"{nm} must be a list in --no-orientation mode")
        else:

            def _validate_orientation_array(name: str, val: Any):
                if val is None:
                    return
                if not isinstance(val, dict):
                    errs.append(
                        f"{name} must be an object with landscape/portrait keys"
                    )
                    return
                for key in ("landscape", "portrait"):
                    if key not in val:
                        errs.append(f"{name}.{key} missing")
                for key in ("landscape", "portrait"):
                    arr = val.get(key)
                    if arr is None:
                        continue
                    if not isinstance(arr, list):
                        errs.append(f"{name}.{key} not a list")
                    else:
                        for i, elem in enumerate(arr):
                            if not isinstance(elem, str):
                                errs.append(f"{name}.{key}[{i}] not a string")
                if isinstance(val.get("landscape"), list) and isinstance(
                    val.get("portrait"), list
                ):
                    land = val["landscape"]
                    port = val["portrait"]
                    if land and not port:
                        warnings.append(
                            f"{name}: portrait empty while landscape has data (expected mirror)"
                        )
                    if land and port and len(port) != len(land):
                        warnings.append(
                            f"{name}: landscape/portrait length mismatch {len(land)}!={len(port)}"
                        )

            _validate_orientation_array("claim", obj.get("claim"))
            _validate_orientation_array("disclaimer", obj.get("disclaimer"))
            _validate_orientation_array("disclaimer_02", obj.get("disclaimer_02"))
            _validate_orientation_array("logo", obj.get("logo"))
        gm = obj.get("metadataGlobal", {})
        if gm and isinstance(gm, dict) and required_global_keys:
            for k in required_global_keys:
                if k not in gm:
                    if args.missing_keys_warn:
                        warnings.append(f"metadataGlobal missing required key '{k}'")
                    else:
                        errs.append(f"metadataGlobal missing required key '{k}'")

        videos = obj.get("videos")
        if videos is not None:
            if not isinstance(videos, list):
                errs.append("videos is not a list")
            else:
                for v_index, v in enumerate(videos):
                    if not isinstance(v, dict):
                        errs.append(f"videos[{v_index}] not an object")
                        continue
                    vid = v.get("videoId")
                    if isinstance(vid, str):
                        if not (
                            vid.endswith("_landscape") or vid.endswith("_portrait")
                        ):
                            warnings.append(
                                f"videos[{v_index}].videoId missing orientation suffix"
                            )
                    meta = v.get("metadata", {})
                    if isinstance(meta, dict):
                        orient = meta.get("orientation")
                        if isinstance(vid, str) and (
                            vid.endswith("_landscape") or vid.endswith("_portrait")
                        ):
                            expected = (
                                "landscape"
                                if vid.endswith("_landscape")
                                else "portrait"
                            )
                            if orient != expected:
                                errs.append(
                                    f"videos[{v_index}].metadata.orientation '{orient}' != expected '{expected}'"
                                )
                        if "orientation" not in meta:
                            warnings.append(
                                f"videos[{v_index}].metadata missing orientation"
                            )
                    subs = v.get("subtitles")
                    if subs is None:
                        continue
                    if not isinstance(subs, list):
                        errs.append(f"videos[{v_index}].subtitles not a list")
                        continue
                    prev_out: Optional[float] = None
                    for si, s in enumerate(subs):
                        if not isinstance(s, dict):
                            errs.append(
                                f"videos[{v_index}].subtitles[{si}] not an object"
                            )
                            continue
                        tin = s.get("in")
                        tout = s.get("out")
                        try:
                            if tin is not None and tout is not None:
                                ftin = float(tin)
                                ftout = float(tout)
                                if ftin > ftout:
                                    errs.append(
                                        f"videos[{v_index}].subtitles[{si}] in > out ({tin} > {tout})"
                                    )
                                if prev_out is not None and ftin < prev_out:
                                    errs.append(
                                        f"videos[{v_index}].subtitles[{si}] overlaps previous (start {ftin} < prev end {prev_out})"
                                    )
                                prev_out = ftout
                        except Exception:
                            pass
        return {"errors": errs, "warnings": warnings}

    file_write_count = 0

    def write_json(path: str, payload: Dict[str, Any]):
        nonlocal file_write_count
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        file_write_count += 1

    def make_sample(payload: Dict[str, Any]) -> Dict[str, Any]:
        SAMPLE_LIMITS = {
            "claim": 2,
            "disclaimer": 1,
            "disclaimer_02": 1,
            "logo": 1,
            "videos": 2,
            "subtitles": 5,
            "video_claim": 2,
        }

        def _truncate_top_arrays(obj: Dict[str, Any]):
            out = obj
            if "claim" in out and isinstance(out["claim"], list):
                out["claim"] = out["claim"][: SAMPLE_LIMITS["claim"]]
            if "disclaimer" in out and isinstance(out["disclaimer"], list):
                out["disclaimer"] = out["disclaimer"][: SAMPLE_LIMITS["disclaimer"]]
            if "disclaimer_02" in out and isinstance(out["disclaimer_02"], list):
                out["disclaimer_02"] = out["disclaimer_02"][
                    : SAMPLE_LIMITS["disclaimer_02"]
                ]
            if "logo" in out and isinstance(out["logo"], list):
                out["logo"] = out["logo"][: SAMPLE_LIMITS["logo"]]
            for key in ("claim", "disclaimer", "disclaimer_02", "logo"):
                val = out.get(key)
                if isinstance(val, dict):
                    for orient in ("landscape", "portrait"):
                        arr = val.get(orient)
                        if isinstance(arr, list):
                            limit = (
                                SAMPLE_LIMITS["claim"]
                                if key == "claim"
                                else SAMPLE_LIMITS["disclaimer"]
                                if key == "disclaimer"
                                else SAMPLE_LIMITS["disclaimer_02"]
                                if key == "disclaimer_02"
                                else SAMPLE_LIMITS["logo"]
                            )
                            val[orient] = arr[:limit]
            return out

        sample = copy.deepcopy(payload)
        if sample.get("_multi") and isinstance(sample.get("byCountry"), dict):
            for c, pld in sample.get("byCountry", {}).items():
                sample["byCountry"][c] = make_sample(pld)
            countries = sample.get("countries")
            if isinstance(countries, list):
                sample["countries"] = countries[:3]
            return sample
        sample = _truncate_top_arrays(sample)
        vids = sample.get("videos")
        if isinstance(vids, list):
            vids_trunc = []
            for v in vids[: SAMPLE_LIMITS["videos"]]:
                v2 = copy.deepcopy(v)
                subs = v2.get("subtitles")
                if isinstance(subs, list):
                    v2["subtitles"] = subs[: SAMPLE_LIMITS["subtitles"]]
                if "claim" in v2 and isinstance(v2["claim"], list):
                    v2["claim"] = v2["claim"][: SAMPLE_LIMITS["video_claim"]]
                claim_keys = sorted([k for k in v2.keys() if k.startswith("claim_")])
                for ck in claim_keys[SAMPLE_LIMITS["video_claim"] :]:
                    del v2[ck]
                vids_trunc.append(v2)
            sample["videos"] = vids_trunc
        if "subtitles" in sample and isinstance(sample["subtitles"], list):
            sample["subtitles"] = sample["subtitles"][: SAMPLE_LIMITS["subtitles"]]
        return sample

    def derive_sample_path(path: str) -> str:
        root, ext = os.path.splitext(path)
        return f"{root}_sample{ext or '.json'}"

    if isinstance(data, dict) and data.get("_multi"):
        countries: List[str] = data.get("countries", [])
        by_country: Dict[str, Any] = data.get("byCountry", {})
        if args.check:
            all_errors: List[str] = []
            all_warnings: List[str] = []
            reports: List[Dict[str, Any]] = []
            print(f"Discovered countries ({len(countries)}): {countries}")
            for c in countries:
                payload = by_country.get(c, {})
                res = _validate_structure(payload)
                vids_objs = [
                    v for v in payload.get("videos", []) if isinstance(v, dict)
                ]
                vids = [v.get("videoId") for v in vids_objs]
                subtitle_count = sum(len(v.get("subtitles", [])) for v in vids_objs)
                print(
                    f"  {c}: videos={len(vids)} subtitleLines={subtitle_count} claimLines={len(payload.get('claim', []))} disclaimerLines={len(payload.get('disclaimer', []))} disclaimer_02Lines={len(payload.get('disclaimer_02', []))} logoLines={len(payload.get('logo', []))}"
                )
                all_errors.extend([f"{c}: {e}" for e in res["errors"]])
                all_warnings.extend([f"{c}: {w}" for w in res["warnings"]])
                reports.append(
                    {
                        "country": c,
                        "errors": res["errors"],
                        "warnings": res["warnings"],
                        "videos": [
                            {
                                "videoId": v.get("videoId"),
                                "subtitleCount": len(v.get("subtitles", [])),
                            }
                            for v in vids_objs
                        ],
                        "claimLines": len(payload.get("claim", [])),
                        "disclaimerLines": len(payload.get("disclaimer", [])),
                        "disclaimer_02Lines": len(payload.get("disclaimer_02", [])),
                        "logoLines": len(payload.get("logo", [])),
                    }
                )
            if all_warnings:
                print("Validation warnings:")
                for w in all_warnings:
                    print(f"  - {w}")
            if all_errors:
                print("Validation errors:")
                for e in all_errors:
                    print(f"  - {e}")
            if args.validation_report:
                report_obj = {
                    "input": os.path.abspath(args.input),
                    "mode": "check",
                    "countries": reports,
                    "summary": {
                        "errors": len(all_errors),
                        "warnings": len(all_warnings),
                    },
                }
                report_error = write_validation_report(
                    report_path=args.validation_report,
                    report_obj=report_obj,
                )
                if report_error:
                    print(
                        f"Failed to write validation report: {report_error}",
                        file=sys.stderr,
                    )
            print("Check mode output targets:")
            if args.split_by_country:
                pattern = ensure_country_placeholder(args.output_pattern or args.output)
                variant_counts: Dict[str, int] = (
                    data.get("_countryVariantCount", {})
                    if isinstance(data, dict)
                    else {}
                )
                for c in countries:
                    count = max(1, int(variant_counts.get(c, 1)))
                    for vi in range(count):
                        if vi == 0:
                            payload = by_country.get(c, {})
                        else:
                            alt = convert_csv_to_json(
                                input_csv=args.input,
                                fps=args.fps,
                                start_line_index=args.start_line,
                                round_ndigits=round_ndigits,
                                times_as_string=args.times_as_string,
                                strip_text=not args.no_strip_text,
                                skip_empty_text=not args.keep_empty_text,
                                encoding=args.encoding,
                                delimiter=args.delimiter,
                                start_col=args.start_col,
                                end_col=args.end_col,
                                text_col=args.text_col,
                                verbose=False,
                                schema_version=args.schema_version,
                                merge_subtitles=not args.no_merge_subtitles,
                                merge_disclaimer=not args.merge_disclaimer,
                                merge_disclaimer_02=not args.merge_disclaimer_02,
                                cast_metadata=args.cast_metadata,
                                join_claim=args.join_claim,
                                prefer_local_claim_disclaimer=args.prefer_local_claim_disclaimer,
                                test_mode=args.test_mode,
                                claims_as_objects=args.claims_as_objects,
                                no_orientation=args.no_orientation,
                                country_variant_index=vi,
                                flags_overview_object_always=args.flags_overview_object_always,
                                xlsx_sheet=args.xlsx_sheet,
                                controller_always_emit=args.controller_always_emit,
                            )
                            payload = (
                                alt.get("byCountry", {})
                                if isinstance(alt, dict)
                                else {}
                            ).get(c, {})
                        mg = (
                            payload.get("metadataGlobal")
                            if isinstance(payload, dict)
                            else None
                        )
                        out_path = resolve_country_output_path(
                            pattern=pattern,
                            country_code=c,
                            metadata_global=mg,
                        )
                        variant_label = (
                            f" [{c} variant {vi}]" if count > 1 else f" [{c}]"
                        )
                        print(f"  - {out_path}{variant_label}")
                        if args.sample:
                            print(
                                f"  - {derive_sample_path(out_path)}{variant_label} (sample)"
                            )
            else:
                csel = None
                if args.country_column and 1 <= args.country_column <= len(countries):
                    csel = countries[args.country_column - 1]
                else:
                    csel = countries[-1] if countries else "default"
                payload = by_country.get(csel, {})
                mg = (
                    payload.get("metadataGlobal") if isinstance(payload, dict) else None
                )
                out_path_single = resolve_single_country_output_path(
                    output=args.output,
                    output_pattern=args.output_pattern,
                    country_code=csel,
                    metadata_global=mg,
                )
                print(f"  - {out_path_single} [selected country: {csel}]")
                if args.sample:
                    print(
                        f"  - {derive_sample_path(out_path_single)} [selected country: {csel}] (sample)"
                    )
            exit_code = 0
            if args.strict and all_errors:
                exit_code = 1
            print(
                "Check complete (no files written)."
                + (
                    " Errors found."
                    if exit_code == 1
                    else " OK (warnings only)."
                    if all_warnings
                    else " OK."
                )
            )
            _print_conversion_summary(0, len(all_errors))
            return exit_code
        if args.split_by_country:
            pattern = ensure_country_placeholder(args.output_pattern or args.output)
            variant_counts: Dict[str, int] = (
                data.get("_countryVariantCount", {}) if isinstance(data, dict) else {}
            )
            for c in countries:
                count = max(1, int(variant_counts.get(c, 1)))
                for vi in range(count):
                    if vi == 0:
                        payload = by_country.get(
                            c,
                            {
                                "subtitles": [],
                                "claim": [],
                                "disclaimer": [],
                                "metadata": {},
                            },
                        )
                    else:
                        alt = convert_csv_to_json(
                            input_csv=args.input,
                            fps=args.fps,
                            start_line_index=args.start_line,
                            round_ndigits=round_ndigits,
                            times_as_string=args.times_as_string,
                            strip_text=not args.no_strip_text,
                            skip_empty_text=not args.keep_empty_text,
                            encoding=args.encoding,
                            delimiter=args.delimiter,
                            start_col=args.start_col,
                            end_col=args.end_col,
                            text_col=args.text_col,
                            verbose=False,
                            schema_version=args.schema_version,
                            merge_subtitles=not args.no_merge_subtitles,
                            merge_disclaimer=not args.merge_disclaimer,
                            merge_disclaimer_02=not args.merge_disclaimer_02,
                            cast_metadata=args.cast_metadata,
                            join_claim=args.join_claim,
                            prefer_local_claim_disclaimer=args.prefer_local_claim_disclaimer,
                            test_mode=args.test_mode,
                            claims_as_objects=args.claims_as_objects,
                            no_orientation=args.no_orientation,
                            country_variant_index=vi,
                            flags_overview_object_always=args.flags_overview_object_always,
                            xlsx_sheet=args.xlsx_sheet,
                            controller_always_emit=args.controller_always_emit,
                        )
                        if not args.no_generation_meta:
                            try:
                                inject_generation_metadata(
                                    alt,
                                    input_path=args.input,
                                    converter_version=args.converter_version,
                                    script_file_path=script_file_path,
                                )
                            except Exception:
                                pass
                        payload = (
                            alt.get("byCountry", {}) if isinstance(alt, dict) else {}
                        ).get(
                            c,
                            {
                                "subtitles": [],
                                "claim": [],
                                "disclaimer": [],
                                "metadata": {},
                            },
                        )
                    if isinstance(payload, dict):
                        inject_media_mapping(payload, c, media_groups_map)
                        inject_layer_config_payload(payload, layer_config_payload)
                    if isinstance(payload, dict):
                        trim_logo_anim_flag_for_country(
                            payload=payload,
                            country_code=c,
                        )
                    mg = (
                        payload.get("metadataGlobal")
                        if isinstance(payload, dict)
                        else None
                    )
                    out_path = resolve_country_output_path(
                        pattern=pattern,
                        country_code=c,
                        metadata_global=mg,
                    )
                    if args.verbose:
                        print(f"Writing {out_path}")
                    write_json(out_path, payload)
                    if args.sample:
                        sample_path = derive_sample_path(out_path)
                        write_json(sample_path, make_sample(payload))
        else:
            csel = None
            if args.country_column and 1 <= args.country_column <= len(countries):
                csel = countries[args.country_column - 1]
            else:
                csel = countries[-1]
            payload = by_country.get(
                csel, {"subtitles": [], "claim": [], "disclaimer": [], "metadata": {}}
            )
            if isinstance(payload, dict):
                trim_logo_anim_flag_for_country(
                    payload=payload,
                    country_code=csel,
                )
            mg = payload.get("metadataGlobal") if isinstance(payload, dict) else None
            out_path_single = resolve_single_country_output_path(
                output=args.output,
                output_pattern=args.output_pattern,
                country_code=csel,
                metadata_global=mg,
            )
            if args.verbose:
                print(f"Writing {out_path_single} (selected country: {csel})")
            if isinstance(payload, dict):
                inject_media_mapping(payload, csel, media_groups_map)
                inject_layer_config_payload(payload, layer_config_payload)
            write_json(out_path_single, payload)
            if args.sample:
                sample_path = derive_sample_path(out_path_single)
                write_json(sample_path, make_sample(payload))
    else:
        if args.check:
            res = _validate_structure(data)
            errors = res["errors"]
            warnings = res["warnings"]
            print("Parsed single-structure JSON (legacy/simple mode).")
            if warnings:
                print("Validation warnings:")
                for w in warnings:
                    print(f"  - {w}")
            if errors:
                print("Validation errors:")
                for e in errors:
                    print(f"  - {e}")
            if args.validation_report:
                report_obj = {
                    "input": os.path.abspath(args.input),
                    "legacy": True,
                    "mode": "check",
                    "errors": errors,
                    "warnings": warnings,
                }
                report_error = write_validation_report(
                    report_path=args.validation_report,
                    report_obj=report_obj,
                )
                if report_error:
                    print(
                        f"Failed to write validation report: {report_error}",
                        file=sys.stderr,
                    )
            print("Check mode output targets:")
            print(f"  - {args.output}")
            if args.sample:
                print(f"  - {derive_sample_path(args.output)} (sample)")
            exit_code = 0 if (not errors or not args.strict) else 1
            print(
                "Check complete (no file written)."
                + (
                    " Errors found."
                    if exit_code == 1
                    else " OK (warnings only)."
                    if warnings
                    else " OK."
                )
            )
            _print_conversion_summary(0, len(errors))
            return exit_code
        if isinstance(data, dict):
            inject_layer_config_payload(data, layer_config_payload)
        write_json(args.output, data)
        if args.sample and not args.check:
            sample_path = derive_sample_path(args.output)
            write_json(sample_path, make_sample(data))

    _print_conversion_summary(file_write_count)
    return 0
