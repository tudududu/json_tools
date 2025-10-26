"""Coverage startup hook for subprocesses (fallback).

This file is imported automatically by Python's site initialization if present.
When COVERAGE_PROCESS_START is set, this triggers coverage collection for any
Python process that imports usercustomize/sitecustomize early in startup.

Keeping this at the repository root makes it discoverable for most subprocess
launch patterns, complementing the copy in python/sitecustomize.py.
"""
import os

if os.getenv("COVERAGE_PROCESS_START"):
    try:
        import coverage
        coverage.process_startup()
    except Exception:
        # Don't break subprocess startup if coverage isn't available.
        pass
