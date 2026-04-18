from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest


class InstallerBuildArgsTests(unittest.TestCase):
    def test_build_pyinstaller_args_contains_required_paths_and_hidden_imports(self):
        repo_root = Path(__file__).resolve().parents[2]
        python_dir = repo_root / "python"
        build_root = python_dir / "build" / "csv_to_json"

        installer_module_path = python_dir / "installer" / "build_csv_to_json.py"
        spec = importlib.util.spec_from_file_location(
            "build_csv_to_json", installer_module_path
        )
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)  # type: ignore[union-attr]

        args = module.build_pyinstaller_args(
            source_file=python_dir / "csv_to_json.py",
            repo_root=repo_root,
            dist_dir=build_root / "dist",
            work_dir=build_root / "work",
            spec_dir=build_root / "spec",
            media_tool=python_dir / "tools" / "media_converter.py",
            config_tool=python_dir / "tools" / "config_converter.py",
            runtime_hook=build_root / "work" / "runtime_hook_converter_version.py",
        )

        self.assertIn("--onefile", args)
        self.assertIn(f"--distpath={build_root / 'dist'}", args)
        self.assertIn(f"--workpath={build_root / 'work'}", args)
        self.assertIn(f"--specpath={build_root / 'spec'}", args)
        self.assertIn(
            f"--add-data={python_dir / 'tools' / 'media_converter.py'}:tools", args
        )
        self.assertIn(
            f"--add-data={python_dir / 'tools' / 'config_converter.py'}:tools", args
        )
        self.assertIn("--hidden-import=openpyxl", args)
        self.assertIn("--hidden-import=python.tools.media_converter", args)
        self.assertIn("--hidden-import=python.tools.config_converter", args)
        self.assertIn(
            f"--runtime-hook={build_root / 'work' / 'runtime_hook_converter_version.py'}",
            args,
        )


if __name__ == "__main__":
    unittest.main()
