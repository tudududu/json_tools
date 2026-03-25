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
import importlib.util

ROOT = os.path.dirname(os.path.abspath(__file__))
TEST_DIR = os.path.join(ROOT, "tests")


def run():
    # Allow enabling coverage either via env var COVERAGE=1 or via --coverage flag
    argv = list(sys.argv[1:])
    use_cov_flag = False
    if "--coverage" in argv:
        use_cov_flag = True
        argv.remove("--coverage")
    use_cov = use_cov_flag or (os.getenv("COVERAGE") == "1")

    # Build pytest command
    cmd = [sys.executable, "-m", "pytest", "-q", TEST_DIR]

    cov_dir = os.path.join(TEST_DIR, "coverage")
    if use_cov:
        os.makedirs(cov_dir, exist_ok=True)
        # pytest-cov will handle subprocess coverage automatically
        cmd += [
            "--cov=python",
            "--cov-branch",
            "--cov-report=term-missing",
            f"--cov-report=xml:{os.path.join(cov_dir, 'coverage.xml')}",
        ]

    # Execute pytest
    try:
        rc = subprocess.call(cmd)
    except FileNotFoundError:
        print(
            "pytest not found. Please install pytest (and pytest-cov for coverage) e.g. 'pip install pytest pytest-cov'.",
            file=sys.stderr,
        )
        return 2

    # On success with coverage, refresh badge (best effort)
    if rc == 0 and use_cov:
        svg_path = os.path.join(cov_dir, "coverage.svg")
        # pytest-cov already handles coverage data merging for this run, so avoid
        # an extra manual combine pass that can print noisy "No data to combine".

        # coverage-badge depends on pkg_resources (from setuptools). Skip silently
        # if either module is unavailable in the current venv.
        has_badge = importlib.util.find_spec("coverage_badge") is not None
        has_pkg_resources = importlib.util.find_spec("pkg_resources") is not None
        if has_badge and has_pkg_resources:
            try:
                badge_proc = subprocess.run(
                    [sys.executable, "-m", "coverage_badge", "-o", svg_path, "-f"],
                    check=False,
                    capture_output=True,
                    text=True,
                )
                if badge_proc.returncode != 0 and badge_proc.stderr:
                    print(
                        "coverage-badge skipped: "
                        + badge_proc.stderr.strip().splitlines()[-1],
                        file=sys.stderr,
                    )
            except Exception:
                # Badge generation is best-effort; do not fail the build on this.
                pass

    return rc


if __name__ == "__main__":
    sys.exit(run())
