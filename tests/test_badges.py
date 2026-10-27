"""run_tests.py --badges: the shields.io endpoint JSON that CI publishes for the README badges."""

import json

import pytest

from browser import coverage


ROWS = [{"exec_lines": 300, "cov_lines": 270}, {"exec_lines": 100, "cov_lines": 80}]


def test_payloads_sum_python_and_browser_counts_and_report_total_coverage():
    payloads = coverage.badge_payloads(20, 350, ROWS)
    assert payloads["tests.json"] == {"schemaVersion": 1, "label": "tests", "message": "370 passed", "color": "brightgreen"}
    assert payloads["coverage.json"] == {"schemaVersion": 1, "label": "coverage", "message": "87.5%", "color": "green"}


@pytest.mark.parametrize("pct,color", [(95, "brightgreen"), (90, "brightgreen"), (89.9, "green"),
                                       (75, "yellowgreen"), (60, "yellow"), (59.9, "red")])
def test_coverage_color_thresholds(pct, color):
    assert coverage.coverage_color(pct) == color


def test_write_badges_creates_one_file_per_badge(tmp_path):
    out = tmp_path / "badges"
    coverage.write_badges(str(out), 1, 2, ROWS)
    assert sorted(p.name for p in out.iterdir()) == ["coverage.json", "tests.json"]
    assert json.loads((out / "tests.json").read_text(encoding="utf-8"))["message"] == "3 passed"
