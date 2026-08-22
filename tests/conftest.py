"""Pytest path setup so both the flat domain packages (under the hyphenated
`data-intelligence-system/`) and top-level `core.*` imports resolve."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIS = os.path.join(ROOT, "data-intelligence-system")
TESTS = os.path.join(ROOT, "tests")
for p in (ROOT, DIS, TESTS):
    if p not in sys.path:
        sys.path.insert(0, p)
