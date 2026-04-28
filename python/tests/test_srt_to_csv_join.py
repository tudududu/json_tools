import os
import tempfile
import subprocess
import sys
import math

import pytest


XLSX_HEADER = ("Start Time", "End Time", "Text") + tuple(
    f"<ISO>{i}" for i in range(1, 11)
)


def test_join_output_positional_after_input_dir():
    in_dir = tempfile.mkdtemp()
    try:
        # two srt inputs
        with open(os.path.join(in_dir, "a.srt"), "w", encoding="utf-8") as f:
            f.write("1\n00:00:00,000 --> 00:00:01,000\nHello, world!\n")
        with open(os.path.join(in_dir, "b.srt"), "w", encoding="utf-8") as f:
            f.write("1\n00:00:02,000 --> 00:00:03,000\nNo comma text\n")
        out_dir = tempfile.mkdtemp()
        out_csv = os.path.join(out_dir, "joined.csv")
        script_mod = "python.tools.srt_to_csv"
        proc = subprocess.run(
            [
                sys.executable,
                "-m",
                script_mod,
                "--input-dir",
                in_dir,
                out_csv,
                "--join-output",
                "--fps",
                "25",
                "--out-format",
                "frames",
            ],
            capture_output=True,
            text=True,
        )
        assert proc.returncode == 0, proc.stderr
        with open(out_csv, "r", encoding="utf-8") as f:
            content = f.read().splitlines()
        # Header + marker for a.srt + 1 row + marker for b.srt + 1 row
        assert content[0] == "Start Time,End Time,Text"
        assert content[1].endswith(",a.srt")
        assert content[3].endswith(",b.srt")
    finally:
        try:
            os.remove(os.path.join(in_dir, "a.srt"))
            os.remove(os.path.join(in_dir, "b.srt"))
        except Exception:
            pass
        try:
            os.rmdir(in_dir)
        except Exception:
            pass


def test_join_output_output_dir_as_file_path():
    in_dir = tempfile.mkdtemp()
    try:
        with open(os.path.join(in_dir, "c.srt"), "w", encoding="utf-8") as f:
            f.write("1\n00:00:00,000 --> 00:00:01,000\nHello!\n")
        out_dir = tempfile.mkdtemp()
        out_csv = os.path.join(out_dir, "joined2.csv")
        script_mod = "python.tools.srt_to_csv"
        proc = subprocess.run(
            [
                sys.executable,
                "-m",
                script_mod,
                "--input-dir",
                in_dir,
                "--output-dir",
                out_csv,
                "--join-output",
                "--fps",
                "25",
                "--out-format",
                "frames",
            ],
            capture_output=True,
            text=True,
        )
        assert proc.returncode == 0, proc.stderr
        with open(out_csv, "r", encoding="utf-8") as f:
            content = f.read().splitlines()
        assert content[0] == "Start Time,End Time,Text"
        assert any(line.endswith(",c.srt") for line in content)
    finally:
        try:
            os.remove(os.path.join(in_dir, "c.srt"))
        except Exception:
            pass
        try:
            os.rmdir(in_dir)
        except Exception:
            pass


