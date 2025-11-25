#!/usr/bin/env python3
import csv_to_json as mod
import tempfile
import os
import json

csv_content = '''record_type,video_id,line,start,end,key,is_global,country_scope,metadata,GBL
meta_local,VID_D,,,disclaimer_02_flag,,,,,Y
sub,VID_D,1,00:00:00:00,00:00:01:00,,,,,hello
'''

fd, path = tempfile.mkstemp(suffix=".csv", text=True)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(csv_content)
except Exception:
    os.close(fd)
    raise

try:
    out = mod.convert_csv_to_json(path, fps=25)
    print(json.dumps(out, indent=2))
    node = out['byCountry']['GBL']
    v_land = next(v for v in node['videos'] if v['videoId'].endswith('_landscape'))
    print(f"\nLandscape metadata: {v_land['metadata']}")
    print(f"disclaimer_02_flag value: {v_land['metadata'].get('disclaimer_02_flag')}")
finally:
    os.remove(path)
