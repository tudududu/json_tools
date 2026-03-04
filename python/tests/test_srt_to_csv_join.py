import os
import tempfile
import subprocess
import sys

import pytest

def test_join_output_positional_after_input_dir():
    in_dir = tempfile.mkdtemp()
    try:
        # two srt inputs
        with open(os.path.join(in_dir, 'a.srt'), 'w', encoding='utf-8') as f:
            f.write('1\n00:00:00,000 --> 00:00:01,000\nHello, world!\n')
        with open(os.path.join(in_dir, 'b.srt'), 'w', encoding='utf-8') as f:
            f.write('1\n00:00:02,000 --> 00:00:03,000\nNo comma text\n')
        out_dir = tempfile.mkdtemp()
        out_csv = os.path.join(out_dir, 'joined.csv')
        script_mod = 'python.tools.srt_to_csv'
        proc = subprocess.run(
            [sys.executable, '-m', script_mod, '--input-dir', in_dir, out_csv, '--join-output', '--fps', '25', '--out-format', 'frames'],
            capture_output=True,
            text=True,
        )
        assert proc.returncode == 0, proc.stderr
        content = open(out_csv, 'r', encoding='utf-8').read().splitlines()
        # Header + marker for a.srt + 1 row + marker for b.srt + 1 row
        assert content[0] == 'Start Time,End Time,Text'
        assert content[1].endswith(',a.srt')
        assert content[3].endswith(',b.srt')
    finally:
        try:
            os.remove(os.path.join(in_dir, 'a.srt'))
            os.remove(os.path.join(in_dir, 'b.srt'))
        except Exception:
            pass
        try:
            os.rmdir(in_dir)
        except Exception:
            pass

def test_join_output_output_dir_as_file_path():
    in_dir = tempfile.mkdtemp()
    try:
        with open(os.path.join(in_dir, 'c.srt'), 'w', encoding='utf-8') as f:
            f.write('1\n00:00:00,000 --> 00:00:01,000\nHello!\n')
        out_dir = tempfile.mkdtemp()
        out_csv = os.path.join(out_dir, 'joined2.csv')
        script_mod = 'python.tools.srt_to_csv'
        proc = subprocess.run(
            [sys.executable, '-m', script_mod, '--input-dir', in_dir, '--output-dir', out_csv, '--join-output', '--fps', '25', '--out-format', 'frames'],
            capture_output=True,
            text=True,
        )
        assert proc.returncode == 0, proc.stderr
        content = open(out_csv, 'r', encoding='utf-8').read().splitlines()
        assert content[0] == 'Start Time,End Time,Text'
        assert any(line.endswith(',c.srt') for line in content)
    finally:
        try:
            os.remove(os.path.join(in_dir, 'c.srt'))
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
        in_srt = os.path.join(in_dir, 'single.srt')
        with open(in_srt, 'w', encoding='utf-8') as f:
            f.write('1\n00:00:00,000 --> 00:00:01,000\nHello XLSX\n')
        out_xlsx = os.path.join(in_dir, 'single.xlsx')
        script_mod = 'python.tools.srt_to_csv'
        proc = subprocess.run(
            [sys.executable, '-m', script_mod, in_srt, out_xlsx, '--out-format', 'frames', '--fps', '25'],
            capture_output=True,
            text=True,
        )
        assert proc.returncode == 0, proc.stderr

        wb = openpyxl.load_workbook(out_xlsx, data_only=True)
        ws = wb['subtitles']
        rows = list(ws.iter_rows(values_only=True))
        assert rows[0] == ('Start Time', 'End Time', 'Text')
        assert rows[1] == ('00:00:00:00', '00:00:01:00', 'Hello XLSX')
    finally:
        try:
            os.remove(os.path.join(in_dir, 'single.srt'))
        except Exception:
            pass
        try:
            os.remove(os.path.join(in_dir, 'single.xlsx'))
        except Exception:
            pass
        try:
            os.rmdir(in_dir)
        except Exception:
            pass


def test_single_output_type_flag_overrides_extension():
    in_dir = tempfile.mkdtemp()
    try:
        in_srt = os.path.join(in_dir, 'override.srt')
        with open(in_srt, 'w', encoding='utf-8') as f:
            f.write('1\n00:00:00,000 --> 00:00:01,000\nOverride\n')
        out_xlsx_name = os.path.join(in_dir, 'override.xlsx')
        script_mod = 'python.tools.srt_to_csv'
        proc = subprocess.run(
            [sys.executable, '-m', script_mod, in_srt, out_xlsx_name, '--output-type', 'csv', '--out-format', 'frames', '--fps', '25'],
            capture_output=True,
            text=True,
        )
        assert proc.returncode == 0, proc.stderr

        content = open(out_xlsx_name, 'r', encoding='utf-8').read().splitlines()
        assert content[0] == 'Start Time,End Time,Text'
        assert content[1] == '00:00:00:00,00:00:01:00,Override'
    finally:
        try:
            os.remove(os.path.join(in_dir, 'override.srt'))
        except Exception:
            pass
        try:
            os.remove(os.path.join(in_dir, 'override.xlsx'))
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
        with open(os.path.join(in_dir, 'a.srt'), 'w', encoding='utf-8') as f:
            f.write('1\n00:00:00,000 --> 00:00:01,000\nHello\n')
        with open(os.path.join(in_dir, 'b.srt'), 'w', encoding='utf-8') as f:
            f.write('1\n00:00:02,000 --> 00:00:03,000\nWorld\n')
        out_dir = tempfile.mkdtemp()
        out_xlsx = os.path.join(out_dir, 'joined.xlsx')
        script_mod = 'python.tools.srt_to_csv'
        proc = subprocess.run(
            [sys.executable, '-m', script_mod, '--input-dir', in_dir, out_xlsx, '--join-output', '--fps', '25', '--out-format', 'frames'],
            capture_output=True,
            text=True,
        )
        assert proc.returncode == 0, proc.stderr

        wb = openpyxl.load_workbook(out_xlsx, data_only=True)
        ws = wb['subtitles']
        rows = list(ws.iter_rows(values_only=True))
        assert rows[0] == ('Start Time', 'End Time', 'Text')
        assert rows[1] == (None, None, 'a.srt')
        assert rows[3] == (None, None, 'b.srt')
    finally:
        try:
            os.remove(os.path.join(in_dir, 'a.srt'))
            os.remove(os.path.join(in_dir, 'b.srt'))
        except Exception:
            pass
        try:
            os.rmdir(in_dir)
        except Exception:
            pass
