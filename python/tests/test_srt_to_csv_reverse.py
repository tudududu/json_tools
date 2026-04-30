import os
import subprocess
import sys
import tempfile


def _write(path: str, content: str) -> None:
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(content)


def test_reverse_single_csv_to_srt_frames():
    in_dir = tempfile.mkdtemp()
    try:
        in_csv = os.path.join(in_dir, "input.csv")
        out_srt = os.path.join(in_dir, "output.srt")
        _write(
            in_csv,
            "Start Time,End Time,Text\n"
            "00:00:00:00,00:00:01:00,Hello\n"
            "00:00:01:10,00:00:02:00,World\n",
        )

        proc = subprocess.run(
            [
                sys.executable,
                "-m",
                "python.tools.srt_to_csv",
                "--reverse",
                in_csv,
                out_srt,
                "--fps",
                "25",
            ],
            capture_output=True,
            text=True,
        )

        assert proc.returncode == 0, proc.stderr
        with open(out_srt, "r", encoding="utf-8") as f:
            out = f.read()
        assert "1\n00:00:00,000 --> 00:00:01,000\nHello\n" in out
        assert "2\n00:00:01,400 --> 00:00:02,000\nWorld\n" in out
    finally:
        for name in ("input.csv", "output.srt"):
            path = os.path.join(in_dir, name)
            if os.path.exists(path):
                os.remove(path)
        try:
            os.rmdir(in_dir)
        except Exception:
            pass


def test_reverse_batch_csv_to_srt():
    in_dir = tempfile.mkdtemp()
    out_dir = tempfile.mkdtemp()
    try:
        _write(
            os.path.join(in_dir, "a.csv"),
            "Start Time,End Time,Text\n00:00:00:00,00:00:01:00,A\n",
        )
        # Write semicolon CSV to verify delimiter sniffing in batch mode.
        _write(
            os.path.join(in_dir, "b.csv"),
            "Start Time;End Time;Text\n00:00:01,000;00:00:02,000;B\n",
        )

        proc = subprocess.run(
            [
                sys.executable,
                "-m",
                "python.tools.srt_to_csv",
                "--reverse",
                "--input-dir",
                in_dir,
                "--output-dir",
                out_dir,
            ],
            capture_output=True,
            text=True,
        )

        assert proc.returncode == 0, proc.stderr
        assert os.path.exists(os.path.join(out_dir, "a.srt"))
        assert os.path.exists(os.path.join(out_dir, "b.srt"))
    finally:
        for folder in (in_dir, out_dir):
            for name in os.listdir(folder):
                path = os.path.join(folder, name)
                if os.path.isfile(path):
                    os.remove(path)
            try:
                os.rmdir(folder)
            except Exception:
                pass


def test_reverse_skips_join_marker_rows():
    in_dir = tempfile.mkdtemp()
    try:
        in_csv = os.path.join(in_dir, "joined.csv")
        out_srt = os.path.join(in_dir, "joined.srt")
        _write(
            in_csv,
            "Start Time,End Time,Text\n"
            ",,a.srt\n"
            "00:00:00:00,00:00:01:00,One\n"
            ",,b.srt\n"
            "00:00:02:00,00:00:03:00,Two\n",
        )

        proc = subprocess.run(
            [
                sys.executable,
                "-m",
                "python.tools.srt_to_csv",
                "--reverse",
                in_csv,
                out_srt,
            ],
            capture_output=True,
            text=True,
        )

        assert proc.returncode == 0, proc.stderr
        with open(out_srt, "r", encoding="utf-8") as f:
            out = f.read()
        assert "a.srt" not in out
        assert "b.srt" not in out
        assert "One" in out and "Two" in out
    finally:
        for name in ("joined.csv", "joined.srt"):
            path = os.path.join(in_dir, name)
            if os.path.exists(path):
                os.remove(path)
        try:
            os.rmdir(in_dir)
        except Exception:
            pass


def test_reverse_rejects_mixed_time_formats_in_one_file():
    in_dir = tempfile.mkdtemp()
    try:
        in_csv = os.path.join(in_dir, "mixed.csv")
        out_srt = os.path.join(in_dir, "mixed.srt")
        _write(
            in_csv,
            "Start Time;End Time;Text\n"
            "00:00:00:00;00:00:01:00;Frames\n"
            "00:00:02,000;00:00:03,000;Ms\n",
        )

        proc = subprocess.run(
            [
                sys.executable,
                "-m",
                "python.tools.srt_to_csv",
                "--reverse",
                in_csv,
                out_srt,
            ],
            capture_output=True,
            text=True,
        )

        assert proc.returncode != 0
        assert "Mixed timecode formats" in (proc.stderr + proc.stdout)
    finally:
        for name in ("mixed.csv", "mixed.srt"):
            path = os.path.join(in_dir, name)
            if os.path.exists(path):
                os.remove(path)
        try:
            os.rmdir(in_dir)
        except Exception:
            pass


