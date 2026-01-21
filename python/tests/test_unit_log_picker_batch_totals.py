import tempfile, pathlib
from python.tools import log_picker

def test_batch_totals_and_theory(tmp_path):
    d = tmp_path / 'logs'
    d.mkdir()
    # two pipeline runs with totals 10.0 and 20.5 seconds
    (d / 'pipeline_run_20250101_000000.log').write_text(
        'Timing (s) => addLayers=3.0, total=10.0\n', encoding='utf-8'
    )
    (d / 'pipeline_run_20250101_000100.log').write_text(
        'Timing (s) => addLayers=5.0, total=20.5\n', encoding='utf-8'
    )
    # plus a non-pipeline file ignored by pipeline run counters
    (d / 'other.log').write_text('Timing (s) => total=99.0\n', encoding='utf-8')

    out = tmp_path / 'out.log'
    rc = log_picker.main(['--input-dir', str(d), '--output-file', str(out)])
    assert rc == 0
    txt = out.read_text(encoding='utf-8')
    assert '==== Summary Counts ====' in txt
    # Pipeline runs counted
    assert 'TOTAL_PIPELINE_RUN_LOGS: 2' in txt
    # Real total = 10.0 + 20.5 = 30.5 -> HHMMSS 00:00:30
    assert 'Batch Total Real: 30.50 s, HHMMSS: 00:00:30' in txt
    # Theory = first total (10.0) * 2 = 20.0 seconds -> HHMMSS 00:00:20
    assert 'Batch Total Theory: 20.00 s, HHMMSS: 00:00:20' in txt
