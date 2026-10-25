"""
Project-wide rules from DEVELOPER_GUIDE.md that behaviour tests cannot express.

Keep this list short: prefer a JS unit test in tests/unit for anything that is
behaviour. Rules belong here when they guard the distribution contract or a
protocol constraint across every file.
"""

import json
import os
import re
import subprocess

import pytest

from helpers import ROOT_DIR, index_scripts, index_stylesheets, read_text


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
    """Blacklisted: legacy LiveSplit.Server.dll hangs the command queue on it (DEVELOPER_GUIDE §2)."""
    offenders = [rel for rel, src in all_app_js().items() if "gettimingmethod" in src]
    assert not offenders, f"gettimingmethod must never be queried: {offenders}"


def test_overlay_init_is_not_bound_to_window_onload():
    """initOverlay is registered via DOMContentLoaded only; window.onload causes double registration."""
    assert "window.onload = initOverlay" not in read_text("overlay.js")


@pytest.mark.parametrize("pattern, where", [
    (r'<script[^>]+src="https?://', "index.html"),
    (r'<link[^>]+href="https?://', "index.html"),
    (r'<img[^>]+src="https?://', "index.html"),
] + [(p, css) for css in index_stylesheets() for p in (r'@import', r'url\(\s*["\']?https?://')])
def test_no_external_runtime_assets(pattern, where):
    """The release must run from file:// in OBS with no network assets (DEVELOPER_GUIDE §1)."""
    matches = re.findall(pattern, read_text(where))
    assert not matches, f"{where} references external assets: {matches}"


def test_no_module_syntax_in_classic_scripts():
    """Source stays classic scripts so index.html and the test runner work from file://."""
    offenders = [rel for rel, src in all_app_js().items()
                 if re.search(r"^\s*(import\s.+from\s|export\s+(default|const|function|class)\b)", src, re.M)]
    assert not offenders, f"ES module syntax found in classic scripts: {offenders}"


def test_storage_keys_come_from_storage_js():
    """localStorage keys live in STORAGE_KEYS (src/core/storage.js); a mistyped literal silently loses a setting."""
    offenders = {rel: sorted(set(re.findall(r"""["'`](livesplit_\w*)""", src)))
                 for rel, src in all_app_js().items() if rel != "src/core/storage.js"}
    offenders = {rel: keys for rel, keys in offenders.items() if keys}
    assert not offenders, f"Use window.LiveSplit.Storage.KEYS instead of raw key strings: {offenders}"

    # Any literal key passed straight to storage (catches keys without the livesplit_ prefix too)
    literal_calls = {rel: re.findall(r"""(?:localStorage|safeStorage)\.(?:get|set|remove)Item\(\s*(["'`][^"'`]*["'`])""", src)
                     for rel, src in all_app_js().items() if rel != "src/core/storage.js"}
    literal_calls = {rel: calls for rel, calls in literal_calls.items() if calls}
    assert not literal_calls, f"Storage calls with literal keys (add them to STORAGE_KEYS): {literal_calls}"


@pytest.mark.parametrize("label, pattern, owner", [
    ("default track style", r"DEFAULT_TRACK_STYLE\s*=\s*(?:Object\.freeze\()?\{", "src/ui/track-style.js"),
    ("default comparison names", r'\[\s*"Personal Best",\s*"Best Segments",\s*"Average Segments",\s*"Worst Segments"\s*\]', "src/core/split-engine.js"),
    ("HUD component ids", r'\[\s*"title",\s*"timers",\s*"track",\s*"leaderboard"\s*\]', "src/ui/layout-engine.js"),
    ("LiveSplit Server URL", r'"ws://localhost:16834/livesplit"', "src/core/livesplit-client.js"),
])
def test_shared_constant_has_one_owner(label, pattern, owner):
    """Shared defaults are defined once and read from their owner module, so copies cannot drift."""
    found = [rel for rel, src in all_app_js().items() if re.search(pattern, src)]
    assert found == [owner], f"{label} must only be defined in {owner}; found in {found}"


def test_layout_schema_is_valid_and_declares_active_ghosts():
    schema = json.loads(read_text("schema/layout-v1.json"))
    assert schema.get("title") == "LiveSplit Minimal Overlay Layout Profile"
    assert "properties" in schema
    assert '"activeGhosts"' in read_text("schema/layout-v1.json")


def test_eslint_passes():
    """no-undef / no-unused-vars across app, specs and tooling (config: eslint.config.mjs)."""
    eslint = os.path.join(ROOT_DIR, "node_modules", "eslint", "bin", "eslint.js")
    if not os.path.exists(eslint):
        if os.environ.get("CI"):
            pytest.fail("ESLint is not installed; run npm ci")
        pytest.skip("ESLint not installed (npm install); skipping lint")
    result = subprocess.run(["node", eslint, "."], cwd=ROOT_DIR, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr
