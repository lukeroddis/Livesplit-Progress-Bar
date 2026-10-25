"""
Project-wide rules from AGENT_GUIDE.md that behaviour tests cannot express.

Keep this list short: prefer a JS unit test in tests/unit for anything that is
behaviour. Rules belong here when they guard the distribution contract or a
protocol constraint across every file.
"""

import json
import re

import pytest

from helpers import index_scripts, read_text


def all_app_js():
    return {rel: read_text(rel) for rel in index_scripts()}


def test_version_is_consistent():
    pkg = json.loads(read_text("package.json"))
    assert re.match(r"^\d+\.\d+\.\d+$", pkg["version"]), f"package.json version must be semver: {pkg['version']}"
    assert f'const APP_VERSION = "v{pkg["version"]}";' in read_text("overlay.js"), \
        "overlay.js APP_VERSION must match package.json"
    assert 'id="overlay-version"' in read_text("index.html")


def test_license_is_mit():
    lic = read_text("LICENSE")
    assert "MIT License" in lic and "Luke Roddis" in lic


def test_gettimingmethod_is_never_sent():
    """Blacklisted: legacy LiveSplit.Server.dll hangs the command queue on it (AGENT_GUIDE §2)."""
    offenders = [rel for rel, src in all_app_js().items() if "gettimingmethod" in src]
    assert not offenders, f"gettimingmethod must never be queried: {offenders}"


def test_overlay_init_is_not_bound_to_window_onload():
    """initOverlay is registered via DOMContentLoaded only; window.onload causes double registration."""
    assert "window.onload = initOverlay" not in read_text("overlay.js")


@pytest.mark.parametrize("pattern, where", [
    (r'<script[^>]+src="https?://', "index.html"),
    (r'<link[^>]+href="https?://', "index.html"),
    (r'<img[^>]+src="https?://', "index.html"),
    (r'@import', "style.css"),
    (r'url\(\s*["\']?https?://', "style.css"),
])
def test_no_external_runtime_assets(pattern, where):
    """The release must run from file:// in OBS with no network assets (AGENT_GUIDE §1)."""
    matches = re.findall(pattern, read_text(where))
    assert not matches, f"{where} references external assets: {matches}"


def test_no_module_syntax_in_classic_scripts():
    """Source stays classic scripts so index.html and the test runner work from file://."""
    offenders = [rel for rel, src in all_app_js().items()
                 if re.search(r"^\s*(import\s.+from\s|export\s+(default|const|function|class)\b)", src, re.M)]
    assert not offenders, f"ES module syntax found in classic scripts: {offenders}"


def test_layout_schema_is_valid_and_declares_active_ghosts():
    schema = json.loads(read_text("schema/layout-v1.json"))
    assert schema.get("title") == "LiveSplit Minimal Overlay Layout Profile"
    assert "properties" in schema
    assert '"activeGhosts"' in read_text("schema/layout-v1.json")
