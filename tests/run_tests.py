#!/usr/bin/env python3
"""
run_tests.py - Entry point used by npm test, CI, the release workflow and the pre-push hook.

Runs the pytest suite in tests/ (structure checks, project rules, release tooling,
and the in-browser JS unit tests in headless Chrome). Extra arguments are passed
to pytest, e.g. `python tests/run_tests.py -k browser`.
"""

import os
import sys

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def main():
    try:
        import pytest
    except ImportError:
        print("pytest is not installed. Run: python -m pip install -r requirements-dev.txt", file=sys.stderr)
        return 1
    os.chdir(ROOT_DIR)
    return pytest.main(sys.argv[1:])


if __name__ == "__main__":
    sys.exit(main())
