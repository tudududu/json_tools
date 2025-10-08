#!/usr/bin/env python3
"""Consolidated test runner for csv_to_subtitles_json tool.

Discovers unittest-style test_*.py modules under python/tests/ and runs them.
"""
import unittest, os, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
TEST_DIR = os.path.join(ROOT, 'tests')

if __name__ == '__main__':
    loader = unittest.TestLoader()
    suite = loader.discover(TEST_DIR, pattern='test_*.py')
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
