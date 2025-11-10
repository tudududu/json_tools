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
    else:
        assert isinstance(data["claim"], dict)
        assert "landscape" in data["claim"] and "portrait" in data["claim"]
