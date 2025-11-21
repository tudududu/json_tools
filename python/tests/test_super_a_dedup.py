import unittest
import tempfile
import os
import csv_to_json as mod


class DedupMergeTests(unittest.TestCase):
    """Targeted tests for non-contiguous dedup logic (subtitles + super_A)."""

    def test_identical_duplicates_not_concatenated_and_distinct_are(self):
        csv_content = (
            'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL\n'
            'meta_global;;;;;briefVersion;Y;ALL;1;\n'
            'meta_global;;;;;fps;Y;ALL;25;\n'
            'meta_local;VID_A;;;;title;N;ALL;TestVideo;\n'
            # Subtitles duplicates
            # Line 1 original
            'sub;VID_A;1;00:00:00:00;00:00:02:00;;;;;Hello world;\n'
            # Intervening different line (prevents contiguous merge of later duplicate)
            'sub;VID_A;2;00:00:02:00;00:00:04:00;;;;;Middle line;\n'
            # Non-contiguous duplicate of line 1 (should not concatenate identical text)
            'sub;VID_A;1;00:00:00:00;00:00:02:00;;;;;Hello world;\n'
            # Distinct duplicates for line 3
            'sub;VID_A;3;00:00:04:00;00:00:06:00;;;;;Second line;\n'
            'sub;VID_A;3;00:00:04:00;00:00:06:00;;;;;Second line (dup);\n'
            # super_A duplicates
            # super_A line 1 original
            'super_a;VID_A;1;00:00:10:00;00:00:11:00;;;;;EVENT ONE;\n'
            # Intervening different super_A line (prevents contiguous merge)
            'super_a;VID_A;2;00:00:11:00;00:00:12:00;;;;;INTERVENE;\n'
            # Non-contiguous identical duplicate of line 1
            'super_a;VID_A;1;00:00:10:00;00:00:11:00;;;;;EVENT ONE;\n'
            # Distinct duplicates for line 3
            'super_a;VID_A;3;00:00:12:00;00:00:13:00;;;;;EVENT TWO;\n'
            'super_a;VID_A;3;00:00:12:00;00:00:13:00;;;;;EVENT TWO (dup);\n'
        )

        with tempfile.NamedTemporaryFile('w+', delete=False, suffix='.csv', encoding='utf-8') as f:
            f.write(csv_content)
            path = f.name
        try:
            out = mod.convert_csv_to_json(path, fps=25)
            gbl = out['byCountry']['GBL']
            landscape = next(v for v in gbl['videos'] if v['videoId'].endswith('_landscape'))
            subs = landscape['subtitles']
            super_a = landscape['super_A']

            # Subtitle expectations
            # Expect 3 logical subtitle lines (1,2,3) after merge + dedup
            self.assertEqual(len(subs), 3)
            # Line 1 identical duplicate collapsed
            self.assertEqual(subs[0]['line'], 1)
            self.assertEqual(subs[0]['text'], 'Hello world')
            # Line 2 untouched
            self.assertEqual(subs[1]['line'], 2)
            self.assertEqual(subs[1]['text'], 'Middle line')
            # Line 3 distinct duplicates concatenated
            self.assertEqual(subs[2]['line'], 3)
            self.assertEqual(subs[2]['text'], 'Second line\nSecond line (dup)')

            # super_A expectations
            # Expect 3 logical super_A lines
            self.assertEqual(len(super_a), 3)
            self.assertEqual(super_a[0]['line'], 1)
            self.assertEqual(super_a[0]['text'], 'EVENT ONE')
            self.assertEqual(super_a[1]['line'], 2)
            self.assertEqual(super_a[1]['text'], 'INTERVENE')
            self.assertEqual(super_a[2]['line'], 3)
            self.assertEqual(super_a[2]['text'], 'EVENT TWO\nEVENT TWO (dup)')

        finally:
            os.remove(path)


if __name__ == '__main__':
    unittest.main(verbosity=2)