def test_reverse_joined_splits_and_sanitizes_marker_filenames():
    in_dir = tempfile.mkdtemp()
    out_dir = tempfile.mkdtemp()
    try:
        in_csv = os.path.join(in_dir, "joined.csv")
        _write(
            in_csv,
            "Start Time,End Time,Text\n"
            ",,A / B?.srt\n"
            "00:00:00:00,00:00:01:00,One\n"
            ",,A / B?.srt\n"
            "00:00:02:00,00:00:03:00,Two\n",
        )

        proc = subprocess.run(
            [
                sys.executable,
                "-m",
                "python.tools.srt_to_csv",
                "--reverse",
                "--reverse-joined",
                in_csv,
                "--output-dir",
                out_dir,
            ],
            capture_output=True,
            text=True,
        )

        assert proc.returncode == 0, proc.stderr
        out_files = sorted(
            [n for n in os.listdir(out_dir) if n.lower().endswith(".srt")]
        )
        assert out_files == ["A_B.srt", "A_B_2.srt"]
        with open(os.path.join(out_dir, "A_B.srt"), "r", encoding="utf-8") as f:
            first = f.read()
        with open(os.path.join(out_dir, "A_B_2.srt"), "r", encoding="utf-8") as f:
            second = f.read()
        assert "One" in first
        assert "Two" in second
    finally:
        for folder in (in_dir, out_dir):
            for name in os.listdir(folder):
                path = os.path.join(folder, name)
                if os.path.isfile(path):
                    os.remove(path)
            try:
                os.rmdir(folder)
            except Exception:
                pass


def test_reverse_joined_requires_markers():
    in_dir = tempfile.mkdtemp()
    out_dir = tempfile.mkdtemp()
    try:
        in_csv = os.path.join(in_dir, "no_markers.csv")
        _write(
            in_csv,
            "Start Time,End Time,Text\n00:00:00:00,00:00:01:00,Line 1\n",
        )

        proc = subprocess.run(
            [
                sys.executable,
                "-m",
                "python.tools.srt_to_csv",
                "--reverse",
                "--reverse-joined",
                in_csv,
                "--output-dir",
                out_dir,
            ],
            capture_output=True,
            text=True,
        )

        assert proc.returncode != 0
        assert "requires marker rows" in (proc.stderr + proc.stdout)
    finally:
        for folder in (in_dir, out_dir):
            for name in os.listdir(folder):
                path = os.path.join(folder, name)
                if os.path.isfile(path):
                    os.remove(path)
            try:
                os.rmdir(folder)
            except Exception:
                pass


def test_reverse_joined_rejects_positional_output_path():
    in_dir = tempfile.mkdtemp()
    try:
        in_csv = os.path.join(in_dir, "joined.csv")
        _write(
            in_csv,
            "Start Time,End Time,Text\n,,a.srt\n00:00:00:00,00:00:01:00,One\n",
        )

        proc = subprocess.run(
            [
                sys.executable,
                "-m",
                "python.tools.srt_to_csv",
                "--reverse",
                "--reverse-joined",
                in_csv,
                os.path.join(in_dir, "should_not_work.srt"),
            ],
            capture_output=True,
            text=True,
        )

        assert proc.returncode != 0
        assert "writes multiple files" in (proc.stderr + proc.stdout)
    finally:
        for name in os.listdir(in_dir):
            path = os.path.join(in_dir, name)
            if os.path.isfile(path):
                os.remove(path)
        try:
            os.rmdir(in_dir)
        except Exception:
            pass


