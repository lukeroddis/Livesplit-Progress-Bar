"""scripts/determine_bump.py: which changed paths trigger a release, and which PR titles skip one."""

import importlib.util
import os

import pytest

from helpers import ROOT_DIR


@pytest.fixture(scope="module")
def db():
    path = os.path.join(ROOT_DIR, "scripts", "determine_bump.py")
    spec = importlib.util.spec_from_file_location("determine_bump", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("paths", [
    ["README.md"],
    ["AGENT_GUIDE.md"],
    ["tests/test_runner.template.html"],
    ["tests/run_tests.py"],
    ["tests/unit/core/split-engine.test.js"],
    [".github/workflows/ci.yml", ".github/workflows/release.yml"],
    [".githooks/pre-push"],
    [".gitignore", "LICENSE"],
    ["requirements-dev.txt", "pytest.ini"],
    ["docs/guide.md"],
    ["README.md", "tests/test_runner.template.html", ".github/workflows/release.yml"],
])
def test_non_runtime_paths_do_not_release(db, paths):
    assert db.has_runtime_changes(paths) is False


@pytest.mark.parametrize("paths", [
    ["overlay.js"],
    ["layout.js"],
    ["index.html"],
    ["src/styles/track.css"],
    ["src/core/split-engine.js"],
    ["src/ui/track-renderer.js"],
    ["assets/logo.png"],
    ["schema/layout-schema-v1.json"],
    ["README.md", "overlay.js"],
])
def test_runtime_paths_release(db, paths):
    assert db.has_runtime_changes(paths) is True


@pytest.mark.parametrize("title", [
    "test: comprehensive unit tests",
    "test(core): comprehensive unit tests",
    "docs: update README badges",
    "chore: cleanup temp files",
    "ci: update github action",
    "build: update dependencies",
    "style: format code",
])
def test_non_release_pr_titles(db, title):
    assert db.NON_RELEASE_TITLE_REGEX.match(title) is not None


@pytest.mark.parametrize("title", ["feat: live race ghosts", "fix: pin stacking calculation", "perf: optimize element caching"])
def test_release_pr_titles(db, title):
    assert db.NON_RELEASE_TITLE_REGEX.match(title) is None
