import json
import os
import tempfile
import textwrap
import subprocess
import sys

SCRIPT = 'python/tools/csv_json_media.py'


def run_tool(csv_text: str, delimiter=';'):
    fd_in, path_in = tempfile.mkstemp(suffix='.csv'); os.close(fd_in)
    fd_out, path_out = tempfile.mkstemp(suffix='.json'); os.close(fd_out)
    with open(path_in, 'w', encoding='utf-8') as f:
        f.write(csv_text)
    args = [sys.executable, SCRIPT, path_in, path_out, '--delimiter', delimiter]
    proc = subprocess.run(args, capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr
    data = json.load(open(path_out, 'r', encoding='utf-8'))
    os.remove(path_in); os.remove(path_out)
    return data


def test_duration_parsing_and_padding_and_suffix():
    csv_text = textwrap.dedent(
        """
        AspectRatio;Dimensions;Creative;Media;Template;Template_name
        1x1;640x640;6sC1;TikTok;regular;
        9x16;720x1280;15sC1;TikTok;extra;tiktok
        """
    )
    data = run_tool(csv_text)
    assert '1x1|06s' in data
    assert '9x16_tiktok|15s' in data
    assert data['1x1|06s'][0] == {"size": "640x640", "media": "TikTok"}
    assert data['9x16_tiktok|15s'][0]["size"] == "720x1280"


def test_consecutive_creative_dedup_keeps_first_only():
    csv_text = textwrap.dedent(
        """
        AspectRatio;Dimensions;Creative;Media;Template;Template_name
        1x1;1440x1440;15sC1;Meta InFeed;regular;
        1x1;1440x1440;15sC2;Meta InFeed;regular;
        1x1;1440x1440;15sC3;Meta InFeed;regular;
        1x1;1440x1440;15sC4;Meta InFeed;regular;
        1x1;1440x1440;15sC5;Meta InFeed;regular;
        1x1;1440x1440;6sC1;Meta InFeed;regular;
        """
    )
    data = run_tool(csv_text)
    # Only the first for 15s*, then the distinct 06s should be present
    assert '1x1|15s' in data
    assert len(data['1x1|15s']) == 1
    assert data['1x1|15s'][0] == {"size": "1440x1440", "media": "Meta InFeed"}
    assert '1x1|06s' in data


def test_output_shape_multiple_keys_and_pairs_no_duplicates():
    csv_text = textwrap.dedent(
        """
        AspectRatio;Dimensions;Creative;Media;Template;Template_name
        9x16;720x1280;15sC1;TikTok;extra;tiktok
        9x16;720x1280;15sC2;TikTok;extra;tiktok
        9x16;720x1280;15sC1;Meta InFeed;regular;
        9x16;720x1280;15sC2;Meta InFeed;regular;
        1x1;640x640;6sC1;TikTok;regular;
        """
    )
    data = run_tool(csv_text)
    assert '9x16_tiktok|15s' in data
    assert '9x16|15s' in data
    # two entries under 9x16_tiktok|15s? No, both rows are same size/media; consecutive C2 is dropped, so one
    assert len(data['9x16_tiktok|15s']) == 1
    # 9x16|15s should include Meta InFeed once
    assert len(data['9x16|15s']) == 1
    # 1x1|06s present
    assert '1x1|06s' in data


def test_compact_output_inline_items():
    csv_text = textwrap.dedent(
        """
        AspectRatio;Dimensions;Creative;Media;Template;Template_name
        1x1;640x640;6sC1;TikTok;regular;
        1x1;1440x1440;6sC1;Meta InFeed;regular;
        """
    )
    # Write compact output to a temp file and inspect text
    fd_in, path_in = tempfile.mkstemp(suffix='.csv'); os.close(fd_in)
    fd_out, path_out = tempfile.mkstemp(suffix='.json'); os.close(fd_out)
    with open(path_in, 'w', encoding='utf-8') as f:
        f.write(csv_text)
    args = [sys.executable, SCRIPT, path_in, path_out, '--compact']
    proc = subprocess.run(args, capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr
    txt = open(path_out, 'r', encoding='utf-8').read()
    os.remove(path_in); os.remove(path_out)
    # Expect inline items pattern in compact mode
    assert '{ "size"' in txt and '"media"' in txt
    # Objects should be single-line entries inside array
    assert '"size": "640x640"' in txt or '"size":"640x640"' in txt


def test_duration_column_preferred_and_title_ignored():
    # Duration present, Creative may be present but not required; consecutive Title differences are ignored
    csv_text = textwrap.dedent(
        """
        AspectRatio;Dimensions;Duration;Title;Creative;Media;Template;Template_name
        1x1;640x640;6s;C1;;TikTok;regular;
        1x1;640x640;6s;AnotherTitle;;TikTok;regular;
        9x16;720x1280;15s;X1;15sC1;TikTok;extra;tiktok
        9x16;720x1280;15s;X2;15sC2;TikTok;extra;tiktok
        """
    )
    data = run_tool(csv_text)
    # Prefer Duration → keys built from duration tokens
    assert '1x1|06s' in data
    assert '9x16_tiktok|15s' in data
    # Consecutive rows differing only by Title should be deduped to a single entry per group
    assert len(data['1x1|06s']) == 1
    assert len(data['9x16_tiktok|15s']) == 1


def test_dimensions_normalization_removes_spaces():
    csv_text = textwrap.dedent(
        """
        AspectRatio;Dimensions;Duration;Title;Creative;Media;Template;Template_name
        4x5;1440 x 1800;15s;C1;;Meta InFeed;regular;
        1x1;1440 x 1440;06s;C1;;Meta InFeed;regular;
        """
    )
    data = run_tool(csv_text)
    assert '4x5|15s' in data
    assert data['4x5|15s'][0]['size'] == '1440x1800'
    assert '1x1|06s' in data
    assert data['1x1|06s'][0]['size'] == '1440x1440'
