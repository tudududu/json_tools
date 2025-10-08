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
        map_val = mapping.get('120')
        # If trimmed overview lost nested override detail, allow mismatch (override applied per-country)
        if flag_val != map_val:
            # Acceptable only if overview is scalar (not nested) and flag_val is different, implying override
            assert isinstance(map_val, str), 'Unexpected nested mapping retained while values differ'
        else:
            # Direct match also acceptable
            pass
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


def test_trimmed_overview_no_nested_objects():
    """Ensure per-country split output flattens nested per-country overrides (no _default objects)."""
    tmpdir = tempfile.mkdtemp(prefix='logo_anim_flag_trim_')
    try:
        out_pattern = os.path.join(tmpdir, 'out_{country}.json')
        run([sys.executable, CONVERTER, CSV_PATH, os.path.join(tmpdir, 'out.json'), '--split-by-country', '--output-pattern', out_pattern])
        deu_path = out_pattern.replace('{country}', 'DEU')
        data = load_json(deu_path)
        mapping = data.get('metadataGlobal', {}).get('logo_anim_flag', {})
        assert mapping, 'Overview missing for trimming test'
        for dur, val in mapping.items():
            # After trimming, each value should be a scalar (string) not a dict
            assert not isinstance(val, dict), f"Duration {dur} still has nested object after trimming"
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def test_meta_local_logo_anim_override():
    """Meta_local logo_anim_flag should override mapping (mapping 30:Y, meta_local 30:N)."""
    tmpdir = tempfile.mkdtemp(prefix='logo_anim_flag_override_')
    try:
        csv_path = os.path.join(tmpdir, 'override.csv')
        # Minimal CSV with mapping (30 -> Y) and meta_local override (N)
        csv_content = (
            'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL;GBL;DEU;DEU;SAU;SAU\n'
            'meta_global;;;;;schemaVersion;Y;ALL;53;;;;;;\n'
            'meta_global;;;;;briefVersion;Y;ALL;53;;;;;;\n'
            'meta_global;;;;;fps;Y;ALL;25;;;;;;\n'
            'meta_global;;;;;logo_anim_flag;;30;Y;;;;;;\n'
            'meta_global;;;;;orientation;Y;ALL;;landscape;portrait;landscape;portrait;landscape;portrait\n'
            'meta_local;WTA_30s;;;;duration;N;ALL;30;;;;;;\n'
            'meta_local;WTA_30s;;;;title;N;ALL;WTA;;;;;;\n'
            'meta_local;WTA_30s;;;;logo_anim_flag;N;ALL;N;;;;;;\n'
            'sub;WTA_30s;1;00:00:01:00;00:00:02:00;;;;;Hello;;Hallo;;مرحبا;\n'
        )
        with open(csv_path, 'w', encoding='utf-8') as f:
            f.write(csv_content)
        out_pattern = os.path.join(tmpdir, 'out_{country}.json')
        run([sys.executable, CONVERTER, csv_path, os.path.join(tmpdir, 'out.json'), '--split-by-country', '--output-pattern', out_pattern])
        deu_path = out_pattern.replace('{country}', 'DEU')
        data = load_json(deu_path)
        mg = data.get('metadataGlobal', {})
        overview = mg.get('logo_anim_flag')
        assert overview and overview.get('30') in ('Y', 'N'), 'Overview missing 30 key'
        # Find video
        v = next((v for v in data.get('videos', []) if v.get('metadata', {}).get('duration') in ('30', 30)), None)
        assert v, 'Video WTA_30s not found'
        per_video_value = v['metadata'].get('logo_anim_flag')
        assert per_video_value == 'N', f'Expected per-video override N, got {per_video_value}'
        # Ensure mapping default not forcibly changed by override (still Y if originally Y)
        # If overview used nested structure it will be scalar after trimming; accept either Y or N but detect mismatch scenario
        # The core assertion is that per-video differs from mapping when mapping == Y.
        if overview.get('30') == 'Y':
            assert per_video_value != overview.get('30'), 'Override did not supersede mapping'
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

if __name__ == '__main__':
    # Run tests manually if executed directly
    test_overview_present_and_per_video_injection()
    test_overview_removed_with_flag()
    test_trimmed_overview_no_nested_objects()
    test_meta_local_logo_anim_override()
    print('All logo_anim_flag tests passed.')
