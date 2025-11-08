#!/usr/bin/env python3
"""Consolidated test runner for csv_to_json tool.

Discovers unittest-style test_*.py modules under python/tests/ and runs them.
"""
import unittest, os, sys, subprocess, shutil, json

ROOT = os.path.dirname(os.path.abspath(__file__))
TEST_DIR = os.path.join(ROOT, 'tests')

if __name__ == '__main__':
    use_cov = os.getenv('COVERAGE') == '1'
    if use_cov:
        cov_dir = os.path.join(ROOT, 'tests', 'coverage')
        os.makedirs(cov_dir, exist_ok=True)
        # Enable subprocess coverage: point COVERAGE_PROCESS_START to the repo .coveragerc
        repo_root = os.path.dirname(os.path.dirname(ROOT))
        cov_rc = os.path.join(repo_root, '.coveragerc')
        if os.path.exists(cov_rc):
            os.environ['COVERAGE_PROCESS_START'] = cov_rc
        # Ensure our customization hooks are importable for all subprocesses
        # Prepend repo root to PYTHONPATH so usercustomize.py is found, and also ensure
        # the python/ folder stays importable when tests spawn scripts by full path.
        py_paths = [repo_root, ROOT]
        existing = os.environ.get('PYTHONPATH')
        if existing:
            os.environ['PYTHONPATH'] = os.pathsep.join(py_paths + [existing])
        else:
            os.environ['PYTHONPATH'] = os.pathsep.join(py_paths)
        # Signal tests to wrap their subprocess CLI calls under coverage
        os.environ['COVERAGE_SUBPROCESS'] = '1'
        # Run tests under coverage
        cov_cmd = [sys.executable, '-m', 'coverage', 'run', '--branch', '--source', 'python', '-m', 'unittest', 'discover', TEST_DIR, 'test_*.py']
        proc = subprocess.run(cov_cmd)
        if proc.returncode != 0:
            sys.exit(proc.returncode)
        # Combine subprocess coverage data and generate reports directly into coverage directory
        subprocess.run([sys.executable, '-m', 'coverage', 'combine'], check=False)
        subprocess.run([sys.executable, '-m', 'coverage', 'xml', '-o', os.path.join(cov_dir, 'coverage.xml')], check=False)
        # coverage json (available in recent versions) may not exist; ignore if unsupported
        subprocess.run([sys.executable, '-m', 'coverage', 'json', '-o', os.path.join(cov_dir, 'coverage.json')], check=False)
        # Generate/update badge (overwrite if it exists)
        try:
            svg_path = os.path.join(cov_dir, 'coverage.svg')
            try:
                if os.path.exists(svg_path):
                    os.remove(svg_path)
            except Exception:
                # Non-fatal: proceed and let coverage_badge try to overwrite
                pass
            # Some versions of coverage-badge require -f to overwrite; we proactively delete above
            # and still pass -o to write into our coverage directory.
            subprocess.run([sys.executable, '-m', 'coverage_badge', '-o', svg_path], check=False)
        except Exception:
            pass
        # Print summary
        subprocess.run([sys.executable, '-m', 'coverage', 'report'])
        # Exit with coverage run code (already zero if here)
        sys.exit(0)
    else:
        loader = unittest.TestLoader()
        suite = loader.discover(TEST_DIR, pattern='test_*.py')
        runner = unittest.TextTestRunner(verbosity=2)
        result = runner.run(suite)
        sys.exit(0 if result.wasSuccessful() else 1)
