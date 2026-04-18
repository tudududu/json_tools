"""PyInstaller runtime hook template for baked converter version.

The build helper renders this template by replacing
`__CSV_TO_JSON_CONVERTER_VERSION__` with a Python string literal.
"""

import os


# Keep runtime env override behavior explicit for frozen binaries.
os.environ["CONVERTER_VERSION"] = __CSV_TO_JSON_CONVERTER_VERSION__
