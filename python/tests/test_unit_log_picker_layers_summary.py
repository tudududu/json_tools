from python.aux import log_picker


def test_layers_short_summary(tmp_path):
    d = tmp_path / 'logs'
    d.mkdir()
    (d / 'a.log').write_text(
        'Counts => created=1, layersAddedTotal=10\nTiming (s) => addLayers=2.5, total=3.0\n', encoding='utf-8'
    )
    (d / 'b.log').write_text(
        'RunId=XYZ\nTiming (s) => addLayers=7.5, total=8.0\n', encoding='utf-8'
    )
    (d / 'c.log').write_text(
        'Counts => created=2, something=else\n', encoding='utf-8'
    )
    out = tmp_path / 'out.log'
    rc = log_picker.main(['--input-dir', str(d), '--output-file', str(out)])
    assert rc == 0
    txt = out.read_text(encoding='utf-8')
    assert '==== Short Summary ====' in txt
    # a.log should have both values
    assert 'a.log: Counts => layersAddedTotal=10 ; Timing (s) => addLayers=2.5' in txt
    # b.log missing Counts value, has Timing value
    assert 'b.log: Counts => layersAddedTotal=- ; Timing (s) => addLayers=7.5' in txt
    # c.log missing both specific keys -> dashes
    assert 'c.log: Counts => layersAddedTotal=- ; Timing (s) => addLayers=-' in txt
