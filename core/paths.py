"""
Central path constants and sys.path setup for the Data Handler project.

The ``data-intelligence-system`` directory uses hyphens, which makes it
an invalid Python package name.  This module adds it (and the project
root) to ``sys.path`` once, so every other module can simply
``import core.paths`` at the top instead of repeating the boilerplate.
"""

import sys
from pathlib import Path

PROJECT_ROOT = str(Path(__file__).resolve().parent.parent)
DIS_ROOT = str(Path(PROJECT_ROOT) / "data-intelligence-system")

if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

if DIS_ROOT not in sys.path:
    sys.path.insert(0, DIS_ROOT)
