import json
import os
import tempfile
import textwrap
import subprocess
import sys

SCRIPT = 'python/tools/csv_json_media.py'


def test_blank_separator_rows_are_ignored_with_country_language_header():
    # Header includes Country/Language first, then required fields
    csv_text = textwrap.dedent(
        """
        Country;Language;AspectRatio;Dimensions;Creative;Media;Template;Template_name
        DEU;;9x16;1080x1920;15sC1;Snapchat Story DEU;regular;
        ;;;;;;;
        …;;;;;;;
        BEL;FRA;9x16;1080x1920;06sC1;Snapchat Story BEL FRA;regular;
        """
    )
    fd_in, path_in = tempfile.mkstemp(suffix='.csv'); os.close(fd_in)
    fd_out, path_out = tempfile.mkstemp(suffix='.json'); os.close(fd_out)
    with open(path_in, 'w', encoding='utf-8') as f:
        f.write(csv_text)
    args = [sys.executable, SCRIPT, path_in, path_out]
    proc = subprocess.run(args, capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr
    data = json.load(open(path_out, 'r', encoding='utf-8'))
    # Expect two keys from the two non-blank rows
    keys = list(data.keys())
    assert '9x16|15s' in keys or '9x16|06s' in keys
    os.remove(path_in); os.remove(path_out)


def test_blank_separator_rows_with_split_do_not_crash():
    csv_text = textwrap.dedent(
        """
        Country;Language;AspectRatio;Dimensions;Creative;Media;Template;Template_name
        DEU;;9x16;540x960;06sC1;TikTok;extra;tiktok
        ;;;;;;;
        BEL;FRA;9x16;1080x1920;15sC1;Snapchat Story BEL FRA;regular;
        """
    )
    fd_in, path_in = tempfile.mkstemp(suffix='.csv'); os.close(fd_in)
    out_dir = tempfile.mkdtemp()
    with open(path_in, 'w', encoding='utf-8') as f:
        f.write(csv_text)
    args = [sys.executable, SCRIPT, path_in, out_dir, '--split-by-country']
    proc = subprocess.run(args, capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr
    # Expect files for DEU and BEL
    deu = os.path.join(out_dir, 'media_DEU.json')
    bel_fra = os.path.join(out_dir, 'media_BEL_FRA.json')
    assert os.path.exists(deu)
    assert os.path.exists(bel_fra)
    os.remove(path_in)
    os.remove(deu); os.remove(bel_fra); os.rmdir(out_dir)
