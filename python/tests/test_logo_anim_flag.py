import json, subprocess, os, sys, tempfile, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
PROJECT = os.path.dirname(ROOT)
CSV_REL = 'in/data_in_251006_v19.csv'
CSV_PATH = os.path.join(PROJECT, CSV_REL)
CONVERTER = os.path.join(PROJECT, 'python', 'csv_to_subtitles_json.py')


def run(cmd):
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"Command failed: {' '.join(cmd)}\nSTDERR:\n{res.stderr}")
    return res


def load_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def test_overview_present_and_per_video_injection():
    tmpdir = tempfile.mkdtemp(prefix='logo_anim_flag_')
    try:
        out_pattern = os.path.join(tmpdir, 'out_{country}.json')
        run([sys.executable, CONVERTER, CSV_PATH, os.path.join(tmpdir, 'out.json'), '--split-by-country', '--output-pattern', out_pattern])
        # Pick one country file (DEU) expected
        deu_path = out_pattern.replace('{country}', 'DEU')
        assert os.path.isfile(deu_path), 'DEU output missing'
        data = load_json(deu_path)
        mg = data.get('metadataGlobal', {})
        assert 'logo_anim_flag' in mg, 'Overview mapping missing in metadataGlobal'
        mapping = mg['logo_anim_flag']
        assert isinstance(mapping, dict), 'Overview must be an object'
        # Ensure at least one known key from sample durations exists
        expected_any = {'6','15','30','60','90','120'} & set(mapping.keys())
        assert expected_any, 'No expected duration keys present in overview'
        # Per-video injection: find a video with duration 120 (WTAVL_120s)
        videos = data.get('videos', [])
        target = next((v for v in videos if v.get('metadata', {}).get('duration') in (120, '120')), None)
        assert target, 'No video with duration 120 found'
        flag_val = target['metadata'].get('logo_anim_flag')
        assert flag_val == mapping.get('120'), 'Per-video flag does not match overview mapping for 120'
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def test_overview_removed_with_flag():
    tmpdir = tempfile.mkdtemp(prefix='logo_anim_flag_off_')
    try:
        out_pattern = os.path.join(tmpdir, 'out_{country}.json')
        run([sys.executable, CONVERTER, CSV_PATH, os.path.join(tmpdir, 'out.json'), '--split-by-country', '--output-pattern', out_pattern, '--no-logo-anim-overview'])
        deu_path = out_pattern.replace('{country}', 'DEU')
        data = load_json(deu_path)
        mg = data.get('metadataGlobal', {})
        assert 'logo_anim_flag' not in mg, 'Overview should be removed with --no-logo-anim-overview'
        # But per-video metadata should still include value (e.g. 120)
        videos = data.get('videos', [])
        target = next((v for v in videos if v.get('metadata', {}).get('duration') in (120, '120')), None)
        assert target, 'No video with duration 120 found'
        assert 'logo_anim_flag' in target['metadata'], 'Per-video flag missing when overview disabled'
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

if __name__ == '__main__':
    # Run tests manually if executed directly
    test_overview_present_and_per_video_injection()
    test_overview_removed_with_flag()
    print('All logo_anim_flag tests passed.')
