import os
import re
import sys
import json
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
PYTHON_DIR = os.path.abspath(os.path.join(HERE, '..'))
if PYTHON_DIR not in sys.path:
    sys.path.insert(0, PYTHON_DIR)

import csv_to_json as mod


def read_expected_version() -> str:
    # Converter now falls back to python/readMe/CHANGELOG.md
    changelog_path = os.path.join(PYTHON_DIR, 'readMe', 'CHANGELOG.md')
    assert os.path.isfile(changelog_path), f"Missing {changelog_path}"
    with open(changelog_path, 'r', encoding='utf-8') as f:
        for line in f:
            l = line.strip()
            if l.startswith('#'):
                heading = l.lstrip('#').strip()
                m = re.match(r"\[?v?([0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.]+)?)", heading)
                if m:
                    return m.group(1)
                token = heading.split()[0]
                m2 = re.match(r"v?([0-9]+\.[0-9]+(?:\.[0-9]+)?)", token)
                if m2:
                    return m2.group(1)
                break
    raise AssertionError('Could not parse version from CHANGELOG heading')


def tmp_csv(content: str) -> str:
    f = tempfile.NamedTemporaryFile('w+', delete=False, suffix='.csv')
    f.write(content)
    f.flush()
    f.close()
    return f.name


class VersionFromChangelogTests(unittest.TestCase):
    def test_converter_version_from_python_readme_changelog(self):
        expected_version = read_expected_version()
        # Minimal unified CSV with required global keys
        csv_content = (
            'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL;FRA;GBL;FRA\n'
            'meta_global;;;;;briefVersion;Y;ALL;53;;;;\n'
            'meta_global;;;;;fps;Y;ALL;25;;;;\n'
            'sub;V;1;00:00:00:00;00:00:01:00;;;;;;;;Hello;\n'
        )
        path = tmp_csv(csv_content)
        try:
            with tempfile.TemporaryDirectory() as td:
                out_path = os.path.join(td, 'out.json')
                rc = mod.main([path, out_path])
                self.assertEqual(rc, 0)
                with open(out_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                mg = data.get('metadataGlobal') or data.get('metadata') or {}
                self.assertIsInstance(mg, dict)
                self.assertIn('converterVersion', mg)
                self.assertEqual(mg['converterVersion'], expected_version)
        finally:
            os.remove(path)


if __name__ == '__main__':
    unittest.main(verbosity=2)
