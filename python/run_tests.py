#!/usr/bin/env python3
"""Unified pytest-based test runner for the csv_to_json tool.

This wrapper delegates to pytest for discovery/execution and optionally enables
coverage collection via pytest-cov when COVERAGE=1 is set in the environment.
Outputs:
- Normal run: standard pytest output, exit code mirrors test success.
- COVERAGE=1: generates XML report at python/tests/coverage/coverage.xml and
  updates the SVG badge at python/tests/coverage/coverage.svg.
"""
import os
import sys
import subprocess

ROOT = os.path.dirname(os.path.abspath(__file__))
TEST_DIR = os.path.join(ROOT, 'tests')


def run():
    use_cov = os.getenv('COVERAGE') == '1'

    # Build pytest command
    cmd = [sys.executable, '-m', 'pytest', '-q', TEST_DIR]

    cov_dir = os.path.join(TEST_DIR, 'coverage')
    if use_cov:
        os.makedirs(cov_dir, exist_ok=True)
        # pytest-cov will handle subprocess coverage automatically
        cmd += [
            '--cov=python',
            '--cov-branch',
            f'--cov-report=term-missing',
            f'--cov-report=xml:{os.path.join(cov_dir, "coverage.xml")}',
        ]

    # Execute pytest
    try:
        rc = subprocess.call(cmd)
    except FileNotFoundError:
        print("pytest not found. Please install pytest (and pytest-cov for coverage) e.g. 'pip install pytest pytest-cov'.", file=sys.stderr)
        return 2

    # On success with coverage, refresh badge
    if rc == 0 and use_cov:
        svg_path = os.path.join(cov_dir, 'coverage.svg')
        try:
            # coverage-badge reads the .coverage data produced by pytest-cov
            subprocess.call([sys.executable, '-m', 'coverage_badge', '-o', svg_path, '-f'])
        except Exception:
            # Badge generation is best-effort; do not fail the build on this
            pass

    return rc


if __name__ == '__main__':
    sys.exit(run())
