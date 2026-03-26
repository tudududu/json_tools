"""Pytest configuration to ensure subprocess coverage is captured locally.

- Ensures repo root and python/ are on PYTHONPATH so root sitecustomize.py loads.
- Sets COVERAGE_PROCESS_START to repo .coveragerc when present.
- Leaves CLI subprocess wrapping opt-in via COVERAGE_SUBPROCESS=1.
- After tests, combines any parallel data files and prints a final coverage summary.

This makes a plain `pytest --cov=python ...` produce non-zero coverage for
code executed in child processes.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
import subprocess
import warnings

# coverage.py can emit this on some Python/runner combinations (notably when
# collecting coverage via IDE test adapters). It is non-fatal and noisy.
warnings.filterwarnings(
    "ignore",
    message=r"unclosed database in <sqlite3\.Connection object at .*>",
    category=ResourceWarning,
)
warnings.filterwarnings(
    "ignore",
    message=r".*unclosed database.*sqlite3\.Connection.*",
    category=ResourceWarning,
)
warnings.filterwarnings(
    "ignore",
    category=ResourceWarning,
    module=r"coverage(\..*)?",
)


def _ensure_env():
    here = Path(__file__).resolve()
    repo_root = here.parents[2]
    python_dir = repo_root / "python"
    # COVERAGE config for subprocess auto-start via sitecustomize/usercustomize
    cov_rc = repo_root / ".coveragerc"
    if cov_rc.exists():
        os.environ.setdefault("COVERAGE_PROCESS_START", str(cov_rc))
    # Ensure our root sitecustomize.py is importable before system one
    paths = [str(repo_root), str(python_dir)]
    env_pp = os.environ.get("PYTHONPATH")
    if env_pp:
        os.environ["PYTHONPATH"] = os.pathsep.join(paths + [env_pp])
    else:
        os.environ["PYTHONPATH"] = os.pathsep.join(paths)
    # Keep subprocess wrapping opt-in; some runners already provide subprocess
    # coverage via COVERAGE_PROCESS_START + sitecustomize.


_ensure_env()


def pytest_sessionfinish(session, exitstatus):  # type: ignore[override]
    """After pytest completes, combine any per-process data and show a summary.

    This helps when pytest-cov doesn't pick up the child .coverage.* files by itself.
    """
    try:
        # Combine in the workspace root; ignore failures and suppress noise.
        subprocess.run(
            [sys.executable, "-m", "coverage", "combine"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass
