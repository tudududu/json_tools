from python.aux import log_picker
from pathlib import Path

def test_log_picker_regex_and_header(tmp_path):
    logs = tmp_path / "logs"
    logs.mkdir()
    (logs / "x.log").write_text("HELLO one\nnope\nbye\n", encoding="utf-8")
    (logs / "y.log").write_text("greeting: HELLO two\nTiming (s) => 0.1\n", encoding="utf-8")

    out = tmp_path / "out.log"

    rc = log_picker.main([
        "--input-dir", str(logs),
        "--output-file", str(out),
        "--regex", r"^HELLO",
        "--regex", r"greeting: HELLO",
    ])
    assert rc == 0

    txt = out.read_text(encoding="utf-8")
    # Header
    assert "==== Log Picker Summary ====" in txt
    assert "Input Directory:" in txt
    assert "Timestamp:" in txt

    # Regex hits
    assert "HELLO one" in txt
    assert "greeting: HELLO two" in txt

    # Counts should reflect 1 hit in each file + another base prefix match from y.log (Timing)
    # So x.log:1, y.log:2, total 3
    assert "x.log: 1" in txt
    assert "y.log: 2" in txt
    assert "TOTAL_MATCHED_LINES: 3" in txt
