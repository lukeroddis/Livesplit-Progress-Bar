"""
pytest configuration: makes tests/ importable (helpers, browser package), adds the
--spec / --coverage options, and reports in-browser coverage when asked.

    python tests/run_tests.py                       full suite, quiet output
    python tests/run_tests.py -m "not browser"      skip headless Chrome (npm run test:quick)
    python tests/run_tests.py --spec race/standings only matching tests/unit spec files
    python tests/run_tests.py --coverage            print the per-file JS coverage table
    python tests/run_tests.py --badges .badges      also write README badge JSON (CI, full green runs)
"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

# Filled by test_browser_suite.py, reported in pytest_terminal_summary
BROWSER_REPORT = {}


def pytest_addoption(parser):
    parser.addoption("--spec", action="append", default=[], metavar="SUBSTRING",
                     help="Only load tests/unit spec files whose path contains SUBSTRING (repeatable)")
    parser.addoption("--coverage", action="store_true", default=False,
                     help="Print the per-file in-browser JS coverage table")
    parser.addoption("--badges", default=None, metavar="DIR",
                     help="On a full passing run with coverage, write shields.io badge JSON into DIR")
    parser.addini("js_coverage_floor", "Minimum total in-browser JS line coverage (%)", default="0")
    parser.addini("js_file_coverage_floor", "Minimum JS line coverage (%) for every app script", default="0")


def pytest_terminal_summary(terminalreporter, exitstatus, config):
    if not BROWSER_REPORT:
        return
    from browser import coverage

    rows = BROWSER_REPORT["rows"]
    if config.getoption("--coverage"):
        for line in coverage.terminal_lines(BROWSER_REPORT["count"], rows):
            terminalreporter.write_line(line)
        if not BROWSER_REPORT.get("coverage_available"):
            terminalreporter.write_line("Install requirements-dev.txt (websockets) for file-by-file coverage.")
    else:
        total_exec, total_cov, pct = coverage.totals(rows)
        cov_text = f", JS coverage {pct:.1f}% (--coverage for per-file)" if rows else ""
        terminalreporter.write_line(f"Browser unit tests: {BROWSER_REPORT['count']} passed{cov_text}")

    passed = len(terminalreporter.stats.get("passed", []))
    badges_dir = config.getoption("--badges")
    if badges_dir and exitstatus == 0 and rows and not config.getoption("--spec"):
        coverage.write_badges(badges_dir, passed, BROWSER_REPORT["count"], rows)
        terminalreporter.write_line(f"Badge JSON written to {badges_dir}")

    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path and exitstatus == 0:
        try:
            coverage.write_github_summary(summary_path, passed, BROWSER_REPORT["count"], rows)
        except OSError as e:
            terminalreporter.write_line(f"Notice: Could not write GITHUB_STEP_SUMMARY: {e}")
