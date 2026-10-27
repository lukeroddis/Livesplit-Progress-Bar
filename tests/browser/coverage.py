"""Per-file line coverage from V8 precise coverage, plus terminal and GitHub step summaries."""

import json
import os


def file_line_coverage(file_path, script_coverage):
    """Returns (executable_lines, covered_lines, pct) for one script's V8 coverage record."""
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()

    lines = content.splitlines(keepends=True)
    if not lines:
        return 0, 0, 0.0

    executed = [0] * len(content)
    for func in script_coverage.get("functions", []):
        for r in func.get("ranges", []):
            start = max(0, min(r.get("startOffset", 0), len(content)))
            end = max(0, min(r.get("endOffset", 0), len(content)))
            val = 1 if r.get("count", 0) > 0 else 0
            for i in range(start, end):
                executed[i] = val

    offset = 0
    covered = 0
    executable = 0
    for line in lines:
        text = line.strip()
        if (text and not text.startswith("//") and not text.startswith("/*") and not text.startswith("*")
                and text not in ["{", "}", "};", "});", "})();"]):
            executable += 1
            if any(executed[offset + k] for k in range(len(line)) if not line[k].isspace()):
                covered += 1
        offset += len(line)

    pct = (covered / executable * 100) if executable > 0 else 100.0
    return executable, covered, pct


def coverage_rows(root_dir, scripts, records):
    """One row per app script that has a coverage record (matched by file name)."""
    rows = []
    for rel in scripts:
        full = os.path.join(root_dir, rel)
        if not os.path.isfile(full):
            continue
        base = os.path.basename(rel)
        rec = next((r for r in records if os.path.basename(r.get("url", "")) == base), None)
        if rec:
            exec_l, cov_l, pct = file_line_coverage(full, rec)
            rows.append({"file": rel, "exec_lines": exec_l, "cov_lines": cov_l, "pct": pct})
    return rows


def totals(rows):
    total_exec = sum(r["exec_lines"] for r in rows)
    total_cov = sum(r["cov_lines"] for r in rows)
    pct = (total_cov / total_exec * 100) if total_exec else 0.0
    return total_exec, total_cov, pct


def terminal_lines(browser_count, rows):
    out = ["=" * 66, "           In-Browser Test Suite & Coverage Report", "=" * 66,
           f" Browser DOM & Unit Tests passed: {browser_count}"]
    if rows:
        total_exec, total_cov, pct = totals(rows)
        out += ["-" * 66, f" {'File':<34} {'Lines':>7} {'Covered':>8} {'Coverage':>9}", "-" * 66]
        out += [f" {r['file']:<34} {r['exec_lines']:7d} {r['cov_lines']:8d} {r['pct']:8.1f}%" for r in rows]
        out += ["-" * 66, f" {'Total Project JavaScript':<34} {total_exec:7d} {total_cov:8d} {pct:8.1f}%"]
    out.append("=" * 66)
    return out


def write_github_summary(path, python_passed, browser_count, rows):
    total_exec, total_cov, pct = totals(rows)
    with open(path, "a", encoding="utf-8") as f:
        f.write("\n## 🧪 LiveSplit Minimal Overlay — Test & Coverage Summary\n\n")
        f.write("| Metric | Status | Details |\n| :--- | :---: | :--- |\n")
        f.write(f"| **Python checks (pytest)** | ✅ **Passed** | {python_passed} tests passed |\n")
        f.write(f"| **In-Browser DOM Unit Tests** | ✅ **Passed** | {browser_count} tests passed |\n")
        if rows:
            f.write(f"| **Overall JavaScript Coverage** | 📊 **{pct:.1f}%** | {total_cov:,} / {total_exec:,} executable lines |\n\n")
            f.write("### 📂 JavaScript Coverage Breakdown\n\n")
            f.write("| File | Executable Lines | Covered Lines | Coverage | Progress |\n| :--- | :---: | :---: | :---: | :--- |\n")
            for r in rows:
                bars = int(round(r["pct"] / 10))
                f.write(f"| `{r['file']}` | {r['exec_lines']:,} | {r['cov_lines']:,} | {r['pct']:.1f}% | `{'🟩' * bars + '⬜' * (10 - bars)}` |\n")
        f.write("\n")


def coverage_color(pct):
    for floor, color in ((90, "brightgreen"), (80, "green"), (70, "yellowgreen"), (60, "yellow")):
        if pct >= floor:
            return color
    return "red"


def badge_payloads(python_passed, browser_count, rows):
    """shields.io endpoint JSON (https://shields.io/badges/endpoint-badge), keyed by file name."""
    _, _, pct = totals(rows)
    return {
        "tests.json": {"schemaVersion": 1, "label": "tests",
                       "message": f"{python_passed + browser_count} passed", "color": "brightgreen"},
        "coverage.json": {"schemaVersion": 1, "label": "coverage",
                          "message": f"{pct:.1f}%", "color": coverage_color(pct)},
    }


def write_badges(out_dir, python_passed, browser_count, rows):
    os.makedirs(out_dir, exist_ok=True)
    for name, payload in badge_payloads(python_passed, browser_count, rows).items():
        with open(os.path.join(out_dir, name), "w", encoding="utf-8", newline="\n") as f:
            json.dump(payload, f)
            f.write("\n")
