from pathlib import Path
from python.tools import log_picker


def test_summary_totals_and_percentage(tmp_path):
    d = tmp_path / 'logs'
    d.mkdir()
    (d / 'a.log').write_text(
        'Timing (s) => linkData=0.3, addLayers=15.0, total=100.0\n', encoding='utf-8'
    )
    (d / 'b.log').write_text(
        'Timing (s) => addLayers=5.0, pack=5.0, ame=10.0, total=20.0\n', encoding='utf-8'
    )
    out = tmp_path / 'out.log'

    rc = log_picker.main(['--input-dir', str(d), '--output-file', str(out)])
    assert rc == 0
    text = out.read_text(encoding='utf-8')

    # Summary Totals percent
    assert '==== Summary addLayers / Totals ====' in text
    assert 'a.log: Timing (s) => addLayers=15.0 / total=100.0; 15.00%' in text
    assert 'b.log: Timing (s) => addLayers=5.0 / total=20.0; 25.00%' in text

    # Summary percentage per steps
    assert '==== Summary percentage ====' in text
    # a.log has linkData and addLayers percentages vs total
    assert 'linkData=0.30%' in text
    assert 'addLayers=15.00%' in text
    # b.log has addLayers, pack, ame
    # Order may differ; check presence
    assert 'addLayers=25.00%' in text
    assert 'pack=25.00%' in text
    assert 'ame=50.00%' in text
