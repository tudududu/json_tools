#!/usr/bin/env python3
"""Merge config into preset entrypoint."""

from __future__ import annotations

try:
    from python.tools.merge_config_into_preset import main as _tool_main
except ModuleNotFoundError:
    from tools.merge_config_into_preset import main as _tool_main


__all__ = ["main"]


def main() -> int:
    _tool_main()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
