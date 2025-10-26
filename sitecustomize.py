"""Coverage startup hook for subprocesses (preferred).

This overrides any global sitecustomize by being on PYTHONPATH early. When
the COVERAGE_PROCESS_START environment variable is set, this triggers coverage
collection in subprocesses before application code runs.
"""
import os

if os.getenv("COVERAGE_PROCESS_START"):
    try:
        import coverage
        coverage.process_startup()
    except Exception:
        # Don't break subprocess startup if coverage isn't available.
        pass
