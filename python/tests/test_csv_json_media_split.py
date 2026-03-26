import json
import os
import tempfile
import textwrap
import subprocess
import sys
import pytest

SCRIPT = "python/tools/csv_json_media.py"


def write_xlsx(path: str, sheets: dict[str, list[list[object]]]) -> None:
    openpyxl = pytest.importorskip("openpyxl")
    wb = openpyxl.Workbook()
    first = True
    for name, rows in sheets.items():
        if first:
            ws = wb.active
            ws.title = name
            first = False
        else:
            ws = wb.create_sheet(name)
        for row in rows:
            ws.append(row)
    wb.save(path)
    wb.close()


def test_split_by_country_writes_multiple_files_with_default_pattern():
    csv_text = textwrap.dedent(
        """
        AspectRatio;Dimensions;Creative;Media;Template;Template_name;Country;Language
        1x1;640x640;6sC1;TikTok;regular;;US;EN
        1x1;1440x1440;6sC1;Meta InFeed;regular;;US;
        """
    )
    fd_in, path_in = tempfile.mkstemp(suffix=".csv")
    os.close(fd_in)
    out_dir = tempfile.mkdtemp()
    with open(path_in, "w", encoding="utf-8") as f:
        f.write(csv_text)

    # Provide output pointing to the directory; use split-by-country
    args = [sys.executable, SCRIPT, path_in, out_dir, "--split-by-country"]
    proc = subprocess.run(args, capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr

    # Expect files: media_US_EN.json and media_US.json
    f1 = os.path.join(out_dir, "media_US_EN.json")
    f2 = os.path.join(out_dir, "media_US.json")
    assert os.path.exists(f1), f"Missing {f1}"
    assert os.path.exists(f2), f"Missing {f2}"

    with open(f1, "r", encoding="utf-8") as f:
        data1 = json.load(f)
    with open(f2, "r", encoding="utf-8") as f:
        data2 = json.load(f)

    # Basic sanity: keys exist and items count
    assert "1x1|06s" in data1
    assert "1x1|06s" in data2
    assert len(data1["1x1|06s"]) == 1
    assert len(data2["1x1|06s"]) == 1

    # Cleanup
    os.remove(path_in)
    os.remove(f1)
    os.remove(f2)
    os.rmdir(out_dir)


def test_split_dry_run_prints_group_summary():
    csv_text = textwrap.dedent(
        """
        AspectRatio;Dimensions;Creative;Media;Template;Template_name;Country;Language
        9x16;720x1280;15sC1;TikTok;extra;tiktok;CZ;cs
        9x16;720x1280;15sC2;TikTok;extra;tiktok;CZ;cs
        1x1;640x640;6sC1;Meta InFeed;regular;;DE;
        """
    )
    fd_in, path_in = tempfile.mkstemp(suffix=".csv")
    os.close(fd_in)
    fd_out, path_out = tempfile.mkstemp(suffix=".json")
    os.close(fd_out)
    with open(path_in, "w", encoding="utf-8") as f:
        f.write(csv_text)

    args = [
        sys.executable,
        SCRIPT,
        path_in,
        path_out,
        "--split-by-country",
        "--dry-run",
    ]
    proc = subprocess.run(args, capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr
    # Expect summary lines with labels CZ_cs and DE
    out = proc.stdout
    assert "groups=" in out
    assert "- CZ_cs:" in out or "- CZ_CS:" in out
    assert "- DE:" in out

    # Cleanup
    os.remove(path_in)
    os.remove(path_out)


def test_split_by_country_from_xlsx_default_media_sheet():
    fd_in, path_in = tempfile.mkstemp(suffix=".xlsx")
    os.close(fd_in)
    out_dir = tempfile.mkdtemp()
    try:
        write_xlsx(
            path_in,
            {
                "Sheet1": [
                    [
                        "AspectRatio",
                        "Dimensions",
                        "Creative",
                        "Media",
                        "Template",
                        "Template_name",
                        "Country",
                        "Language",
                    ],
                    ["1x1", "640x640", "6sC1", "Wrong", "regular", "", "US", "EN"],
                ],
                "media": [
                    [
                        "AspectRatio",
                        "Dimensions",
                        "Creative",
                        "Media",
                        "Template",
                        "Template_name",
                        "Country",
                        "Language",
                    ],
                    ["1x1", "640x640", "6sC1", "TikTok", "regular", "", "US", "EN"],
                    [
                        "1x1",
                        "1440x1440",
                        "6sC1",
                        "Meta InFeed",
                        "regular",
                        "",
                        "US",
                        "",
                    ],
                ],
            },
        )

        proc = subprocess.run(
            [sys.executable, SCRIPT, path_in, out_dir, "--split-by-country"],
            capture_output=True,
            text=True,
        )
        assert proc.returncode == 0, proc.stderr

        f1 = os.path.join(out_dir, "media_US_EN.json")
        f2 = os.path.join(out_dir, "media_US.json")
        assert os.path.exists(f1)
        assert os.path.exists(f2)

        with open(f1, "r", encoding="utf-8") as f:
            data1 = json.load(f)
        with open(f2, "r", encoding="utf-8") as f:
            data2 = json.load(f)
        assert data1["1x1|06s"][0]["media"] == "TikTok"
        assert data2["1x1|06s"][0]["media"] == "Meta InFeed"
    finally:
        try:
            os.remove(path_in)
        except Exception:
            pass
        for fname in ("media_US_EN.json", "media_US.json"):
            try:
                os.remove(os.path.join(out_dir, fname))
            except Exception:
                pass
        try:
            os.rmdir(out_dir)
        except Exception:
            pass
