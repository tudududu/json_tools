#!/usr/bin/env python3
import csv_to_json as mod
import tempfile
import os

csv_content = '''record_type,video_id,line,start,end,key,is_global,country_scope,metadata,GBL
meta_local,VID_D,,,disclaimer_02_flag,,,,,Y
sub,VID_D,1,00:00:00:00,00:00:01:00,,,,,hello
'''

# Patch the function to add debugging
original_fn = mod.convert_csv_to_json

def patched_fn(*args, **kwargs):
    # Monkey-patch to intercept
    import types
    result = original_fn(*args, **kwargs)
    return result

fd, path = tempfile.mkstemp(suffix=".csv", text=True)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(csv_content)
except Exception:
    os.close(fd)
    raise

# Actually, let's just add debugging directly by modifying the source temporarily
# Or better - let's trace what key_name is being seen

# Try with explicit column structure
csv_content2 = '''record_type,video_id,line,start,end,key,is_global,country_scope,metadata,GBL
meta_local,VID_D,,,,,,,disclaimer_02_flag,Y
sub,VID_D,1,00:00:00:00,00:00:01:00,,,,,hello
'''

fd2, path2 = tempfile.mkstemp(suffix=".csv", text=True)
try:
    with os.fdopen(fd2, "w", encoding="utf-8") as f:
        f.write(csv_content2)
except Exception:
    os.close(fd2)
    raise

try:
    print("=== Test 1: key in correct column ===")
    out = mod.convert_csv_to_json(path, fps=25)
    node = out['byCountry']['GBL']
    v = next(v for v in node['videos'] if v['videoId'].endswith('_landscape'))
    print(f"Metadata: {v['metadata']}")
    
    print("\n=== Test 2: key in metadata column ===")
    out2 = mod.convert_csv_to_json(path2, fps=25)
    node2 = out2['byCountry']['GBL']
    v2 = next(v for v in node2['videos'] if v['videoId'].endswith('_landscape'))
    print(f"Metadata: {v2['metadata']}")
finally:
    os.remove(path)
    os.remove(path2)