def test_single_output_infers_xlsx_from_extension():
    openpyxl = pytest.importorskip("openpyxl")
    in_dir = tempfile.mkdtemp()
    try:
        in_srt = os.path.join(in_dir, "single.srt")
        with open(in_srt, "w", encoding="utf-8") as f:
            f.write("1\n00:00:00,000 --> 00:00:01,000\nHello XLSX\n")
        out_xlsx = os.path.join(in_dir, "single.xlsx")
        script_mod = "python.tools.srt_to_csv"
        proc = subprocess.run(
            [
                sys.executable,
                "-m",
                script_mod,
                in_srt,
                out_xlsx,
                "--out-format",
                "frames",
                "--fps",
                "25",
            ],
            capture_output=True,
            text=True,
        )
        assert proc.returncode == 0, proc.stderr

        wb = openpyxl.load_workbook(out_xlsx, data_only=True)
        ws = wb["subtitles"]
        rows = list(ws.iter_rows(values_only=True))
        assert rows[0] == XLSX_HEADER
        assert rows[1][0:3] == ("00:00:00:00", "00:00:01:00", "Hello XLSX")
        assert rows[1][3:] == (None,) * 10

        assert math.isclose(ws.column_dimensions["A"].width, 12.0, abs_tol=0.2)
        assert math.isclose(ws.column_dimensions["B"].width, 12.0, abs_tol=0.2)
        assert math.isclose(ws.column_dimensions["C"].width, 41.0, abs_tol=0.2)
        assert math.isclose(ws.column_dimensions["D"].width, 16.0, abs_tol=0.2)
        assert math.isclose(ws.column_dimensions["M"].width, 16.0, abs_tol=0.2)

        assert ws["A1"].font.name == "Aptos Narrow"
        assert math.isclose(float(ws["A1"].font.sz), 12.0, abs_tol=1e-6)
        assert ws["C2"].font.name == "Aptos Narrow"
        assert math.isclose(float(ws["C2"].font.sz), 12.0, abs_tol=1e-6)

        assert len(ws.tables) == 1
        table = next(iter(ws.tables.values()))
        assert table.ref == "A1:M2"
        assert table.tableStyleInfo is not None
        assert table.tableStyleInfo.name == "TableStyleMedium9"
    finally:
        try:
            os.remove(os.path.join(in_dir, "single.srt"))
        except Exception:
            pass
        try:
            os.remove(os.path.join(in_dir, "single.xlsx"))
        except Exception:
            pass
        try:
            os.rmdir(in_dir)
        except Exception:
            pass


def test_single_output_type_flag_overrides_extension():
    in_dir = tempfile.mkdtemp()
    try:
        in_srt = os.path.join(in_dir, "override.srt")
        with open(in_srt, "w", encoding="utf-8") as f:
            f.write("1\n00:00:00,000 --> 00:00:01,000\nOverride\n")
        out_xlsx_name = os.path.join(in_dir, "override.xlsx")
        script_mod = "python.tools.srt_to_csv"
        proc = subprocess.run(
            [
                sys.executable,
                "-m",
                script_mod,
                in_srt,
                out_xlsx_name,
                "--output-type",
                "csv",
                "--out-format",
                "frames",
                "--fps",
                "25",
            ],
            capture_output=True,
            text=True,
        )
        assert proc.returncode == 0, proc.stderr

        with open(out_xlsx_name, "r", encoding="utf-8") as f:
            content = f.read().splitlines()
        assert content[0] == "Start Time,End Time,Text"
        assert content[1] == "00:00:00:00,00:00:01:00,Override"
    finally:
        try:
            os.remove(os.path.join(in_dir, "override.srt"))
        except Exception:
            pass
        try:
            os.remove(os.path.join(in_dir, "override.xlsx"))
        except Exception:
            pass
        try:
            os.rmdir(in_dir)
        except Exception:
            pass


def test_join_output_infers_xlsx_from_extension():
    openpyxl = pytest.importorskip("openpyxl")
    in_dir = tempfile.mkdtemp()
    try:
        with open(os.path.join(in_dir, "a.srt"), "w", encoding="utf-8") as f:
            f.write("1\n00:00:00,000 --> 00:00:01,000\nHello\n")
        with open(os.path.join(in_dir, "b.srt"), "w", encoding="utf-8") as f:
            f.write("1\n00:00:02,000 --> 00:00:03,000\nWorld\n")
        out_dir = tempfile.mkdtemp()
        out_xlsx = os.path.join(out_dir, "joined.xlsx")
        script_mod = "python.tools.srt_to_csv"
        proc = subprocess.run(
            [
                sys.executable,
                "-m",
                script_mod,
                "--input-dir",
                in_dir,
                out_xlsx,
                "--join-output",
                "--fps",
                "25",
                "--out-format",
                "frames",
            ],
            capture_output=True,
            text=True,
        )
        assert proc.returncode == 0, proc.stderr

        wb = openpyxl.load_workbook(out_xlsx, data_only=True)
        ws = wb["subtitles"]
        rows = list(ws.iter_rows(values_only=True))
        assert rows[0] == XLSX_HEADER
        assert rows[1][0:3] == (None, None, "a.srt")
        assert rows[1][3:] == (None,) * 10
        assert rows[3][0:3] == (None, None, "b.srt")
        assert rows[3][3:] == (None,) * 10

        # Joined title rows should be highlighted across the full table span A-M.
        for col in "ABCDEFGHIJKLM":
            fill = ws[f"{col}2"].fill
            assert fill.fill_type == "solid"
            assert fill.fgColor.type == "theme"
            assert fill.fgColor.theme == 8
            assert math.isclose(float(fill.fgColor.tint), 0.8, rel_tol=0.0, abs_tol=1e-6)
    finally:
        try:
            os.remove(os.path.join(in_dir, "a.srt"))
            os.remove(os.path.join(in_dir, "b.srt"))
        except Exception:
            pass
        try:
            os.rmdir(in_dir)
        except Exception:
            pass


