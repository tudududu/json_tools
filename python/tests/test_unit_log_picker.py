import pathlib
import shutil
from python.aux import log_picker


def test_log_picker_custom_prefix_and_counts(tmp_path):
    # Arrange: create temp log directory with sample logs
    log_dir = tmp_path / "logs"
    log_dir.mkdir()
    (log_dir / "one.log").write_text(
        "RunId=AAA\nUnrelated line\nMYCUSTOM value here\n", encoding="utf-8"
    )
    (log_dir / "two.log").write_text(
        "Pipeline complete.\nTiming (s) => total=1.23\nOther line\n", encoding="utf-8"
    )
    (log_dir / "empty.log").write_text(
        "Nothing to see here\n", encoding="utf-8"
    )

    # Output inside tmp_path to avoid polluting repo log directory
    out_file = tmp_path / "summary.log"

    # Act: run main with custom prefix
    rc = log_picker.main([
        "--input-dir", str(log_dir),
        "--output-file", str(out_file),
        "--prefix", "MYCUSTOM",
    ])

    assert rc == 0, "Script should exit with success"
    assert out_file.is_file(), "Output file should be created"
    content = out_file.read_text(encoding="utf-8")

    # Assert: custom prefix line is present
    assert "MYCUSTOM value here" in content
    # Counts summary section present
    assert "==== Summary Counts ====" in content
    # Per-file counts: one.log should have 2 (RunId + custom), two.log should have 2, empty.log should have 0
    assert "one.log: 2" in content
    assert "two.log: 2" in content
    assert "empty.log: 0" in content
    # Total should equal 4
    assert "TOTAL_MATCHED_LINES: 4" in content
