"""Pytest configuration to ensure subprocess coverage is captured locally.

- Ensures repo root and python/ are on PYTHONPATH so root sitecustomize.py loads.
- Sets COVERAGE_PROCESS_START to repo .coveragerc when present.
- Signals tests to wrap CLI subprocesses under coverage (COVERAGE_SUBPROCESS=1).
- After tests, combines any parallel data files and prints a final coverage summary.

This makes a plain `pytest --cov=python ...` produce non-zero coverage for
code executed in child processes.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
import subprocess


def _ensure_env():
    here = Path(__file__).resolve()
    repo_root = here.parents[2]
    python_dir = repo_root / 'python'
    # COVERAGE config for subprocess auto-start via sitecustomize/usercustomize
    cov_rc = repo_root / '.coveragerc'
    if cov_rc.exists():
        os.environ.setdefault('COVERAGE_PROCESS_START', str(cov_rc))
    # Ensure our root sitecustomize.py is importable before system one
    paths = [str(repo_root), str(python_dir)]
    env_pp = os.environ.get('PYTHONPATH')
    if env_pp:
        os.environ['PYTHONPATH'] = os.pathsep.join(paths + [env_pp])
    else:
        os.environ['PYTHONPATH'] = os.pathsep.join(paths)
    # Also fix sys.path for current pytest process
    for p in reversed(paths):
        if p not in sys.path:
            sys.path.insert(0, p)
    # Instruct tests to wrap CLI subprocesses with coverage run -p
    os.environ.setdefault('COVERAGE_SUBPROCESS', '1')


_ensure_env()


def pytest_sessionfinish(session, exitstatus):  # type: ignore[override]
    """After pytest completes, combine any per-process data and show a summary.

    This helps when pytest-cov doesn't pick up the child .coverage.* files by itself.
    """
    try:
        # Combine in the workspace root; ignore failures and suppress noise.
        subprocess.run([sys.executable, '-m', 'coverage', 'combine'], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass
