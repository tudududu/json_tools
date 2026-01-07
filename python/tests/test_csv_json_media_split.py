import json
import os
import tempfile
import textwrap
import subprocess
import sys

SCRIPT = 'python/tools/csv_json_media.py'


def test_split_by_country_writes_multiple_files_with_default_pattern():
    csv_text = textwrap.dedent(
        """
        AspectRatio;Dimensions;Creative;Media;Template;Template_name;Country;Language
        1x1;640x640;6sC1;TikTok;regular;;US;EN
        1x1;1440x1440;6sC1;Meta InFeed;regular;;US;
        """
    )
    fd_in, path_in = tempfile.mkstemp(suffix='.csv'); os.close(fd_in)
    out_dir = tempfile.mkdtemp()
    with open(path_in, 'w', encoding='utf-8') as f:
        f.write(csv_text)

    # Provide output pointing to the directory; use split-by-country
    args = [sys.executable, SCRIPT, path_in, out_dir, '--split-by-country']
    proc = subprocess.run(args, capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr

    # Expect files: media_US_EN.json and media_US.json
    f1 = os.path.join(out_dir, 'media_US_EN.json')
    f2 = os.path.join(out_dir, 'media_US.json')
    assert os.path.exists(f1), f"Missing {f1}"
    assert os.path.exists(f2), f"Missing {f2}"

    data1 = json.load(open(f1, 'r', encoding='utf-8'))
    data2 = json.load(open(f2, 'r', encoding='utf-8'))

    # Basic sanity: keys exist and items count
    assert '1x1|06s' in data1
    assert '1x1|06s' in data2
    assert len(data1['1x1|06s']) == 1
    assert len(data2['1x1|06s']) == 1

    # Cleanup
    os.remove(path_in)
    os.remove(f1); os.remove(f2)
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
    fd_in, path_in = tempfile.mkstemp(suffix='.csv'); os.close(fd_in)
    fd_out, path_out = tempfile.mkstemp(suffix='.json'); os.close(fd_out)
    with open(path_in, 'w', encoding='utf-8') as f:
        f.write(csv_text)

    args = [sys.executable, SCRIPT, path_in, path_out, '--split-by-country', '--dry-run']
    proc = subprocess.run(args, capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr
    # Expect summary lines with labels CZ_cs and DE
    out = proc.stdout
    assert 'groups=' in out
    assert '- CZ_cs:' in out or '- CZ_CS:' in out
    assert '- DE:' in out

    # Cleanup
    os.remove(path_in); os.remove(path_out)
