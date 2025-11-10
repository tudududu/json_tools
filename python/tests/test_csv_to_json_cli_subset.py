import json
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "csv_to_json.py"


def run_cli(args, expect_exit=0):
    proc = subprocess.run([sys.executable, str(SCRIPT)] + args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if proc.returncode != expect_exit:
        print(proc.stdout)
        print(proc.stderr, file=sys.stderr)
    assert proc.returncode == expect_exit, f"Exit {proc.returncode} != {expect_exit} (stderr={proc.stderr})"
    return proc


def write(path: Path, content: str):
    path.write_text(content, encoding="utf-8")
    return path


@pytest.mark.parametrize("delim,force_flag", [
    (";", None),              # sniff semicolon
    (";", "semicolon"),      # forced named delimiter
    (",", "comma"),          # explicit same delimiter
])
def test_delimiter_sniff_vs_forced(tmp_path, delim, force_flag):
    csv = tmp_path / "subs_semicolon.csv"
    # Simple legacy CSV headers (Start Time;End Time;Text)
    write(csv, f"Start Time{delim}End Time{delim}Text\n0{delim}1.2{delim}Hello")
    out = tmp_path / "out.json"
    args = [str(csv), str(out), "--fps", "25"]
    if force_flag:
        args += ["--delimiter", force_flag]
    proc = run_cli(args)
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["subtitles"][0]["text"] == "Hello"


@pytest.mark.parametrize("round_val,input_start,input_end,expected_start_str", [
    (2, "0", "1.5", "0.00"),
    (2, "1.234", "2.0", "1.23"),  # rounding down
    (2, "1.235", "2.0", "1.24"),  # rounding up
])
def test_times_as_string_rounding(tmp_path, round_val, input_start, input_end, expected_start_str):
    csv = tmp_path / "subs_times.csv"
    write(csv, f"Start Time,End Time,Text\n{input_start},{input_end},Hello")
    out = tmp_path / "out.json"
    run_cli([str(csv), str(out), "--fps", "25", "--times-as-string", "--round", str(round_val)])
    data = json.loads(out.read_text(encoding="utf-8"))
    sub = data["subtitles"][0]
    assert isinstance(sub["in"], str)
    assert sub["in"] == expected_start_str


def test_malformed_timecode_validation_error(tmp_path):
    csv = tmp_path / "bad_time.csv"
    # End earlier than Start should trigger validation error in unified mode; use simple legacy with ordering violation
    write(csv, "Start Time,End Time,Text\n5,3,Bad timing")
    out = tmp_path / "out.json"
    proc = run_cli([str(csv), str(out), "--fps", "25", "--validate-only"], expect_exit=1)
    # stdout should contain 'Errors found.' phrase
    assert "Errors found" in proc.stdout or "Validation errors" in proc.stdout
    assert not out.exists()


def unified_csv_content(orientation=True):
    # Minimal unified schema with claim & disclaimer & sub, two country columns (GBR duplicated for portrait simulation)
    # record_type,video_id,line,start,end,key,is_global,country_scope,metadata,GBR,GBR
    base = [
        "record_type,video_id,line,start,end,key,is_global,country_scope,metadata,GBR,GBR",
        # Subtitle row (landscape only text)
        "sub,VID1,1,0,1,,,,'Hello',Hello,",
        # Claim row
        "claim,,1,0,1,,,,'Claim',Claim L,Claim P",
        # Disclaimer timed starter + continuation (no end on second)
        "disclaimer,,1,0,1,,,,'Disc',Disc L,Disc P",
        "disclaimer,,2,,,,,,,'More',More L,",
        # Logo timed row (global text)
        "logo,,1,1,2,,,,'Logo',Logo L,Logo P",
    ]
    return "\n".join(base)


@pytest.mark.parametrize("no_orientation_flag", [False, True])
def test_no_orientation_switches_shapes(tmp_path, no_orientation_flag):
    csv = tmp_path / "unified.csv"
    write(csv, unified_csv_content())
    out = tmp_path / "unified.json"
    args = [str(csv), str(out), "--fps", "25"]
    if no_orientation_flag:
        args.append("--no-orientation")
    run_cli(args)
    data = json.loads(out.read_text(encoding="utf-8"))
    if no_orientation_flag:
        # claim should be a list not an orientation dict
        assert isinstance(data["claim"], list)
        assert isinstance(data["disclaimer"], list)
        assert isinstance(data["logo"], list)
    else:
        assert isinstance(data["claim"], dict)
        assert "landscape" in data["claim"] and "portrait" in data["claim"]
        assert isinstance(data["disclaimer"], dict)
        assert isinstance(data["logo"], dict)


def test_hhmmssff_parse_with_fps_times_as_string(tmp_path):
    csv = tmp_path / "frames.csv"
    # 00:00:01:12 @25fps = 1.48s
    write(csv, "Start Time,End Time,Text\n00:00:01:12,00:00:03:00,Hello")
    out = tmp_path / "out.json"
    run_cli([str(csv), str(out), "--fps", "25", "--times-as-string"])  # default round=2
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["subtitles"][0]["in"] == "1.48"


@pytest.mark.parametrize("delim_name,delim_char", [("tab", "\t"), ("pipe", "|")])
def test_delimiter_named_mappings_tab_and_pipe(tmp_path, delim_name, delim_char):
    csv = tmp_path / f"subs_{delim_name}.csv"
    write(csv, f"Start Time{delim_char}End Time{delim_char}Text\n0{delim_char}1{delim_char}X")
    out = tmp_path / "named.json"
    run_cli([str(csv), str(out), "--fps", "25", "--delimiter", delim_name])
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["subtitles"][0]["text"] == "X"


def test_times_as_string_no_rounding_defaults_to_two_decimals(tmp_path):
    csv = tmp_path / "noround.csv"
    write(csv, "Start Time,End Time,Text\n1.2345,2.0,Hello")
    out = tmp_path / "out.json"
    # round=-1 disables rounding -> code formats with 2 decimals when times_as_string
    run_cli([str(csv), str(out), "--fps", "25", "--times-as-string", "--round", "-1"])
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["subtitles"][0]["in"] == "1.23"


def test_frames_rounding_near_boundary(tmp_path):
    csv = tmp_path / "frames_boundary.csv"
    # Use HH:MM:SS:FF with fps=24 so frame fraction has non-terminating decimal in base10 (e.g., 7/24)
    # 00:00:01:07 @24fps = 1 + 7/24 = 1.291666... -> rounded to 1.29 with default round=2
    # 00:00:01:23 @24fps = 1 + 23/24 = 1.958333... -> 1.96
    write(csv, "Start Time,End Time,Text\n00:00:01:07,00:00:01:23,Edge")
    out = tmp_path / "frames.json"
    run_cli([str(csv), str(out), "--fps", "24", "--times-as-string"])  # default round=2
    data = json.loads(out.read_text(encoding="utf-8"))
    first = data["subtitles"][0]
    assert first["in"] == "1.29" and first["out"] == "1.96"


@pytest.mark.parametrize("delim_char", ["\t", "|"])
def test_delimiter_auto_sniff_tab_and_pipe(tmp_path, delim_char):
    # Exercise --delimiter auto sniff path for tab and pipe (no explicit --delimiter flag)
    name = "tab" if delim_char == "\t" else "pipe"
    csv = tmp_path / f"subs_auto_{name}.csv"
    write(csv, f"Start Time{delim_char}End Time{delim_char}Text\n0{delim_char}1{delim_char}A")
    out = tmp_path / "auto.json"
    run_cli([str(csv), str(out), "--fps", "25"])  # delimiter=auto default
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["subtitles"][0]["text"] == "A"


def unified_with_endframe_and_logo_anim(country_codes=("GBR", "FRA")):
    # Build unified schema rows including an endFrame row to cover that branch and a logo_anim_flag overview row.
    # Duplicate first country column for portrait simulation for each country (GBR, GBR, FRA, FRA)
    countries_cols = ",".join([c for c in country_codes for _ in (0, 1)])  # e.g., GBR,GBR,FRA,FRA
    header = f"record_type,video_id,line,start,end,key,is_global,country_scope,metadata,{countries_cols}"
    rows = [header]
    # meta_global country definition row
    # key column is empty here; we provide 'country' codes via metadata column per original ingestion pattern
    # Provide a logo_anim_flag overview duration row (duration = 3s) country_scope used as duration sub-key
    rows.append("meta_global,,,,'',logo_anim_flag,,3s,animVal,,,,,,")
    # Subtitle row with per-country text (only landscape columns filled)
    rows.append("sub,VID2,1,0,2,,,,'Sub text',Sub GBR,,Sub FRA,")
    # endFrame row timed with optional text
    rows.append("endFrame,VID2,1,2,3,,,,'End frame',End GBR,,End FRA,")
    return "\n".join(rows)


def test_unified_endframe_and_logo_anim_overview(tmp_path):
    csv = tmp_path / "unified_endframe.csv"
    write(csv, unified_with_endframe_and_logo_anim())
    out = tmp_path / "unified_endframe.json"
    run_cli([str(csv), str(out), "--fps", "25"])
    # Non-split mode writes a single selected country payload (default selects last country)
    payload = json.loads(out.read_text(encoding="utf-8"))
    vids = payload.get("videos", [])
    end_items = [v.get("endFrame") for v in vids if v.get("videoId") == "VID2_landscape"]
    assert end_items and isinstance(end_items[0], list)
    # Validate timing exists and is correctly parsed/rounded; text may be empty unless prefer-local is enabled
    assert end_items[0][0]["in"] == 2.0 and end_items[0][0]["out"] == 3.0
    mg = payload.get("metadataGlobal", {})
    assert "logo_anim_flag" in mg
    overview = mg["logo_anim_flag"]
    # Duration sub-key may have been uppercased (country_scope normalization); accept either '3s' or '3S'
    assert any(k.lower() == "3s" for k in overview.keys())


def unified_country_column_single_trim():
    # Provide two country columns but select the first via --country-column to test trimming of overview values
    header = "record_type,video_id,line,start,end,key,is_global,country_scope,metadata,GBR,GBR,FRA,FRA"
    rows = [header]
    # logo_anim_flag duration row with per-country differing values (so trimming logic executes)
    rows.append("meta_global,,,,'',logo_anim_flag,,5s,animDefault,ValGBR,,ValFRA,")
    # Simple subtitle row
    rows.append("sub,VIDX,1,0,1,,,,'Hello',Hi GBR,,Hi FRA,")
    return "\n".join(rows)


def test_country_column_selection_trims_logo_anim_overview(tmp_path):
    csv = tmp_path / "country_sel.csv"
    write(csv, unified_country_column_single_trim())
    out = tmp_path / "country_sel.json"
    # Select the first country (GBR) among 2 -> overview should only include GBR value not nested other country entries
    run_cli([str(csv), str(out), "--fps", "25", "--country-column", "1"])
    data = json.loads(out.read_text(encoding="utf-8"))
    mg = data.get("metadataGlobal", {})
    assert "logo_anim_flag" in mg
    overview = mg["logo_anim_flag"]
    # After trimming, duration key should be present (case-insensitive) and map to the selected country's value
    dur_key = next((k for k in overview.keys() if k.lower() == "5s"), None)
    assert dur_key is not None
    val = overview[dur_key]
    assert isinstance(val, str) and val == "ValGBR"
