import os
import sys
import tempfile
import unittest
import json

HERE = os.path.dirname(os.path.abspath(__file__))
PYTHON_DIR = os.path.abspath(os.path.join(HERE, '..'))
if PYTHON_DIR not in sys.path:
    sys.path.insert(0, PYTHON_DIR)

import csv_to_json as mod


class SuperATests(unittest.TestCase):
    """Tests for super_A and super_A_flag functionality."""
    
    def test_super_a_basic_parsing(self):
        """Test that super_A rows are parsed correctly."""
        csv_content = (
            'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL\n'
            'meta_global;;;;;briefVersion;Y;ALL;1;\n'
            'meta_global;;;;;fps;Y;ALL;25;\n'
            'meta_local;VID_A;;;;title;N;ALL;TestVideo;\n'
            'sub;VID_A;1;00:00:00:00;00:00:02:00;;;;;Hello;\n'
            'super_a;VID_A;1;00:00:01:00;00:00:03:00;;;;;Super A Text;\n'
            'super_a;VID_A;2;00:00:03:00;00:00:05:00;;;;;Super A Text 2;\n'
        )
        
        with tempfile.NamedTemporaryFile('w+', delete=False, suffix='.csv', encoding='utf-8') as f:
            f.write(csv_content)
            path = f.name
        
        try:
            out = mod.convert_csv_to_json(path, fps=25, no_orientation=False)
            
            # Check structure
            self.assertIn('byCountry', out)
            self.assertIn('GBL', out['byCountry'])
            
            gbl = out['byCountry']['GBL']
            self.assertIn('videos', gbl)
            
            # Should have 2 videos (landscape and portrait)
            self.assertEqual(len(gbl['videos']), 2)
            
            # Check landscape video
            landscape_video = next((v for v in gbl['videos'] if v['videoId'].endswith('_landscape')), None)
            self.assertIsNotNone(landscape_video)
            self.assertIn('super_A', landscape_video)
            
            # Check super_A content
            super_a = landscape_video['super_A']
            self.assertEqual(len(super_a), 2)
            self.assertEqual(super_a[0]['line'], 1)
            self.assertEqual(super_a[0]['text'], 'Super A Text')
            self.assertAlmostEqual(super_a[0]['in'], 1.0)
            self.assertAlmostEqual(super_a[0]['out'], 3.0)
            
            self.assertEqual(super_a[1]['line'], 2)
            self.assertEqual(super_a[1]['text'], 'Super A Text 2')
            
            # Check that subtitles are still there
            self.assertIn('subtitles', landscape_video)
            self.assertEqual(len(landscape_video['subtitles']), 1)
            
        finally:
            os.remove(path)
    
    def test_super_a_flag_meta_global(self):
        """Test that super_A_flag works in meta_global."""
        csv_content = (
            'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL\n'
            'meta_global;;;;;briefVersion;Y;ALL;1;\n'
            'meta_global;;;;;fps;Y;ALL;25;\n'
            'meta_global;;;;;super_A_flag;Y;ALL;enabled;\n'
            'meta_local;VID_A;;;;title;N;ALL;TestVideo;\n'
            'sub;VID_A;1;00:00:00:00;00:00:02:00;;;;;Hello;\n'
            'super_a;VID_A;1;00:00:01:00;00:00:03:00;;;;;Super A Text;\n'
        )
        
        with tempfile.NamedTemporaryFile('w+', delete=False, suffix='.csv', encoding='utf-8') as f:
            f.write(csv_content)
            path = f.name
        
        try:
            out = mod.convert_csv_to_json(path, fps=25)
            
            gbl = out['byCountry']['GBL']
            landscape_video = next((v for v in gbl['videos'] if v['videoId'].endswith('_landscape')), None)
            
            # Check that super_A_flag is in metadata
            self.assertIn('super_A_flag', landscape_video['metadata'])
            self.assertEqual(landscape_video['metadata']['super_A_flag'], 'enabled')
            
        finally:
            os.remove(path)
    
    def test_super_a_flag_meta_local(self):
        """Test that super_A_flag works in meta_local and overrides global."""
        csv_content = (
            'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL\n'
            'meta_global;;;;;briefVersion;Y;ALL;1;\n'
            'meta_global;;;;;fps;Y;ALL;25;\n'
            'meta_global;;;;;super_A_flag;Y;ALL;enabled;\n'
            'meta_local;VID_A;;;;super_A_flag;N;ALL;disabled;\n'
            'meta_local;VID_A;;;;title;N;ALL;TestVideo;\n'
            'sub;VID_A;1;00:00:00:00;00:00:02:00;;;;;Hello;\n'
            'super_a;VID_A;1;00:00:01:00;00:00:03:00;;;;;Super A Text;\n'
        )
        
        with tempfile.NamedTemporaryFile('w+', delete=False, suffix='.csv', encoding='utf-8') as f:
            f.write(csv_content)
            path = f.name
        
        try:
            out = mod.convert_csv_to_json(path, fps=25)
            
            gbl = out['byCountry']['GBL']
            landscape_video = next((v for v in gbl['videos'] if v['videoId'].endswith('_landscape')), None)
            
            # Check that local super_A_flag overrode global
            self.assertIn('super_A_flag', landscape_video['metadata'])
            self.assertEqual(landscape_video['metadata']['super_A_flag'], 'disabled')
            
        finally:
            os.remove(path)
    
    def test_super_a_merging(self):
        """Test that super_A rows with same line number are merged."""
        csv_content = (
            'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL\n'
            'meta_global;;;;;briefVersion;Y;ALL;1;\n'
            'meta_global;;;;;fps;Y;ALL;25;\n'
            'meta_local;VID_A;;;;title;N;ALL;TestVideo;\n'
            'super_a;VID_A;1;00:00:01:00;00:00:03:00;;;;;Line 1 part 1;\n'
            'super_a;VID_A;1;00:00:01:00;00:00:03:00;;;;;Line 1 part 2;\n'
            'super_a;VID_A;2;00:00:03:00;00:00:05:00;;;;;Line 2;\n'
        )
        
        with tempfile.NamedTemporaryFile('w+', delete=False, suffix='.csv', encoding='utf-8') as f:
            f.write(csv_content)
            path = f.name
        
        try:
            out = mod.convert_csv_to_json(path, fps=25)
            
            gbl = out['byCountry']['GBL']
            landscape_video = next((v for v in gbl['videos'] if v['videoId'].endswith('_landscape')), None)
            super_a = landscape_video['super_A']
            
            # Should have 2 items (merged)
            self.assertEqual(len(super_a), 2)
            
            # First item should have merged text
            self.assertEqual(super_a[0]['line'], 1)
            self.assertEqual(super_a[0]['text'], 'Line 1 part 1\nLine 1 part 2')
            
            # Second item unchanged
            self.assertEqual(super_a[1]['line'], 2)
            self.assertEqual(super_a[1]['text'], 'Line 2')
            
        finally:
            os.remove(path)
    
    def test_super_a_empty_array_when_no_rows(self):
        """Test that super_A is an empty array when no super_a rows exist."""
        csv_content = (
            'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL\n'
            'meta_global;;;;;briefVersion;Y;ALL;1;\n'
            'meta_global;;;;;fps;Y;ALL;25;\n'
            'meta_local;VID_A;;;;title;N;ALL;TestVideo;\n'
            'sub;VID_A;1;00:00:00:00;00:00:02:00;;;;;Hello;\n'
        )
        
        with tempfile.NamedTemporaryFile('w+', delete=False, suffix='.csv', encoding='utf-8') as f:
            f.write(csv_content)
            path = f.name
        
        try:
            out = mod.convert_csv_to_json(path, fps=25)
            
            gbl = out['byCountry']['GBL']
            landscape_video = next((v for v in gbl['videos'] if v['videoId'].endswith('_landscape')), None)
            
            # Should have empty super_A array
            self.assertIn('super_A', landscape_video)
            self.assertEqual(len(landscape_video['super_A']), 0)
            
        finally:
            os.remove(path)
    
    def test_super_a_portrait_mirroring(self):
        """Test that portrait mirrors landscape when no portrait text provided."""
        csv_content = (
            'record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL\n'
            'meta_global;;;;;briefVersion;Y;ALL;1;\n'
            'meta_global;;;;;fps;Y;ALL;25;\n'
            'meta_local;VID_A;;;;title;N;ALL;TestVideo;\n'
            'super_a;VID_A;1;00:00:01:00;00:00:03:00;;;;;Super A Landscape;\n'
        )
        
        with tempfile.NamedTemporaryFile('w+', delete=False, suffix='.csv', encoding='utf-8') as f:
            f.write(csv_content)
            path = f.name
        
        try:
            out = mod.convert_csv_to_json(path, fps=25)
            
            gbl = out['byCountry']['GBL']
            landscape_video = next((v for v in gbl['videos'] if v['videoId'].endswith('_landscape')), None)
            portrait_video = next((v for v in gbl['videos'] if v['videoId'].endswith('_portrait')), None)
            
            # Both should have same super_A content (mirrored)
            self.assertEqual(len(landscape_video['super_A']), 1)
            self.assertEqual(len(portrait_video['super_A']), 1)
            self.assertEqual(landscape_video['super_A'][0]['text'], 'Super A Landscape')
            self.assertEqual(portrait_video['super_A'][0]['text'], 'Super A Landscape')
            
        finally:
            os.remove(path)


if __name__ == '__main__':
    unittest.main(verbosity=2)
