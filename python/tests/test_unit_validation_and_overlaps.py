import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
PYTHON_DIR = os.path.abspath(os.path.join(HERE, '..'))
if PYTHON_DIR not in sys.path:
    sys.path.insert(0, PYTHON_DIR)

import csv_to_subtitles_json as mod


def tmp_csv(content: str) -> str:
    f = tempfile.NamedTemporaryFile('w+', delete=False, suffix='.csv')
    f.write(content)
    f.flush()
    f.close()
    return f.name


class ValidationAndOverlapTests(unittest.TestCase):
    def test_validate_only_passes_on_sectioned_ok(self):
        # Sectioned CSV with subtitles and disclaimers, non-overlapping
        csv_content = (
            'subtitles;line;start;end;text\n'
            ';1;00:00:00:00;00:00:02:00;A\n'
            ';2;00:00:03:00;00:00:04:00;B\n'
            'disclaimer;;;;\n'
            ';1;00:00:10:00;00:00:12:00;D1\n'
            ';2;00:00:13:00;00:00:14:00;D2\n'
        )
        path = tmp_csv(csv_content)
        try:
            # Validation requires an output argument but won't write
            rc = mod.main([path, os.path.join(os.path.dirname(path), 'unused.json'), '--validate-only'])
        finally:
            os.remove(path)
        self.assertEqual(rc, 0)

    def test_validate_only_fails_on_overlaps(self):
        # Overlapping subtitles and disclaimers: second starts before previous ends
        csv_content = (
            'subtitles;line;start;end;text\n'
            ';1;00:00:00:00;00:00:02:00;A\n'
            ';2;00:00:01:20;00:00:03:00;B\n'  # starts before prev end
            'disclaimer;;;;\n'
            ';1;00:00:10:00;00:00:12:00;D1\n'
            ';2;00:00:11:00;00:00:13:00;D2\n'  # overlaps previous disclaimer
        )
        path = tmp_csv(csv_content)
        try:
            rc = mod.main([path, os.path.join(os.path.dirname(path), 'unused.json'), '--validate-only'])
        finally:
            os.remove(path)
        self.assertEqual(rc, 1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
