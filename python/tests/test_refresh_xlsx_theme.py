from __future__ import annotations

from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile


def _make_fake_xlsx(path: Path, with_theme: bool) -> None:
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("[Content_Types].xml", "<Types/>")
        if with_theme:
            zf.writestr("xl/theme/theme1.xml", "<a:theme xmlns:a='x'/>")


def test_extracts_theme_xml_to_default_output_when_output_omitted():
    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        template = td_path / "template.xlsx"
        _make_fake_xlsx(template, with_theme=True)

        out_xml = td_path / "theme.xml"
        proc = subprocess.run(
            [
                sys.executable,
                "-m",
                "python.tools.refresh_xlsx_theme",
                str(template),
                "--output",
                str(out_xml),
            ],
            capture_output=True,
            text=True,
        )
        assert proc.returncode == 0, proc.stderr
        assert out_xml.is_file()
        assert out_xml.read_text(encoding="utf-8") == "<a:theme xmlns:a='x'/>"


def test_fails_when_theme_member_missing():
    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        template = td_path / "template_no_theme.xlsx"
        _make_fake_xlsx(template, with_theme=False)

        out_xml = td_path / "theme.xml"
        proc = subprocess.run(
            [
                sys.executable,
                "-m",
                "python.tools.refresh_xlsx_theme",
                str(template),
                "--output",
                str(out_xml),
            ],
            capture_output=True,
            text=True,
        )
        assert proc.returncode != 0
        combined = (proc.stdout or "") + (proc.stderr or "")
        assert "Template does not contain 'xl/theme/theme1.xml'" in combined