def test_xlsx_output_without_openpyxl_reports_clear_cli_error():
    in_dir = tempfile.mkdtemp()
    try:
        in_srt = os.path.join(in_dir, "missing_openpyxl.srt")
        with open(in_srt, "w", encoding="utf-8") as f:
            f.write("1\n00:00:00,000 --> 00:00:01,000\nNeeds xlsx\n")

        out_xlsx = os.path.join(in_dir, "missing_openpyxl.xlsx")

        # Shadow installed openpyxl with an empty local package so
        # `from openpyxl import Workbook` fails in the CLI process.
        fake_site = tempfile.mkdtemp()
        fake_openpyxl_pkg = os.path.join(fake_site, "openpyxl")
        os.makedirs(fake_openpyxl_pkg, exist_ok=True)
        with open(
            os.path.join(fake_openpyxl_pkg, "__init__.py"), "w", encoding="utf-8"
        ) as f:
            f.write("# intentionally empty: Workbook symbol missing\n")

        script_mod = "python.tools.srt_to_csv"
        env = os.environ.copy()
        env["PYTHONPATH"] = fake_site + os.pathsep + env.get("PYTHONPATH", "")

        proc = subprocess.run(
            [
                sys.executable,
                "-m",
                script_mod,
                in_srt,
                out_xlsx,
                "--output-type",
                "xlsx",
                "--out-format",
                "frames",
                "--fps",
                "25",
            ],
            capture_output=True,
            text=True,
            env=env,
        )
        assert proc.returncode != 0
        combined = (proc.stdout or "") + (proc.stderr or "")
        assert (
            "XLSX output requires openpyxl. Install with: pip install openpyxl"
            in combined
        )
    finally:
        try:
            os.remove(os.path.join(in_dir, "missing_openpyxl.srt"))
        except Exception:
            pass
        try:
            os.rmdir(in_dir)
        except Exception:
            pass


def test_join_xlsx_output_without_openpyxl_reports_clear_cli_error():
    in_dir = tempfile.mkdtemp()
    out_dir = tempfile.mkdtemp()
    try:
        with open(os.path.join(in_dir, "a.srt"), "w", encoding="utf-8") as f:
            f.write("1\n00:00:00,000 --> 00:00:01,000\nJoin needs xlsx\n")

        out_xlsx = os.path.join(out_dir, "joined_missing_openpyxl.xlsx")

        # Shadow installed openpyxl with an empty local package so
        # `from openpyxl import Workbook` fails in the CLI process.
        fake_site = tempfile.mkdtemp()
        fake_openpyxl_pkg = os.path.join(fake_site, "openpyxl")
        os.makedirs(fake_openpyxl_pkg, exist_ok=True)
        with open(
            os.path.join(fake_openpyxl_pkg, "__init__.py"), "w", encoding="utf-8"
        ) as f:
            f.write("# intentionally empty: Workbook symbol missing\n")

        script_mod = "python.tools.srt_to_csv"
        env = os.environ.copy()
        env["PYTHONPATH"] = fake_site + os.pathsep + env.get("PYTHONPATH", "")

        proc = subprocess.run(
            [
                sys.executable,
                "-m",
                script_mod,
                "--input-dir",
                in_dir,
                out_xlsx,
                "--join-output",
                "--out-format",
                "frames",
                "--fps",
                "25",
            ],
            capture_output=True,
            text=True,
            env=env,
        )
        assert proc.returncode != 0
        combined = (proc.stdout or "") + (proc.stderr or "")
        assert (
            "XLSX output requires openpyxl. Install with: pip install openpyxl"
            in combined
        )
    finally:
        try:
            os.remove(os.path.join(in_dir, "a.srt"))
        except Exception:
            pass
        try:
            os.rmdir(in_dir)
        except Exception:
            pass
        try:
            os.rmdir(out_dir)
        except Exception:
            pass