def test_reverse_multi_country_iso_columns_emit_one_file_per_country():
    in_dir = tempfile.mkdtemp()
    try:
        in_csv = os.path.join(in_dir, "multi.csv")
        out_srt = os.path.join(in_dir, "out.srt")
        _write(
            in_csv,
            "Start Time,End Time,DEU,bel_fra,<ISO>6\n"
            "00:00:00:00,00:00:01:00,Hallo,Bonjour,unused\n"
            "00:00:01:00,00:00:02:00,,Salut,unused\n",
        )

        proc = subprocess.run(
            [
                sys.executable,
                "-m",
                "python.tools.srt_to_csv",
                "--reverse",
                in_csv,
                out_srt,
                "--fps",
                "25",
            ],
            capture_output=True,
            text=True,
        )

        assert proc.returncode == 0, proc.stderr
        assert not os.path.exists(out_srt)
        deu_path = os.path.join(in_dir, "out_DEU.srt")
        bel_path = os.path.join(in_dir, "out_BEL_FRA.srt")
        assert os.path.exists(deu_path)
        assert os.path.exists(bel_path)
        with open(deu_path, "r", encoding="utf-8") as f:
            deu = f.read()
        with open(bel_path, "r", encoding="utf-8") as f:
            bel = f.read()
        assert "Hallo" in deu
        assert "Bonjour" in bel
        assert "Salut" in bel
        # Timed rows with empty text are preserved.
        assert "00:00:01,000 --> 00:00:02,000\n\n" in deu
    finally:
        for name in os.listdir(in_dir):
            path = os.path.join(in_dir, name)
            if os.path.isfile(path):
                os.remove(path)
        try:
            os.rmdir(in_dir)
        except Exception:
            pass


def test_reverse_multi_country_text_col_filters_iso_and_falls_back():
    in_dir = tempfile.mkdtemp()
    try:
        in_csv = os.path.join(in_dir, "filter.csv")
        out_srt = os.path.join(in_dir, "filtered.srt")
        _write(
            in_csv,
            "Start Time,End Time,Text,DEU,BEL_FRA\n"
            "00:00:00:00,00:00:01:00,Legacy,Hallo,Bonjour\n",
        )

        # text-col filter to ISO: only DEU should be emitted.
        proc_iso = subprocess.run(
            [
                sys.executable,
                "-m",
                "python.tools.srt_to_csv",
                "--reverse",
                in_csv,
                out_srt,
                "--text-col",
                "DEU",
            ],
            capture_output=True,
            text=True,
        )
        assert proc_iso.returncode == 0, proc_iso.stderr
        assert os.path.exists(os.path.join(in_dir, "filtered_DEU.srt"))
        assert not os.path.exists(os.path.join(in_dir, "filtered_BEL_FRA.srt"))

        # text-col filter to non-ISO: fallback to legacy single-file behavior.
        proc_legacy = subprocess.run(
            [
                sys.executable,
                "-m",
                "python.tools.srt_to_csv",
                "--reverse",
                in_csv,
                out_srt,
                "--text-col",
                "Text",
            ],
            capture_output=True,
            text=True,
        )
        assert proc_legacy.returncode == 0, proc_legacy.stderr
        assert os.path.exists(out_srt)
        with open(out_srt, "r", encoding="utf-8") as f:
            legacy = f.read()
        assert "Legacy" in legacy
    finally:
        for name in os.listdir(in_dir):
            path = os.path.join(in_dir, name)
            if os.path.isfile(path):
                os.remove(path)
        try:
            os.rmdir(in_dir)
        except Exception:
            pass


def test_reverse_joined_multi_country_emits_marker_and_iso_suffixes():
    in_dir = tempfile.mkdtemp()
    out_dir = tempfile.mkdtemp()
    try:
        in_csv = os.path.join(in_dir, "joined_multi.csv")
        _write(
            in_csv,
            "Start Time,End Time,Text,DEU,BEL_FRA\n"
            ",,A.srt,,\n"
            "00:00:00:00,00:00:01:00,,Hallo,Bonjour\n"
            ",,A.srt,,\n"
            "00:00:01:00,00:00:02:00,,Tschuess,Salut\n",
        )

        proc = subprocess.run(
            [
                sys.executable,
                "-m",
                "python.tools.srt_to_csv",
                "--reverse",
                "--reverse-joined",
                in_csv,
                "--output-dir",
                out_dir,
            ],
            capture_output=True,
            text=True,
        )

        assert proc.returncode == 0, proc.stderr
        out_files = sorted(
            [n for n in os.listdir(out_dir) if n.lower().endswith(".srt")]
        )
        assert out_files == [
            "A_BEL_FRA.srt",
            "A_BEL_FRA_2.srt",
            "A_DEU.srt",
            "A_DEU_2.srt",
        ]
    finally:
        for folder in (in_dir, out_dir):
            for name in os.listdir(folder):
                path = os.path.join(folder, name)
                if os.path.isfile(path):
                    os.remove(path)
            try:
                os.rmdir(folder)
            except Exception:
                pass
