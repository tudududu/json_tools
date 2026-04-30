import os
import tempfile
from types import SimpleNamespace

from python.tools.srt_csv import cli_ops
from python.tools.srt_csv.reverse_seam import reset_reverse_engine, set_reverse_engine


class _FakeEngine:
    def __init__(self) -> None:
        self.csv_calls = []
        self.joined_calls = []

    def csv_to_srt(
        self,
        in_path,
        out_path,
        fps,
        encoding,
        start_col=None,
        end_col=None,
        text_col=None,
    ) -> None:
        self.csv_calls.append(
            {
                "in_path": in_path,
                "out_path": out_path,
                "fps": fps,
                "encoding": encoding,
                "start_col": start_col,
                "end_col": end_col,
                "text_col": text_col,
            }
        )

    def csv_to_srt_joined(
        self,
        in_path,
        out_dir,
        fps,
        encoding,
        start_col=None,
        end_col=None,
        text_col=None,
    ):
        self.joined_calls.append(
            {
                "in_path": in_path,
                "out_dir": out_dir,
                "fps": fps,
                "encoding": encoding,
                "start_col": start_col,
                "end_col": end_col,
                "text_col": text_col,
            }
        )
        return []


def test_cli_ops_reverse_mode_uses_installed_seam_engine():
    tmp_dir = tempfile.mkdtemp()
    in_csv = os.path.join(tmp_dir, "in.csv")
    out_srt = os.path.join(tmp_dir, "out.srt")
    with open(in_csv, "w", encoding="utf-8") as f:
        f.write("Start Time,End Time,Text\n")

    fake = _FakeEngine()
    set_reverse_engine(fake)
    try:
        args = SimpleNamespace(
            join_output=False,
            reverse_joined=False,
            input_dir=None,
            output_dir=None,
            input=in_csv,
            output=out_srt,
            fps=25.0,
            encoding="utf-8-sig",
            start_col=None,
            end_col=None,
            text_col=None,
        )

        cli_ops.run_reverse_mode(args)

        assert len(fake.csv_calls) == 1
        call = fake.csv_calls[0]
        assert call["in_path"] == in_csv
        assert call["out_path"] == out_srt
        assert call["fps"] == 25.0
    finally:
        reset_reverse_engine()
        if os.path.exists(in_csv):
            os.remove(in_csv)
        try:
            os.rmdir(tmp_dir)
        except Exception:
            pass


def test_cli_ops_reverse_joined_uses_installed_seam_engine():
    tmp_dir = tempfile.mkdtemp()
    in_csv = os.path.join(tmp_dir, "joined.csv")
    out_dir = os.path.join(tmp_dir, "out")
    with open(in_csv, "w", encoding="utf-8") as f:
        f.write("Start Time,End Time,Text\n")

    fake = _FakeEngine()
    set_reverse_engine(fake)
    try:
        args = SimpleNamespace(
            join_output=False,
            reverse_joined=True,
            input_dir=None,
            output_dir=out_dir,
            input=in_csv,
            output=None,
            fps=25.0,
            encoding="utf-8-sig",
            start_col=None,
            end_col=None,
            text_col=None,
        )

        cli_ops.run_reverse_mode(args)

        assert len(fake.joined_calls) == 1
        call = fake.joined_calls[0]
        assert call["in_path"] == in_csv
        assert call["out_dir"] == out_dir
        assert call["fps"] == 25.0
    finally:
        reset_reverse_engine()
        if os.path.exists(in_csv):
            os.remove(in_csv)
        if os.path.isdir(out_dir):
            try:
                os.rmdir(out_dir)
            except Exception:
                pass
        try:
            os.rmdir(tmp_dir)
        except Exception:
            pass
