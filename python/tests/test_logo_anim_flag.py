import json, subprocess, os, sys, tempfile, shutil, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
PROJECT = os.path.dirname(ROOT)
# Note: Avoid relying on external input files that may be .gitignored in CI.
# Tests below create their own minimal CSV fixtures in temp directories.
CSV_REL = 'in/data_in_251006_v19.csv'
CSV_PATH = os.path.join(PROJECT, CSV_REL)
CONVERTER = os.path.join(PROJECT, 'python', 'csv_to_json.py')


def run(cmd):
    # If requested, wrap subprocess execution under coverage so CLI code is measured.
    if os.getenv('COVERAGE_SUBPROCESS') == '1':
        # Expect cmd like [sys.executable, CONVERTER, args...]
        if cmd and cmd[0] == sys.executable:
            cov_cmd = [
                sys.executable, '-m', 'coverage', 'run', '-p', '--branch', '--source', 'python',
                cmd[1]
            ] + cmd[2:]
            cmd = cov_cmd
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"Command failed: {' '.join(cmd)}\nSTDERR:\n{res.stderr}")
    return res


def load_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


class LogoAnimFlagTests(unittest.TestCase):
    def test_duration_token_normalization_06_matches_6(self):
        tmpdir = tempfile.mkdtemp(prefix='logo_anim_flag_norm_')
        try:
            csv_path = os.path.join(tmpdir, 'norm.csv')
            csv_content = (
                'record_type;video_id;line;start;end;key;target_duration;is_global;country_scope;metadata;GBL;GBL;DEU;DEU\n'
                'meta_global;;;;;schemaVersion;;Y;ALL;53;;;;\n'
                'meta_global;;;;;briefVersion;;Y;ALL;53;;;;\n'
                'meta_global;;;;;fps;;Y;ALL;25;;;;\n'
                'meta_global;;;;;logo_anim_flag;06;Y;;YES;;;;\n'
                'meta_global;;;;;orientation;;Y;ALL;;landscape;portrait;landscape;portrait\n'
                'meta_local;WTA_6s;;;;duration;;N;ALL;6;;;;\n'
                'meta_local;WTA_6s;;;;title;;N;ALL;WTA;;;;\n'
                'sub;WTA_6s;1;00:00:01:00;00:00:02:00;;;;;;Hello;;Hallo;\n'
            )
            with open(csv_path, 'w', encoding='utf-8') as f:
                f.write(csv_content)
            out_pattern = os.path.join(tmpdir, 'out_{country}.json')
            run([sys.executable, CONVERTER, csv_path, os.path.join(tmpdir, 'out.json'), '--split-by-country', '--output-pattern', out_pattern])
            deu_path = out_pattern.replace('{country}', 'DEU')
            data = load_json(deu_path)
            mapping = data.get('metadataGlobal', {}).get('logo_anim_flag', {})
            self.assertIn('6', mapping)
            self.assertNotIn('06', mapping)
            self.assertEqual(mapping.get('6'), 'YES')
            v = next((v for v in data.get('videos', []) if v.get('metadata', {}).get('duration') in ('6', 6)), None)
            self.assertIsNotNone(v)
            self.assertEqual(v.get('metadata', {}).get('logo_anim_flag'), 'YES')
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)

    def test_target_duration_column_preferred(self):
        tmpdir = tempfile.mkdtemp(prefix='logo_anim_flag_target_duration_')
        try:
            csv_path = os.path.join(tmpdir, 'target_duration.csv')
            csv_content = (
                'record_type;video_id;line;start;end;key;target_duration;is_global;country_scope;metadata;GBL;GBL;DEU;DEU\n'
                'meta_global;;;;;schemaVersion;;Y;ALL;53;;;;\n'
                'meta_global;;;;;briefVersion;;Y;ALL;53;;;;\n'
                'meta_global;;;;;fps;;Y;ALL;25;;;;\n'
                'meta_global;;;;;logo_anim_flag;30;Y;ALL;Y;;;;\n'
                'meta_global;;;;;orientation;;Y;ALL;;landscape;portrait;landscape;portrait\n'
                'meta_local;WTA_30s;;;;duration;;N;ALL;30;;;;\n'
                'meta_local;WTA_30s;;;;title;;N;ALL;WTA;;;;\n'
                'sub;WTA_30s;1;00:00:01:00;00:00:02:00;;;;;;Hello;;Hallo;\n'
            )
            with open(csv_path, 'w', encoding='utf-8') as f:
                f.write(csv_content)
            out_pattern = os.path.join(tmpdir, 'out_{country}.json')
            res = run([sys.executable, CONVERTER, csv_path, os.path.join(tmpdir, 'out.json'), '--split-by-country', '--output-pattern', out_pattern])
            self.assertNotIn("deprecated", res.stderr.lower(), 'Should not warn when target_duration is used')
            deu_path = out_pattern.replace('{country}', 'DEU')
            data = load_json(deu_path)
            mapping = data.get('metadataGlobal', {}).get('logo_anim_flag', {})
            self.assertEqual(mapping.get('30'), 'Y')
            v = next((v for v in data.get('videos', []) if v.get('metadata', {}).get('duration') in ('30', 30)), None)
            self.assertIsNotNone(v)
            self.assertEqual(v.get('metadata', {}).get('logo_anim_flag'), 'Y')
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)

    def test_legacy_country_scope_duration_warns_once(self):
        tmpdir = tempfile.mkdtemp(prefix='logo_anim_flag_legacy_warn_')
        try:
            csv_path = os.path.join(tmpdir, 'legacy.csv')
            csv_content = (
                'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL;GBL;DEU;DEU\n'
                'meta_global;;;;;schemaVersion;Y;ALL;53;;;;\n'
                'meta_global;;;;;briefVersion;Y;ALL;53;;;;\n'
                'meta_global;;;;;fps;Y;ALL;25;;;;\n'
                'meta_global;;;;;logo_anim_flag;;30;Y;;;;\n'
                'meta_global;;;;;logo_anim_flag;;60;N;;;;\n'
                'meta_global;;;;;orientation;Y;ALL;;landscape;portrait;landscape;portrait\n'
                'meta_local;WTA_30s;;;;duration;N;ALL;30;;;;\n'
                'meta_local;WTA_30s;;;;title;N;ALL;WTA;;;;\n'
                'sub;WTA_30s;1;00:00:01:00;00:00:02:00;;;;;Hello;;Hallo;\n'
            )
            with open(csv_path, 'w', encoding='utf-8') as f:
                f.write(csv_content)
            out_pattern = os.path.join(tmpdir, 'out_{country}.json')
            res = run([sys.executable, CONVERTER, csv_path, os.path.join(tmpdir, 'out.json'), '--split-by-country', '--output-pattern', out_pattern])
            lowered = res.stderr.lower()
            self.assertIn('deprecated', lowered)
            self.assertEqual(lowered.count('deprecated'), 1, 'Legacy warning should be emitted once per run')
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)

    def test_overview_present_and_per_video_injection(self):
        tmpdir = tempfile.mkdtemp(prefix='logo_anim_flag_')
        try:
            # Create a minimal CSV with mapping and one 120s video
            csv_path = os.path.join(tmpdir, 'sample.csv')
            csv_content = (
                'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL;GBL;DEU;DEU;SAU;SAU\n'
                'meta_global;;;;;schemaVersion;Y;ALL;53;;;;;;\n'
                'meta_global;;;;;briefVersion;Y;ALL;53;;;;;;\n'
                'meta_global;;;;;fps;Y;ALL;25;;;;;;\n'
                'meta_global;;;;;logo_anim_flag;;30;Y;;;;;;\n'
                'meta_global;;;;;logo_anim_flag;;120;N;;;;;;\n'
                'meta_global;;;;;orientation;Y;ALL;;landscape;portrait;landscape;portrait;landscape;portrait\n'
                'meta_local;WTA_120s;;;;duration;N;ALL;120;;;;;;\n'
                'meta_local;WTA_120s;;;;title;N;ALL;WTA;;;;;;\n'
                'sub;WTA_120s;1;00:00:01:00;00:00:02:00;;;;;Hello;;Hallo;;مرحبا;\n'
            )
            with open(csv_path, 'w', encoding='utf-8') as f:
                f.write(csv_content)
            out_pattern = os.path.join(tmpdir, 'out_{country}.json')
            run([sys.executable, CONVERTER, csv_path, os.path.join(tmpdir, 'out.json'), '--split-by-country', '--output-pattern', out_pattern])
            deu_path = out_pattern.replace('{country}', 'DEU')
            self.assertTrue(os.path.isfile(deu_path), 'DEU output missing')
            data = load_json(deu_path)
            mg = data.get('metadataGlobal', {})
            self.assertIn('logo_anim_flag', mg, 'Overview mapping missing in metadataGlobal')
            mapping = mg['logo_anim_flag']
            self.assertIsInstance(mapping, dict, 'Overview must be an object')
            expected_any = {'6','15','30','60','90','120'} & set(mapping.keys())
            self.assertTrue(expected_any, 'No expected duration keys present in overview')
            videos = data.get('videos', [])
            target = next((v for v in videos if v.get('metadata', {}).get('duration') in (120, '120')), None)
            self.assertIsNotNone(target, 'No video with duration 120 found')
            flag_val = target['metadata'].get('logo_anim_flag')
            map_val = mapping.get('120')
            if flag_val != map_val:
                self.assertIsInstance(map_val, str, 'Unexpected nested mapping retained while values differ')
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)


    def test_overview_removed_with_flag(self):
        tmpdir = tempfile.mkdtemp(prefix='logo_anim_flag_off_')
        try:
            # Minimal CSV as above
            csv_path = os.path.join(tmpdir, 'sample.csv')
            csv_content = (
                'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL;GBL;DEU;DEU;SAU;SAU\n'
                'meta_global;;;;;schemaVersion;Y;ALL;53;;;;;;\n'
                'meta_global;;;;;briefVersion;Y;ALL;53;;;;;;\n'
                'meta_global;;;;;fps;Y;ALL;25;;;;;;\n'
                'meta_global;;;;;logo_anim_flag;;120;N;;;;;;\n'
                'meta_global;;;;;orientation;Y;ALL;;landscape;portrait;landscape;portrait;landscape;portrait\n'
                'meta_local;WTA_120s;;;;duration;N;ALL;120;;;;;;\n'
                'meta_local;WTA_120s;;;;title;N;ALL;WTA;;;;;;\n'
                'sub;WTA_120s;1;00:00:01:00;00:00:02:00;;;;;Hello;;Hallo;;مرحبا;\n'
            )
            with open(csv_path, 'w', encoding='utf-8') as f:
                f.write(csv_content)
            out_pattern = os.path.join(tmpdir, 'out_{country}.json')
            run([sys.executable, CONVERTER, csv_path, os.path.join(tmpdir, 'out.json'), '--split-by-country', '--output-pattern', out_pattern, '--no-logo-anim-overview'])
            deu_path = out_pattern.replace('{country}', 'DEU')
            data = load_json(deu_path)
            mg = data.get('metadataGlobal', {})
            self.assertNotIn('logo_anim_flag', mg, 'Overview should be removed with --no-logo-anim-overview')
            videos = data.get('videos', [])
            target = next((v for v in videos if v.get('metadata', {}).get('duration') in (120, '120')), None)
            self.assertIsNotNone(target, 'No video with duration 120 found')
            self.assertIn('logo_anim_flag', target['metadata'], 'Per-video flag missing when overview disabled')
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)


    def test_trimmed_overview_no_nested_objects(self):
        tmpdir = tempfile.mkdtemp(prefix='logo_anim_flag_trim_')
        try:
            # Create a CSV with two durations to populate overview
            csv_path = os.path.join(tmpdir, 'sample.csv')
            csv_content = (
                'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL;GBL;DEU;DEU;SAU;SAU\n'
                'meta_global;;;;;schemaVersion;Y;ALL;53;;;;;;\n'
                'meta_global;;;;;briefVersion;Y;ALL;53;;;;;;\n'
                'meta_global;;;;;fps;Y;ALL;25;;;;;;\n'
                'meta_global;;;;;logo_anim_flag;;30;Y;;;;;;\n'
                'meta_global;;;;;logo_anim_flag;;120;N;;;;;;\n'
                'meta_global;;;;;orientation;Y;ALL;;landscape;portrait;landscape;portrait;landscape;portrait\n'
                'meta_local;WTA_120s;;;;duration;N;ALL;120;;;;;;\n'
                'meta_local;WTA_120s;;;;title;N;ALL;WTA;;;;;;\n'
                'sub;WTA_120s;1;00:00:01:00;00:00:02:00;;;;;Hello;;Hallo;;مرحبا;\n'
            )
            with open(csv_path, 'w', encoding='utf-8') as f:
                f.write(csv_content)
            out_pattern = os.path.join(tmpdir, 'out_{country}.json')
            run([sys.executable, CONVERTER, csv_path, os.path.join(tmpdir, 'out.json'), '--split-by-country', '--output-pattern', out_pattern])
            deu_path = out_pattern.replace('{country}', 'DEU')
            data = load_json(deu_path)
            mapping = data.get('metadataGlobal', {}).get('logo_anim_flag', {})
            self.assertTrue(mapping, 'Overview missing for trimming test')
            for dur, val in mapping.items():
                self.assertFalse(isinstance(val, dict), f"Duration {dur} still has nested object after trimming")
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)


    def test_meta_local_logo_anim_override(self):
        """Meta_local logo_anim_flag should override mapping (mapping 30:Y, meta_local 30:N)."""
        tmpdir = tempfile.mkdtemp(prefix='logo_anim_flag_override_')
        try:
            csv_path = os.path.join(tmpdir, 'override.csv')
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
            self.assertTrue(overview and overview.get('30') in ('Y', 'N'), 'Overview missing 30 key')
            v = next((v for v in data.get('videos', []) if v.get('metadata', {}).get('duration') in ('30', 30)), None)
            self.assertIsNotNone(v, 'Video WTA_30s not found')
            per_video_value = v['metadata'].get('logo_anim_flag')
            self.assertEqual(per_video_value, 'N', f'Expected per-video override N, got {per_video_value}')
            if overview.get('30') == 'Y':
                self.assertNotEqual(per_video_value, overview.get('30'), 'Override did not supersede mapping')
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)

    def test_missing_duration_no_logo_flag_injection(self):
        """Video duration not present in mapping should not get a logo_anim_flag automatically."""
        tmpdir = tempfile.mkdtemp(prefix='logo_anim_flag_missing_')
        try:
            csv_path = os.path.join(tmpdir, 'missing.csv')
            # Mapping only for 60, video duration 45
            csv_content = (
                'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL;GBL;DEU;DEU;SAU;SAU\n'
                'meta_global;;;;;schemaVersion;Y;ALL;53;;;;;;\n'
                'meta_global;;;;;briefVersion;Y;ALL;53;;;;;;\n'
                'meta_global;;;;;fps;Y;ALL;25;;;;;;\n'
                'meta_global;;;;;logo_anim_flag;;60;Y;;;;;;\n'
                'meta_global;;;;;orientation;Y;ALL;;landscape;portrait;landscape;portrait;landscape;portrait\n'
                'meta_local;WTA_45s;;;;duration;N;ALL;45;;;;;;\n'
                'meta_local;WTA_45s;;;;title;N;ALL;WTA;;;;;;\n'
                'sub;WTA_45s;1;00:00:01:00;00:00:02:00;;;;;Hello;;Hallo;;مرحبا;\n'
            )
            with open(csv_path, 'w', encoding='utf-8') as f: f.write(csv_content)
            out_pattern = os.path.join(tmpdir, 'out_{country}.json')
            run([sys.executable, CONVERTER, csv_path, os.path.join(tmpdir, 'out.json'), '--split-by-country', '--output-pattern', out_pattern])
            deu_path = out_pattern.replace('{country}', 'DEU')
            data = load_json(deu_path)
            v = next((v for v in data.get('videos', []) if v.get('metadata', {}).get('duration') in ('45', 45)), None)
            self.assertIsNotNone(v, 'Video WTA_45s not found')
            self.assertNotIn('logo_anim_flag', v['metadata'], 'Unexpected logo_anim_flag for unmapped duration')
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)

    def test_logo_anim_row_without_duration_becomes_scalar_default(self):
        """Row without duration acts as untargeted default (scalar overview by default)."""
        tmpdir = tempfile.mkdtemp(prefix='logo_anim_flag_malformed_')
        try:
            csv_path = os.path.join(tmpdir, 'malformed.csv')
            csv_content = (
                'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL;GBL;DEU;DEU;SAU;SAU\n'
                'meta_global;;;;;schemaVersion;Y;ALL;53;;;;;;\n'
                'meta_global;;;;;briefVersion;Y;ALL;53;;;;;;\n'
                'meta_global;;;;;fps;Y;ALL;25;;;;;;\n'
                'meta_global;;;;;logo_anim_flag;;;Y;;;;;;\n'  # no duration -> default
                'meta_global;;;;;orientation;Y;ALL;;landscape;portrait;landscape;portrait;landscape;portrait\n'
                'meta_local;WTA_60s;;;;duration;N;ALL;60;;;;;;\n'
                'meta_local;WTA_60s;;;;title;N;ALL;WTA;;;;;;\n'
                'sub;WTA_60s;1;00:00:01:00;00:00:02:00;;;;;Hello;;Hallo;;مرحبا;\n'
            )
            with open(csv_path, 'w', encoding='utf-8') as f: f.write(csv_content)
            out_pattern = os.path.join(tmpdir, 'out_{country}.json')
            run([sys.executable, CONVERTER, csv_path, os.path.join(tmpdir, 'out.json'), '--split-by-country', '--output-pattern', out_pattern])
            deu_path = out_pattern.replace('{country}', 'DEU')
            data = load_json(deu_path)
            mg = data.get('metadataGlobal', {})
            self.assertEqual(mg.get('logo_anim_flag'), 'Y')
            v = next((v for v in data.get('videos', []) if v.get('metadata', {}).get('duration') in ('60', 60)), None)
            self.assertIsNotNone(v)
            self.assertEqual(v.get('metadata', {}).get('logo_anim_flag'), 'Y')
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)

    def test_flags_overview_object_always_option(self):
        tmpdir = tempfile.mkdtemp(prefix='logo_anim_flag_obj_always_')
        try:
            csv_path = os.path.join(tmpdir, 'obj_always.csv')
            csv_content = (
                'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL;GBL;DEU;DEU\n'
                'meta_global;;;;;schemaVersion;Y;ALL;53;;;;\n'
                'meta_global;;;;;briefVersion;Y;ALL;53;;;;\n'
                'meta_global;;;;;fps;Y;ALL;25;;;;\n'
                'meta_global;;;;;logo_anim_flag;;;Y;;;;\n'
                'meta_global;;;;;orientation;Y;ALL;;landscape;portrait;landscape;portrait\n'
                'meta_local;WTA_60s;;;;duration;N;ALL;60;;;;\n'
                'meta_local;WTA_60s;;;;title;N;ALL;WTA;;;;\n'
                'sub;WTA_60s;1;00:00:01:00;00:00:02:00;;;;;Hello;;Hallo;\n'
            )
            with open(csv_path, 'w', encoding='utf-8') as f:
                f.write(csv_content)
            out_pattern = os.path.join(tmpdir, 'out_{country}.json')
            run([
                sys.executable, CONVERTER, csv_path, os.path.join(tmpdir, 'out.json'),
                '--split-by-country', '--output-pattern', out_pattern,
                '--flags-overview-object-always',
            ])
            deu_path = out_pattern.replace('{country}', 'DEU')
            data = load_json(deu_path)
            overview = data.get('metadataGlobal', {}).get('logo_anim_flag', {})
            self.assertIsInstance(overview, dict)
            self.assertEqual(overview.get('_default'), 'Y')
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)

if __name__ == '__main__':
    unittest.main(verbosity=2)
