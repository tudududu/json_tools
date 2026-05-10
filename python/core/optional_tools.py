from __future__ import annotations

import importlib
import os
import sys
import types
from typing import Any, Callable, Optional, Tuple


def resolve_tools_path(module_name: str, script_file_path: str) -> str:
    meipass = getattr(sys, "_MEIPASS", None)
    if getattr(sys, "frozen", False) and isinstance(meipass, str):
        bundled_path = os.path.join(meipass, "python", "tools", f"{module_name}.py")
        if os.path.exists(bundled_path):
            return bundled_path
        alt_bundled_path = os.path.join(meipass, "tools", f"{module_name}.py")
        if os.path.exists(alt_bundled_path):
            return alt_bundled_path
        return bundled_path
    return os.path.join(
        os.path.dirname(os.path.abspath(script_file_path)), "tools", f"{module_name}.py"
    )


def load_media_tools(
    script_file_path: str,
) -> Tuple[
    Optional[Callable[..., Any]],
    Optional[Callable[..., Any]],
    Optional[Callable[..., Any]],
]:
    try:
        from python.tools.media_converter import (
            read_csv,
            group_by_country_language,
            convert_rows,
        )

        return read_csv, group_by_country_language, convert_rows
    except Exception:
        try:
            import importlib.util as _ilu

            tools_path = resolve_tools_path("media_converter", script_file_path)
            spec = _ilu.spec_from_file_location("_media_converter", tools_path)
            if spec and spec.loader:
                mod = _ilu.module_from_spec(spec)
                spec.loader.exec_module(mod)  # type: ignore[arg-type]
                return (
                    getattr(mod, "read_csv", None),
                    getattr(mod, "group_by_country_language", None),
                    getattr(mod, "convert_rows", None),
                )
        except Exception:
            pass
    return None, None, None


def load_layer_config_converter(
    script_file_path: str,
) -> Optional[Callable[..., Any]]:
    try:
        from python.tools.config_converter import convert_workbook

        return convert_workbook
    except Exception:
        # Frozen builds can expose modules under alternate package roots.
        for module_name in ("tools.config_converter", "config_converter"):
            try:
                mod = importlib.import_module(module_name)
                convert_workbook = getattr(mod, "convert_workbook", None)
                if callable(convert_workbook):
                    return convert_workbook
            except Exception:
                pass

        try:
            import importlib.util as _ilu

            tools_path = resolve_tools_path("config_converter", script_file_path)
            tools_dir = os.path.dirname(tools_path)
            if not os.path.isfile(tools_path):
                return None

            # Load as a synthetic package so relative imports like
            # "from .sheet_names_config import ..." continue to work.
            pkg_name = "_embedded_tools"
            if pkg_name not in sys.modules:
                pkg = types.ModuleType(pkg_name)
                pkg.__path__ = [tools_dir]  # type: ignore[attr-defined]
                sys.modules[pkg_name] = pkg

            module_name = f"{pkg_name}.config_converter"
            spec = _ilu.spec_from_file_location(module_name, tools_path)
            if spec and spec.loader:
                mod = _ilu.module_from_spec(spec)
                sys.modules[module_name] = mod
                spec.loader.exec_module(mod)  # type: ignore[arg-type]
                convert_workbook = getattr(mod, "convert_workbook", None)
                if callable(convert_workbook):
                    return convert_workbook
        except Exception:
            pass
    return None
