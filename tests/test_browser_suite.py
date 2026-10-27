"""Runs every tests/unit/**/*.test.js spec in headless Chrome against the real app scripts."""

import os

import pytest

import conftest
from browser import chrome, coverage
from browser.build_runner import build_runner
from helpers import ROOT_DIR, index_scripts


pytestmark = pytest.mark.browser


@pytest.fixture(scope="module")
def browser_results(request):
    chrome_bin = chrome.find_chrome()
    if not chrome_bin:
        if os.environ.get("CI"):
            pytest.fail("Chrome/Chromium is required in CI for the in-browser suite")
        pytest.skip("Chrome/Chromium not found; skipping in-browser unit tests")
    return chrome.run_runner_page(chrome_bin, build_runner(request.config.getoption("--spec")))


@pytest.fixture(scope="module")
def coverage_rows(browser_results):
    return coverage.coverage_rows(ROOT_DIR, index_scripts(), browser_results.get("coverage", []))


def test_in_browser_unit_suite_passes(browser_results, coverage_rows):
    badge = browser_results["badge"]
    details = []
    if browser_results.get("initError"):
        details.append(f"initOverlay threw: {browser_results['initError']}")
    details += [f"script error: {e}" for e in browser_results.get("scriptErrors", [])]
    details += [f"FAILED {f}" for f in browser_results.get("failures", [])]

    assert "PASSED" in badge and "FAILED" not in badge, (
        f"In-browser suite: {badge or 'did not finish'}\n" + "\n".join(details)
    )

    conftest.BROWSER_REPORT.update({
        "count": chrome.browser_test_count(badge),
        "rows": coverage_rows,
        "coverage_available": browser_results.get("coverage_available", False),
    })


def test_in_browser_suite_loads_without_script_errors(browser_results):
    assert not browser_results.get("scriptErrors"), "\n".join(browser_results["scriptErrors"])


def test_js_coverage_meets_floor(request, browser_results, coverage_rows):
    """Floors live in pytest.ini (js_coverage_floor / js_file_coverage_floor)."""
    if request.config.getoption("--spec"):
        pytest.skip("--spec runs a subset of specs, so coverage is partial")
    if not browser_results.get("coverage_available") or not coverage_rows:
        pytest.skip("coverage needs websockets (pip install -r requirements-dev.txt)")

    total_floor = float(request.config.getini("js_coverage_floor"))
    file_floor = float(request.config.getini("js_file_coverage_floor"))
    _, _, total_pct = coverage.totals(coverage_rows)
    problems = [f"total JS coverage {total_pct:.1f}% is below the {total_floor:g}% floor"] if total_pct < total_floor else []
    problems += [f"{r['file']}: {r['pct']:.1f}% is below the {file_floor:g}% per-file floor"
                 for r in coverage_rows if r["pct"] < file_floor]
    assert not problems, "\n".join(problems + ["Add specs in tests/unit (or lower the floor in pytest.ini with a reason)."])
