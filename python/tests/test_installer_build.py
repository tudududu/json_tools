from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class InstallerBuildArgsTests(unittest.TestCase):
    def test_build_pyinstaller_args_contains_required_paths_and_hidden_imports(self):
        repo_root = Path(__file__).resolve().parents[2]
        python_dir = repo_root / "python"
        build_root = python_dir / "build" / "json_converter"

        installer_module_path = python_dir / "installer" / "build_json_converter.py"
        spec = importlib.util.spec_from_file_location(
            "build_json_converter", installer_module_path
        )
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)  # type: ignore[union-attr]

        args = module.build_pyinstaller_args(
            source_file=python_dir / "json_converter.py",
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


@unittest.skipUnless(
    os.getenv("RUN_FROZEN_SMOKE") == "1",
    "Set RUN_FROZEN_SMOKE=1 to run frozen binary smoke test.",
)
@unittest.skipUnless(
    importlib.util.find_spec("PyInstaller") is not None,
    "PyInstaller is not installed in the current environment.",
)
class InstallerFrozenSmokeTests(unittest.TestCase):
    def test_build_and_run_frozen_converter(self):
        repo_root = Path(__file__).resolve().parents[2]
        python_dir = repo_root / "python"
        installer_script = python_dir / "installer" / "build_json_converter.py"
        converter_version = "9.9.9-smoke"

        build_result = subprocess.run(
            [
                sys.executable,
                str(installer_script),
                "--converter-version",
                converter_version,
            ],
            cwd=str(repo_root),
            capture_output=True,
            text=True,
        )
        self.assertEqual(
            build_result.returncode,
            0,
            msg=(
                "Frozen build failed\n"
                f"stdout:\n{build_result.stdout}\n"
                f"stderr:\n{build_result.stderr}"
            ),
        )

        exe_name = "json_converter.exe" if os.name == "nt" else "json_converter"
        executable_path = python_dir / "build" / "json_converter" / "dist" / exe_name
        self.assertTrue(
            executable_path.exists(),
            msg=f"Expected executable not found: {executable_path}",
        )

        csv_content = (
            "record_type;video_id;line;start;end;key;is_global;country_scope;metadata;GBL;FRA;GBL;FRA\n"
            "meta_global;;;;;briefVersion;Y;ALL;53;;;;\n"
            "meta_global;;;;;fps;Y;ALL;25;;;;\n"
            "sub;V;1;00:00:00:00;00:00:01:00;;;;;;;;Hello;\n"
        )
        with tempfile.TemporaryDirectory() as td:
            input_path = Path(td) / "smoke_input.csv"
            output_path = Path(td) / "smoke_output.json"
            input_path.write_text(csv_content, encoding="utf-8")

            run_result = subprocess.run(
                [str(executable_path), str(input_path), str(output_path)],
                cwd=str(repo_root),
                capture_output=True,
                text=True,
            )
            self.assertEqual(
                run_result.returncode,
                0,
                msg=(
                    "Frozen smoke run failed\n"
                    f"stdout:\n{run_result.stdout}\n"
                    f"stderr:\n{run_result.stderr}"
                ),
            )
            self.assertTrue(
                output_path.exists(), "Frozen run did not write output JSON"
            )

            with output_path.open("r", encoding="utf-8") as f:
                payload = json.load(f)
            metadata_global = payload.get("metadataGlobal") or payload.get("metadata")
            self.assertIsInstance(metadata_global, dict)
            self.assertEqual(metadata_global.get("converterVersion"), converter_version)


if __name__ == "__main__":
    unittest.main()
