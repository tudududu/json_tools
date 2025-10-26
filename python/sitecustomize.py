"""Coverage startup hook for subprocesses.

If COVERAGE_PROCESS_START is set, this will trigger coverage collection
when the interpreter starts. Placing this file in the 'python/' package
ensures it's on sys.path when running scripts from that folder.
"""
import os

if os.getenv("COVERAGE_PROCESS_START"):
    try:
        import coverage
        coverage.process_startup()
    except Exception:
        # Don't break subprocess startup if coverage isn't available.
        pass
