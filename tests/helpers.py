"""
Shared paths and source readers for the Python test suite.

index.html is the single source of truth for which scripts make up the app
(and in which order). The Vite build entry and the in-browser test runner are
both generated from it, so tests derive module lists from here too.
"""

import os
import re

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def read_text(rel_path):
    with open(os.path.join(ROOT_DIR, rel_path), "r", encoding="utf-8") as f:
        return f.read()


def index_scripts():
    """Classic <script src> paths in index.html load order (forward slashes)."""
    return re.findall(r'<script\s+src="([^"]+)"', read_text("index.html"))


def index_stylesheets():
    """<link rel="stylesheet"> hrefs in index.html cascade order."""
    return re.findall(r'<link\s+rel="stylesheet"\s+href="([^"]+)"', read_text("index.html"))


def all_css():
    """Every stylesheet concatenated in cascade order."""
    return "\n".join(read_text(rel) for rel in index_stylesheets())


def module_scripts():
    """Every app script except the two top-level controllers."""
    return [s for s in index_scripts() if s not in ("layout.js", "overlay.js")]


def unit_test_scripts():
    """In-browser spec files under tests/unit, sorted for a stable load order."""
    unit_dir = os.path.join(ROOT_DIR, "tests", "unit")
    found = []
    for dirpath, _, filenames in os.walk(unit_dir):
        for name in filenames:
            if name.endswith(".test.js"):
                rel = os.path.relpath(os.path.join(dirpath, name), os.path.join(ROOT_DIR, "tests"))
                found.append(rel.replace(os.sep, "/"))
    return sorted(found)
