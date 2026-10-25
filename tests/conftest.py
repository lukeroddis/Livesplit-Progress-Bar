"""
pytest configuration: makes tests/ importable (helpers, browser package) and
prints the in-browser coverage report after the run.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

# Filled by test_browser_suite.py, reported in pytest_terminal_summary
BROWSER_REPORT = {}


def pytest_terminal_summary(terminalreporter, exitstatus, config):
    if not BROWSER_REPORT:
        return
    from browser import coverage

    for line in coverage.terminal_lines(BROWSER_REPORT["count"], BROWSER_REPORT["rows"]):
        terminalreporter.write_line(line)
    if not BROWSER_REPORT.get("coverage_available"):
        terminalreporter.write_line("ℹ️ Install requirements-dev.txt (websockets) for file-by-file coverage.")

    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path and exitstatus == 0:
        passed = len(terminalreporter.stats.get("passed", []))
        try:
            coverage.write_github_summary(summary_path, passed, BROWSER_REPORT["count"], BROWSER_REPORT["rows"])
        except OSError as e:
            terminalreporter.write_line(f"Notice: Could not write GITHUB_STEP_SUMMARY: {e}")
