import os
import tempfile
import subprocess
import sys

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
