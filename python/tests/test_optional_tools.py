from __future__ import annotations

import builtins
import importlib
from pathlib import Path

from python.core.optional_tools import load_layer_config_converter


def test_load_layer_config_converter_fallback_file_loader(monkeypatch):
    """Fallback loader should still return convert_workbook when primary imports fail."""
    original_import = builtins.__import__

    def guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
        if name == "python.tools.config_converter":
            raise ModuleNotFoundError("blocked for fallback test")
        return original_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr(builtins, "__import__", guarded_import)

    original_import_module = importlib.import_module

    def guarded_import_module(name, package=None):
        if name in {"tools.config_converter", "config_converter"}:
            raise ModuleNotFoundError("blocked for file fallback test")
        return original_import_module(name, package)

    monkeypatch.setattr(importlib, "import_module", guarded_import_module)

    script_path = Path(__file__).resolve().parents[1] / "json_converter.py"
    converter = load_layer_config_converter(str(script_path))

    assert callable(converter)


def test_load_layer_config_converter_missing_file_returns_none(monkeypatch):
    """Missing bundled/source converter file should gracefully return None."""
    original_import = builtins.__import__

    def guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
        if name == "python.tools.config_converter":
            raise ModuleNotFoundError("blocked")
        return original_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr(builtins, "__import__", guarded_import)

    original_import_module = importlib.import_module

    def guarded_import_module(name, package=None):
        if name in {"tools.config_converter", "config_converter"}:
            raise ModuleNotFoundError("blocked")
        return original_import_module(name, package)

    monkeypatch.setattr(importlib, "import_module", guarded_import_module)

    converter = load_layer_config_converter("/tmp/does/not/exist/json_converter.py")
    assert converter is None
