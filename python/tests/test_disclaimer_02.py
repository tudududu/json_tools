#!/usr/bin/env python3
"""
Unit tests for disclaimer_02 feature (CSV to JSON 185).
Tests parsing, merging, portrait fallback, and local override for disclaimer_02 key.
"""

import os
import sys
import unittest
import tempfile

# Add parent dir to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
import csv_to_json as mod


def tmp_csv(content: str) -> str:
    """Write CSV content to temp file and return path."""
    fd, path = tempfile.mkstemp(suffix=".csv", text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
    except Exception:
        os.close(fd)
        raise
    return path


class Disclaimer02Tests(unittest.TestCase):
    """Tests for disclaimer_02 key"""

    def test_basic_disclaimer_02_parsing(self):
        """Test that disclaimer_02 rows are parsed and output correctly"""
        csv_content = (
            'record_type,video_id,line,start,end,key,is_global,country_scope,metadata,GBL\n'
            'disclaimer_02,,1,00:00:00:00,00:00:05:00,,,,,Disclaimer_02 Line 1\n'
            'sub,VID_A,1,00:00:00:00,00:00:01:00;;;;;;;;;hello\n'
        )
        path = tmp_csv(csv_content)
        try:
            out = mod.convert_csv_to_json(path, fps=25)
        finally:
            os.remove(path)

        self.assertIn('byCountry', out)
        node = out['byCountry']['GBL']
        self.assertIn('disclaimer_02', node)
        self.assertIn('landscape', node['disclaimer_02'])
        self.assertEqual(len(node['disclaimer_02']['landscape']), 1)
        self.assertEqual(node['disclaimer_02']['landscape'][0], 'Disclaimer_02 Line 1')

    def test_disclaimer_02_continuation_merging(self):
        """Test that disclaimer_02 continuation lines merge with newline"""
        csv_content = (
            'record_type,video_id,line,start,end,key,is_global,country_scope,metadata,GBL\n'
            'disclaimer_02,,1,00:00:00:00,00:00:05:00,,,,,First line\n'
            'disclaimer_02,,1,,,,,,,Second line\n'
            'sub,VID_A,1,00:00:00:00,00:00:01:00,,,,,hello\n'
        )
        path = tmp_csv(csv_content)
        try:
            out = mod.convert_csv_to_json(path, fps=25)
        finally:
            os.remove(path)

        node = out['byCountry']['GBL']
        disc_02_land = node['disclaimer_02']['landscape']
        self.assertEqual(len(disc_02_land), 1)
        self.assertIn('\n', disc_02_land[0])
        self.assertIn('First line', disc_02_land[0])
        self.assertIn('Second line', disc_02_land[0])

    def test_disclaimer_02_no_merge_flag(self):
        """Test that --no-merge-disclaimer-02 disables merging"""
        csv_content = (
            'record_type,video_id,line,start,end,key,is_global,country_scope,metadata,GBL\n'
            'disclaimer_02,,1,00:00:00:00,00:00:05:00,,,,,First line\n'
            'disclaimer_02,,1,,,,,,,Second line\n'
            'sub,VID_A,1,00:00:00:00,00:00:01:00,,,,,hello\n'
        )
        path = tmp_csv(csv_content)
        try:
            out = mod.convert_csv_to_json(path, fps=25, merge_disclaimer_02=False)
        finally:
            os.remove(path)

        node = out['byCountry']['GBL']
        disc_02_land = node['disclaimer_02']['landscape']
        # With merge disabled, should have 2 separate blocks
        self.assertEqual(len(disc_02_land), 2)

    def test_disclaimer_02_portrait_fallback_to_landscape_local(self):
        """Test portrait local fallback to landscape local when override flag enabled"""
        csv_content = (
            'record_type,video_id,line,start,end,key,is_global,country_scope,metadata,GBL,GBL\n'
            'disclaimer_02,VID_B,1,00:00:00:00,00:00:05:00,,,,,L_DISC_02,\n'
            'sub,VID_B,1,00:00:00:00,00:00:01:00,,,,,x,y\n'
        )
        path = tmp_csv(csv_content)
        try:
            out = mod.convert_csv_to_json(path, fps=25, prefer_local_claim_disclaimer=True)
        finally:
            os.remove(path)

        node = out['byCountry']['GBL']
        v_port = next(v for v in node['videos'] if v['videoId'].endswith('_portrait'))
        v_land = next(v for v in node['videos'] if v['videoId'].endswith('_landscape'))
        # Landscape uses its local text
        self.assertEqual(v_land['disclaimer_02'][0]['text'], 'L_DISC_02')
        # Portrait should inherit landscape local when portrait empty
        self.assertEqual(v_port['disclaimer_02'][0]['text'], 'L_DISC_02')

    def test_disclaimer_02_per_video_override(self):
        """Test per-video disclaimer_02 local override takes precedence"""
        csv_content = (
            'record_type,video_id,line,start,end,key,is_global,country_scope,metadata,GBL\n'
            'disclaimer_02,,1,00:00:00:00,00:00:05:00,,,,,Global Disclaimer_02\n'
            'disclaimer_02,VID_C,1,00:00:00:00,00:00:05:00,,,,,Local Disclaimer_02\n'
            'sub,VID_C,1,00:00:00:00,00:00:01:00,,,,,hello\n'
        )
        path = tmp_csv(csv_content)
        try:
            out = mod.convert_csv_to_json(path, fps=25, prefer_local_claim_disclaimer=True)
        finally:
            os.remove(path)

        node = out['byCountry']['GBL']
        v_land = next(v for v in node['videos'] if v['videoId'].endswith('_landscape'))
        # Per-video local should override global
        self.assertEqual(v_land['disclaimer_02'][0]['text'], 'Local Disclaimer_02')

    def test_disclaimer_02_flag_meta_local(self):
        """Test disclaimer_02_flag can be set via meta_local"""
        csv_content = (
            'record_type,video_id,line,start,end,key,is_global,country_scope,metadata,GBL\n'
            'meta_local,VID_D,,,,disclaimer_02_flag,,,,Y\n'
            'sub,VID_D,1,00:00:00:00,00:00:01:00,,,,,hello\n'
        )
        path = tmp_csv(csv_content)
        try:
            out = mod.convert_csv_to_json(path, fps=25)
        finally:
            os.remove(path)

        node = out['byCountry']['GBL']
        v_land = next(v for v in node['videos'] if v['videoId'].endswith('_landscape'))
        # Flag should appear in metadata
        self.assertEqual(v_land['metadata'].get('disclaimer_02_flag'), 'Y')

    def test_disclaimer_02_empty_defaults_to_empty_string(self):
        """Test disclaimer_02 defaults to empty string array when no rows"""
        csv_content = (
            'record_type,video_id,line,start,end,key,is_global,country_scope,metadata,GBL\n'
            'sub,VID_E,1,00:00:00:00,00:00:01:00,,,,,hello\n'
        )
        path = tmp_csv(csv_content)
        try:
            out = mod.convert_csv_to_json(path, fps=25)
        finally:
            os.remove(path)

        node = out['byCountry']['GBL']
        self.assertIn('disclaimer_02', node)
        # Should default to [""] like disclaimer
        self.assertEqual(node['disclaimer_02']['landscape'], [''])

    def test_disclaimer_02_in_per_video_output(self):
        """Test disclaimer_02 appears in per-video JSON structure"""
        csv_content = (
            'record_type,video_id,line,start,end,key,is_global,country_scope,metadata,GBL\n'
            'disclaimer_02,VID_F,1,00:00:00:00,00:00:05:00,,,,,Video Disclaimer_02\n'
            'sub,VID_F,1,00:00:00:00,00:00:01:00,,,,,hello\n'
        )
        path = tmp_csv(csv_content)
        try:
            out = mod.convert_csv_to_json(path, fps=25)
        finally:
            os.remove(path)

        node = out['byCountry']['GBL']
        v_land = next(v for v in node['videos'] if v['videoId'].endswith('_landscape'))
        # disclaimer_02 should be a key in video object
        self.assertIn('disclaimer_02', v_land)
        self.assertEqual(len(v_land['disclaimer_02']), 1)
        self.assertEqual(v_land['disclaimer_02'][0]['text'], 'Video Disclaimer_02')


if __name__ == "__main__":
    unittest.main()
