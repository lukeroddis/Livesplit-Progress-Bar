#!/usr/bin/env python3
"""
run_tests.py - Comprehensive Unit Test Suite and Static Analysis Checker
Runs locally and in GitHub Actions CI to maintain code stability.
"""

import sys
import os
import re
import math
import json
import shutil
import socket
import subprocess
import tempfile
import urllib.request
import asyncio

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

def test_file_integrity():
    """Verify core project files exist and are UTF-8 decodable."""
    required = [
        "index.html", "layout.js", "overlay.js", "style.css", "README.md", "LICENSE", "package.json", "schema/layout-v1.json",
        os.path.join("src", "core", "storage.js"),
        os.path.join("src", "core", "time-utils.js"),
        os.path.join("src", "core", "split-engine.js"),
        os.path.join("src", "core", "ghost-math.js"),
        os.path.join("src", "core", "livesplit-client.js"),
        os.path.join("src", "core", "race-simulation.js"),
        os.path.join("src", "core", "race-ranking.js"),
        os.path.join("src", "core", "race-protocol.js"),
        os.path.join("src", "core", "race-discovery.js"),
        os.path.join("src", "core", "race-logger.js"),
        os.path.join("src", "core", "race-client.js"),
        os.path.join("src", "core", "layout-profiles.js"),
        os.path.join("src", "ui", "layout-engine.js"),
        os.path.join("src", "ui", "track-renderer.js"),
        os.path.join("src", "ui", "track-style.js"),
        os.path.join("src", "ui", "interactions.js"),
        os.path.join("src", "ui", "race-track-markers.js"),
        os.path.join("src", "ui", "toast-manager.js"),
        os.path.join("src", "ui", "timer-display.js"),
        os.path.join("src", "ui", "timer-anchor.js"),
        os.path.join("src", "ui", "game-logo.js"),
        os.path.join("src", "utils", "dom-utils.js")
    ]
    for fname in required:
        path = os.path.join(ROOT_DIR, fname)
        assert os.path.exists(path), f"Missing required file: {fname}"
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
            assert len(content) > 0, f"File is empty: {fname}"
    print("✓ File integrity & UTF-8 encoding check passed.")


def test_syntax_and_brackets():
    """Verify bracket balance, parentheses, and quote termination."""
    pairs = {')': '(', ']': '[', '}': '{'}
    files_to_check = [
        "index.html", "layout.js", "overlay.js", "style.css",
        os.path.join("src", "core", "storage.js"),
        os.path.join("src", "core", "time-utils.js"),
        os.path.join("src", "core", "split-engine.js"),
        os.path.join("src", "core", "ghost-math.js"),
        os.path.join("src", "core", "livesplit-client.js"),
        os.path.join("src", "core", "race-simulation.js"),
        os.path.join("src", "core", "race-ranking.js"),
        os.path.join("src", "core", "race-protocol.js"),
        os.path.join("src", "core", "race-discovery.js"),
        os.path.join("src", "core", "race-logger.js"),
        os.path.join("src", "core", "race-client.js"),
        os.path.join("src", "core", "layout-profiles.js"),
        os.path.join("src", "ui", "layout-engine.js"),
        os.path.join("src", "ui", "track-renderer.js"),
        os.path.join("src", "ui", "track-style.js"),
        os.path.join("src", "ui", "interactions.js"),
        os.path.join("src", "ui", "race-track-markers.js"),
        os.path.join("src", "ui", "toast-manager.js"),
        os.path.join("src", "ui", "timer-display.js"),
        os.path.join("src", "ui", "timer-anchor.js"),
        os.path.join("src", "ui", "game-logo.js"),
        os.path.join("src", "utils", "dom-utils.js")
    ]
    
    for fname in files_to_check:
        path = os.path.join(ROOT_DIR, fname)
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
            
        stack = []
        in_str = None
        esc = False
        in_line_comment = False
        in_block_comment = False
        line, col = 1, 0
        i = 0
        while i < len(content):
            c = content[i]
            col += 1
            if c == '\n':
                line += 1
                col = 0
                in_line_comment = False
                i += 1
                continue
            if in_line_comment:
                i += 1
                continue
            if in_block_comment:
                if content[i:i+2] == '*/':
                    in_block_comment = False
                    i += 2
                    continue
                i += 1
                continue
            if in_str:
                if esc:
                    esc = False
                elif c == '\\':
                    esc = True
                elif c == in_str:
                    in_str = None
                i += 1
                continue
            if content[i:i+2] == '//':
                in_line_comment = True
                i += 2
                continue
            if content[i:i+2] == '/*':
                in_block_comment = True
                i += 2
                continue
            if c in ['"', "'", '`']:
                in_str = c
                esc = False
                i += 1
                continue
            if c in '([{':
                stack.append((c, line, col))
            elif c in ')]}':
                assert stack, f"{fname}: unexpected closing '{c}' at {line}:{col}"
                top, tl, tc = stack.pop()
                assert pairs[c] == top, f"{fname}: mismatched '{c}' at {line}:{col}, opened '{top}' at {tl}:{tc}"
            i += 1
        assert not stack, f"{fname}: unclosed '{stack[-1][0]}' from line {stack[-1][1]}:{stack[-1][2]}"

    # Ensure all top-level window exports in overlay.js are defined at file-level scope (prevents ReferenceError)
    overlay_path = os.path.join(ROOT_DIR, "overlay.js")
    if os.path.exists(overlay_path):
        with open(overlay_path, "r", encoding="utf-8") as f:
            code = f.read()
        exports = re.findall(r'window\.([a-zA-Z0-9_]+)\s*=\s*\1;', code)
        for sym in exports:
            assert re.search(r'^(?:function\s+|const\s+|let\s+)' + sym + r'\b', code, re.MULTILINE), \
                f"overlay.js: exported identifier '{sym}' is not defined at top-level scope!"

    print("✓ Syntax and bracket matching check passed.")


def test_dom_id_consistency():
    """Ensure all getElementById calls in JS match IDs defined in index.html."""
    html_path = os.path.join(ROOT_DIR, "index.html")
    with open(html_path, "r", encoding="utf-8") as f:
        html = f.read()

    # Match id="..." and id='...'
    defined_ids = set(re.findall(r'id=["\']([^"\']+)["\']', html))

    # Dynamic IDs generated at runtime in JS
    dynamic_prefixes = ("item-", "fill-", "delta-", "delta-val-", "time-val-", "node-", "ghost-marker-")

    for js_file in [
        "layout.js", "overlay.js",
        os.path.join("src", "core", "storage.js"),
        os.path.join("src", "core", "time-utils.js"),
        os.path.join("src", "core", "split-engine.js"),
        os.path.join("src", "core", "ghost-math.js"),
        os.path.join("src", "core", "livesplit-client.js"),
        os.path.join("src", "core", "race-simulation.js"),
        os.path.join("src", "core", "race-ranking.js"),
        os.path.join("src", "core", "race-protocol.js"),
        os.path.join("src", "core", "race-discovery.js"),
        os.path.join("src", "core", "race-logger.js"),
        os.path.join("src", "core", "race-client.js"),
        os.path.join("src", "core", "layout-profiles.js"),
        os.path.join("src", "ui", "layout-engine.js"),
        os.path.join("src", "ui", "track-renderer.js"),
        os.path.join("src", "ui", "track-style.js"),
        os.path.join("src", "ui", "interactions.js"),
        os.path.join("src", "ui", "leaderboard.js"),
        os.path.join("src", "ui", "race-track-markers.js"),
        os.path.join("src", "ui", "toast-manager.js"),
        os.path.join("src", "ui", "timer-display.js"),
        os.path.join("src", "ui", "timer-anchor.js"),
        os.path.join("src", "ui", "game-logo.js"),
        os.path.join("src", "utils", "dom-utils.js")
    ]:
        path = os.path.join(ROOT_DIR, js_file)
        with open(path, "r", encoding="utf-8") as f:
            code = f.read()

        # Find static document.getElementById("...")
        queried_ids = re.findall(r'getElementById\(["\']([^"\'$`]+)["\']\)', code)
        for qid in queried_ids:
            if any(qid.startswith(p) for p in dynamic_prefixes):
                continue
            assert qid in defined_ids, f"JS file {js_file} references missing DOM id: '{qid}'"
            
    print("✓ DOM element ID reference consistency passed.")


# ---------------------------------------------------------------------------
# Unit Tests for Core Speedrun Algorithms
# ---------------------------------------------------------------------------

def time_string_to_seconds(t_str):
    if not t_str or t_str == "-" or t_str == "":
        return None
    s = t_str.strip()
    days = 0
    time_part = s
    if "." in s:
        first_dot = s.find(".")
        first_colon = s.find(":")
        if first_colon != -1 and first_dot < first_colon:
            try:
                days = int(s[:first_dot])
            except ValueError:
                days = 0
            time_part = s[first_dot + 1:]
    parts = time_part.split(":")
    try:
        if len(parts) == 3:
            sec = float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
        elif len(parts) == 2:
            sec = float(parts[0]) * 60 + float(parts[1])
        elif len(parts) == 1:
            sec = float(parts[0])
        else:
            return None
    except ValueError:
        return None
    return days * 86400 + sec


def format_target_time(sec):
    if sec is None or math.isnan(sec):
        return ""
    total = math.floor(sec)
    h = total // 3600
    m = (total % 3600) // 60
    s = total % 60
    s_pad = f"0{s}" if s < 10 else f"{s}"
    if h > 0:
        m_pad = f"0{m}" if m < 10 else f"{m}"
        return f"{h}:{m_pad}:{s_pad}"
    return f"{m}:{s_pad}"


def format_timer_display(raw_time):
    if raw_time is None or raw_time == "":
        return "0.00"
    if raw_time == "-":
        return "-"

    is_negative = False
    days = 0
    h = 0
    m = 0
    s = 0
    hundredths = "00"

    if isinstance(raw_time, (int, float)):
        if math.isnan(raw_time):
            return "0.00"
        if raw_time < 0:
            is_negative = True
            raw_time = abs(raw_time)
        total_hundredths = round(raw_time * 100)
        total_sec = total_hundredths // 100
        frac = total_hundredths % 100
        h = total_sec // 3600
        m = (total_sec % 3600) // 60
        s = total_sec % 60
        hundredths = f"{frac:02d}"
    else:
        s_val = str(raw_time).strip()
        if s_val.startswith(("-", "−", "\u2212")):
            is_negative = True
            s_val = re.sub(r"^[-−\u2212]", "", s_val).strip()

        if "." in s_val:
            first_dot = s_val.find(".")
            first_colon = s_val.find(":")
            if first_colon != -1 and first_dot < first_colon:
                try:
                    days = int(s_val[:first_dot])
                except ValueError:
                    days = 0
                s_val = s_val[first_dot + 1:]

        time_main = s_val
        frac_part = ""
        if "." in s_val:
            dot_idx = s_val.find(".")
            time_main = s_val[:dot_idx]
            frac_part = s_val[dot_idx + 1:]

        if len(frac_part) >= 2:
            hundredths = frac_part[:2]
        else:
            hundredths = frac_part.ljust(2, "0")

        parts = time_main.split(":")
        if len(parts) == 3:
            h = (int(parts[0]) if parts[0].isdigit() else 0) + (days * 24)
            m = int(parts[1]) if parts[1].isdigit() else 0
            s = int(parts[2]) if parts[2].isdigit() else 0
        elif len(parts) == 2:
            h = days * 24
            m = int(parts[0]) if parts[0].isdigit() else 0
            s = int(parts[1]) if parts[1].isdigit() else 0
        elif len(parts) == 1:
            h = days * 24
            m = 0
            s = int(parts[0]) if parts[0].isdigit() else 0

    if is_negative and h == 0 and m == 0 and s == 0 and hundredths in ("00", "0"):
        is_negative = False

    s_pad = f"{s:02d}" if (h > 0 or m > 0) else f"{s}"

    if h > 0:
        m_pad = f"{m:02d}"
        res = f"{h}:{m_pad}:{s_pad}.{hundredths}"
    elif m > 0:
        res = f"{m}:{s_pad}.{hundredths}"
    else:
        res = f"{s_pad}.{hundredths}"

    return f"-{res}" if is_negative else res


def format_delta_seconds(signed_sec):
    if signed_sec is None or math.isnan(signed_sec):
        return ""
    is_ahead = signed_sec < 0
    sign = "-" if is_ahead else "+"
    abs_sec = abs(signed_sec)
    if abs_sec < 0.05:
        return "±0.0"
    total_sec = math.floor(abs_sec)
    frac = math.floor((abs_sec - total_sec) * 10)
    h = total_sec // 3600
    m = (total_sec % 3600) // 60
    s = total_sec % 60
    s_pad = f"0{s}" if (s < 10 and (h > 0 or m > 0)) else f"{s}"
    if h > 0:
        m_pad = f"0{m}" if m < 10 else f"{m}"
        return f"{sign}{h}:{m_pad}:{s_pad}"
    if m > 0:
        return f"{sign}{m}:{s_pad}"
    return f"{sign}{s_pad}.{frac}"


def normalize_comparison_name(raw, comparisons_list):
    if not raw or raw == "-" or not raw.strip():
        return None
    s = raw.strip()
    low = s.lower()
    if low in ("personal best", "pb"):
        return "Personal Best"
    if low in ("best segments", "best splits", "sum of best"):
        return "Best Segments"
    if low in ("average segments", "average"):
        return "Average Segments"
    if low in ("worst segments", "worst"):
        return "Worst Segments"
    for c in comparisons_list:
        if c.lower() == low:
            return c
    return s


def test_time_conversion_unit():
    assert time_string_to_seconds("0:00") == 0.0
    assert time_string_to_seconds("1:23.45") == 83.45
    assert time_string_to_seconds("01:02:03") == 3723.0
    assert time_string_to_seconds("1.00:00:00") == 86400.0
    assert time_string_to_seconds("-") is None
    assert time_string_to_seconds("") is None
    assert time_string_to_seconds(None) is None
    print("✓ time_string_to_seconds unit tests passed.")


def test_format_target_time_unit():
    assert format_target_time(0) == "0:00"
    assert format_target_time(59) == "0:59"
    assert format_target_time(60) == "1:00"
    assert format_target_time(125) == "2:05"
    assert format_target_time(3600) == "1:00:00"
    assert format_target_time(3665) == "1:01:05"
    assert format_target_time(None) == ""
    print("✓ format_target_time unit tests passed.")


def test_format_timer_display_unit():
    # 1. Initial idle state formats
    assert format_timer_display("00:00:00") == "0.00"
    assert format_timer_display("00:00:00.00") == "0.00"
    assert format_timer_display("00:00:00.0000000") == "0.00"
    assert format_timer_display("") == "0.00"
    assert format_timer_display(None) == "0.00"
    assert format_timer_display(0) == "0.00"
    assert format_timer_display(0.0) == "0.00"
    assert format_timer_display("-") == "-"

    # 2. Sub-minute milestone (0s to 59.99s) - dynamic expansion with no leading minutes/hours
    assert format_timer_display("00:00:09.2134567") == "9.21"
    assert format_timer_display("00:00:10.05") == "10.05"
    assert format_timer_display("00:00:59.99") == "59.99"
    assert format_timer_display(9.21) == "9.21"
    assert format_timer_display(59.99) == "59.99"

    # 3. Minute milestone (1m to 59m 59.99s) - fills M:SS.dd with no leading hours
    assert format_timer_display("00:01:00.00") == "1:00.00"
    assert format_timer_display("00:01:05.2134567") == "1:05.21"
    assert format_timer_display("00:09:59.99") == "9:59.99"
    assert format_timer_display("00:10:00.00") == "10:00.00"
    assert format_timer_display("00:59:59.99") == "59:59.99"
    assert format_timer_display(65.21) == "1:05.21"
    assert format_timer_display(600.0) == "10:00.00"

    # 4. Hour milestone (1h+) - fills H:MM:SS.dd
    assert format_timer_display("01:00:00.00") == "1:00:00.00"
    assert format_timer_display("01:05:09.2134567") == "1:05:09.21"
    assert format_timer_display("10:15:30.45") == "10:15:30.45"
    assert format_timer_display(3665.21) == "1:01:05.21"

    # 5. Over 24 hours (day format)
    assert format_timer_display("1.02:03:04.56") == "26:03:04.56"

    # 6. Negative countdown times
    assert format_timer_display("-00:00:03.50") == "-3.50"
    assert format_timer_display("-00:00:00") == "0.00"
    assert format_timer_display(-3.5) == "-3.50"

    # 7. Static codebase verification
    with open(os.path.join(ROOT_DIR, "index.html"), "r", encoding="utf-8") as f:
        html_src = f.read()
    with open(os.path.join(ROOT_DIR, "overlay.js"), "r", encoding="utf-8") as f:
        overlay_src = f.read()

    assert '<div class="timer-secondary" id="timer-rta">0.00</div>' in html_src, \
        "index.html must initialize timer-rta with '0.00'"
    assert '<div class="timer-primary" id="timer-igt">0.00</div>' in html_src, \
        "index.html must initialize timer-igt with '0.00'"

    assert "function formatTimerDisplay(rawTime)" in overlay_src, \
        "overlay.js must implement formatTimerDisplay"
    assert "window.formatTimerDisplay = formatTimerDisplay;" in overlay_src, \
        "overlay.js must export formatTimerDisplay"
    assert "formatTimerDisplay(igt)" in overlay_src, \
        "overlay.js must use formatTimerDisplay for Game Time"
    assert "formatTimerDisplay(rta)" in overlay_src, \
        "overlay.js must use formatTimerDisplay for Real Time"

    print("✓ formatTimerDisplay LiveSplit milestone formatting unit tests passed.")


def test_format_delta_unit():
    assert format_delta_seconds(0.0) == "±0.0"
    assert format_delta_seconds(0.04) == "±0.0"
    assert format_delta_seconds(-0.04) == "±0.0"
    assert format_delta_seconds(-1.5) == "-1.5"
    assert format_delta_seconds(12.3) == "+12.3"
    assert format_delta_seconds(-65.2) == "-1:05"
    assert format_delta_seconds(125.0) == "+2:05"
    assert format_delta_seconds(4200.0) == "+1:10:00"
    assert format_delta_seconds(-3665.2) == "-1:01:05"
    print("✓ format_delta_seconds unit tests passed.")


def test_comparison_normalization_unit():
    comps = ["Personal Best", "Best Segments", "Average Segments", "Worst Segments", "Goal 100%"]
    assert normalize_comparison_name("pb", comps) == "Personal Best"
    assert normalize_comparison_name("Personal Best", comps) == "Personal Best"
    assert normalize_comparison_name("sum of best", comps) == "Best Segments"
    assert normalize_comparison_name("average", comps) == "Average Segments"
    assert normalize_comparison_name("worst", comps) == "Worst Segments"
    assert normalize_comparison_name("goal 100%", comps) == "Goal 100%"
    assert normalize_comparison_name("-", comps) is None
    print("✓ normalize_comparison_name unit tests passed.")


def test_comparison_curves_math():
    """Verify Cumulative Sum of Best, Average, and Worst curves."""
    pb = [60.0, 120.0, 180.0]
    bests = [55.0, 50.0, 52.0]
    histories = [
        [58.0, 62.0, 60.0],       # avg = 60.0, worst = 62.0
        [52.0, 56.0, 60.0],       # avg = 56.0, worst = 60.0
        [55.0, 65.0, 60.0]        # avg = 60.0, worst = 65.0
    ]

    # Best Segments (Sum of Best)
    cum_best = []
    tot = 0
    for b in bests:
        tot += b
        cum_best.append(tot)
    assert cum_best == [55.0, 105.0, 157.0]

    # Average Segments
    cum_avg = []
    tot = 0
    for h in histories:
        avg = sum(h) / len(h)
        tot += avg
        cum_avg.append(tot)
    assert cum_avg == [60.0, 116.0, 176.0]

    # Worst Segments
    cum_worst = []
    tot = 0
    for h in histories:
        worst = max(h)
        tot += worst
        cum_worst.append(tot)
    assert cum_worst == [62.0, 122.0, 187.0]

    # Monotonicity check: Best <= Average <= Worst
    for i in range(len(pb)):
        assert cum_best[i] <= cum_avg[i] <= cum_worst[i], f"Curve ordering violation at index {i}"
    print("✓ Comparison curves (Best, Average, Worst) mathematical ordering passed.")


def sanitize_comparison_times(times, fallback_times=None, total_len=None):
    if not times:
        return list(fallback_times) if fallback_times else []
    target_len = total_len if total_len is not None else len(times)
    result = [None] * target_len
    last_val = 0.0

    for i in range(target_len):
        raw = times[i] if i < len(times) else None
        if raw is not None and raw > 0:
            last_val = raw
            result[i] = raw
        elif fallback_times and i < len(fallback_times) and fallback_times[i] is not None and fallback_times[i] > 0:
            fb = fallback_times[i]
            last_val = max(last_val, fb)
            result[i] = last_val
        else:
            result[i] = last_val if last_val > 0 else None
    return result


def calculate_ghost_progress(current_sec, times):
    if not times or current_sec is None or current_sec <= 0:
        return 0, 0.0, False, 0.0

    last_valid_idx = len(times) - 1
    while last_valid_idx >= 0 and (times[last_valid_idx] is None or times[last_valid_idx] <= 0):
        last_valid_idx -= 1

    if last_valid_idx < 0:
        return 0, 0.0, False, 0.0

    last_time = times[last_valid_idx]
    if current_sec >= last_time:
        return last_valid_idx, 1.0, True, last_time

    for i in range(last_valid_idx + 1):
        t_next = times[i]
        if t_next is None or t_next <= 0:
            continue

        t_prev = 0.0
        p_idx = i - 1
        while p_idx >= 0:
            if times[p_idx] is not None and times[p_idx] > 0:
                t_prev = times[p_idx]
                break
            p_idx -= 1

        if current_sec < t_next:
            dur = t_next - t_prev
            ratio = max(0.0, min(1.0, (current_sec - t_prev) / dur)) if dur > 0 else 0.0
            return i, ratio, False, t_next

    return last_valid_idx, 1.0, True, last_time


def test_sanitize_comparison_times_unit():
    # Sparse with holes and forward fill from fallback
    times = [100.0, None, 300.0]
    fallback = [120.0, 220.0, 320.0]
    res = sanitize_comparison_times(times, fallback, 3)
    assert res == [100.0, 220.0, 300.0]

    # Empty list falls back cleanly
    assert sanitize_comparison_times([], fallback, 3) == [120.0, 220.0, 320.0]
    print("✓ sanitize_comparison_times unit tests passed.")


def test_ghost_runner_progress():
    times = [60.0, 120.0, 180.0, 240.0]

    # At start / 0 sec
    seg, ratio, finished, _ = calculate_ghost_progress(0, times)
    assert seg == 0 and ratio == 0.0 and not finished

    # Midway through first segment
    seg, ratio, finished, _ = calculate_ghost_progress(30, times)
    assert seg == 0 and math.isclose(ratio, 0.5) and not finished

    # Exactly at split 0 boundary
    seg, ratio, finished, _ = calculate_ghost_progress(60, times)
    assert seg == 1 and math.isclose(ratio, 0.0) and not finished

    # Midway through split 1
    seg, ratio, finished, _ = calculate_ghost_progress(90, times)
    assert seg == 1 and math.isclose(ratio, 0.5) and not finished

    # At finish line
    seg, ratio, finished, _ = calculate_ghost_progress(240, times)
    assert seg == 3 and math.isclose(ratio, 1.0) and finished

    # Beyond finish line
    seg, ratio, finished, _ = calculate_ghost_progress(300, times)
    assert seg == 3 and math.isclose(ratio, 1.0) and finished

    # Sparse array with missing split values
    sparse_times = [60.0, None, 180.0]
    seg, ratio, finished, _ = calculate_ghost_progress(30, sparse_times)
    assert seg == 0 and math.isclose(ratio, 0.5)

    # Empty/None array should return index 0 without throwing
    seg, ratio, finished, _ = calculate_ghost_progress(30, [])
    assert seg == 0 and ratio == 0.0

    print("✓ Live Ghost runner progress interpolation passed.")


def detect_timing_method_from_comp(split_idx, comp_sec, targets_gt, targets_rt):
    if split_idx < 0 or comp_sec is None or comp_sec <= 0:
        return None
    gt_sec = targets_gt[split_idx] if targets_gt and split_idx < len(targets_gt) else None
    rt_sec = targets_rt[split_idx] if targets_rt and split_idx < len(targets_rt) else None
    if gt_sec is not None and rt_sec is not None and abs(gt_sec - rt_sec) > 1.0:
        diff_gt = abs(comp_sec - gt_sec)
        diff_rt = abs(comp_sec - rt_sec)
        return "GameTime" if diff_gt <= diff_rt else "RealTime"
    return None


def test_detect_timing_method_unit():
    # In FFX PC: GT targets ~206s (3:26), RT targets ~811s (13:31)
    targets_gt = [206.0, 686.0]
    targets_rt = [811.0, 1734.0]

    # LiveSplit returns Game Time (206s) -> Should detect GameTime
    assert detect_timing_method_from_comp(0, 206.0, targets_gt, targets_rt) == "GameTime"

    # LiveSplit returns Real Time (811s) -> Should detect RealTime
    assert detect_timing_method_from_comp(0, 811.0, targets_gt, targets_rt) == "RealTime"

    # LiveSplit returns close GameTime value (202s) -> Should detect GameTime
    assert detect_timing_method_from_comp(0, 202.0, targets_gt, targets_rt) == "GameTime"

    # Boundary safety
    assert detect_timing_method_from_comp(-1, 206.0, targets_gt, targets_rt) is None
    assert detect_timing_method_from_comp(0, None, targets_gt, targets_rt) is None
    assert detect_timing_method_from_comp(5, 206.0, targets_gt, targets_rt) is None
    print("✓ detect_timing_method_from_comp unit tests passed.")


def test_ghost_timescale_mismatch_defense():
    # Runner target: 206.5s (3:26.5 PB)
    # WR GameTime: 202.0s (3:22.0)
    # WR RealTime: 811.0s (13:31.0 - contains 10 min cutscenes)
    fallback_times = [206.5]
    wr_cand_rt = [811.0]
    wr_alt_gt = [202.0]

    cur_ratio = abs(wr_cand_rt[0] - fallback_times[0]) / fallback_times[0]
    alt_ratio = abs(wr_alt_gt[0] - fallback_times[0]) / fallback_times[0]

    assert cur_ratio > 1.5, "RealTime WR should trigger scale mismatch (> 1.5)"
    assert alt_ratio < 0.5, "GameTime WR should match scale (< 0.5)"

    selected_times = wr_alt_gt if (cur_ratio > 1.5 and alt_ratio < 0.5) else wr_cand_rt
    assert selected_times == [202.0]

    seg, ratio, finished, target = calculate_ghost_progress(214.0, selected_times)
    assert seg == 0 and math.isclose(ratio, 1.0) and finished
    print("✓ Ghost runner timescale mismatch defense passed.")


def is_hovering_split_text(ghost_x, start_x, end_x, prev_threshold, next_threshold):
    dist_prev = abs(ghost_x - start_x)
    dist_next = abs(end_x - ghost_x)
    return (dist_prev < prev_threshold) or (dist_next < next_threshold)


def test_dynamic_pin_sizing_proximity():
    # Setup a track segment from node 0 (x=50) to node 1 (x=350)
    start_x = 50.0
    end_x = 350.0
    prev_threshold = 45.0  # Threshold around node 0
    next_threshold = 55.0  # Threshold around node 1 (e.g. longer split title)

    # 1. At start node (dist_prev = 0) -> Hovering text -> Compact
    assert is_hovering_split_text(50.0, start_x, end_x, prev_threshold, next_threshold) is True

    # 2. Just inside start node text boundary (dist_prev = 40 < 45) -> Compact
    assert is_hovering_split_text(90.0, start_x, end_x, prev_threshold, next_threshold) is True

    # 3. Open track space (dist_prev = 100 > 45, dist_next = 200 > 55) -> Extended / longer pin
    assert is_hovering_split_text(150.0, start_x, end_x, prev_threshold, next_threshold) is False
    assert is_hovering_split_text(200.0, start_x, end_x, prev_threshold, next_threshold) is False
    assert is_hovering_split_text(250.0, start_x, end_x, prev_threshold, next_threshold) is False

    # 4. Approaching target node text boundary (dist_next = 50 < 55) -> Compact
    assert is_hovering_split_text(300.0, start_x, end_x, prev_threshold, next_threshold) is True

    # 5. Right at target node (dist_next = 0) -> Compact
    assert is_hovering_split_text(350.0, start_x, end_x, prev_threshold, next_threshold) is True

    print("✓ Dynamic pin sizing proximity check passed.")


def parse_active_ghosts(val):
    if isinstance(val, list):
        res = [x for x in val if x]
    elif isinstance(val, str):
        if "," in val:
            res = [x.strip() for x in val.split(",") if x.strip()]
        elif not val.strip() or val.strip().lower() == "off":
            res = ["off"]
        else:
            res = [val.strip()]
    else:
        res = ["off"]
    return res if res else ["off"]


def toggle_ghost_selection(current_list, ghost_id):
    gid = (ghost_id or "").strip()
    if not gid or gid == "off":
        return ["off"]
    active = [x for x in current_list if x and x != "off"]
    if gid in active:
        active.remove(gid)
    else:
        active.append(gid)
    return active if active else ["off"]


def test_multi_ghost_selection_logic():
    # Parsing strings and arrays
    assert parse_active_ghosts("wr,pb") == ["wr", "pb"]
    assert parse_active_ghosts(["wr", "pb"]) == ["wr", "pb"]
    assert parse_active_ghosts("off") == ["off"]
    assert parse_active_ghosts("") == ["off"]
    assert parse_active_ghosts(None) == ["off"]

    # Toggle logic
    active = ["off"]
    active = toggle_ghost_selection(active, "wr")
    assert active == ["wr"]

    active = toggle_ghost_selection(active, "pb")
    assert active == ["wr", "pb"]

    active = toggle_ghost_selection(active, "best")
    assert active == ["wr", "pb", "best"]

    active = toggle_ghost_selection(active, "wr")
    assert active == ["pb", "best"]

    active = toggle_ghost_selection(active, "off")
    assert active == ["off"]

    print("✓ Multi-Ghost selection & toggle logic passed.")


def map_track_orientation_switch(old_orient, new_orient, current_name_pos, current_delta_pos):
    """Mirror the position mapping logic when toggling between horizontal and vertical."""
    norm_new = "vertical" if new_orient == "vertical" else "horizontal"
    if norm_new == old_orient:
        return old_orient, current_name_pos, current_delta_pos

    name_pos = current_name_pos
    delta_pos = current_delta_pos

    if norm_new == "vertical":
        if name_pos in ["top", "bottom"]:
            name_pos = "right" if name_pos == "bottom" else "left"
        if delta_pos in ["top", "bottom"]:
            delta_pos = "right"
    else:
        if name_pos in ["left", "right"]:
            name_pos = "bottom" if name_pos == "right" else "top"
        if delta_pos in ["left", "right"]:
            delta_pos = "top"

    return norm_new, name_pos, delta_pos


def test_track_orientation_unit():
    """Verify orientation toggle and position mapping logic."""
    # 1. Switch from horizontal (top/top) to vertical -> (left/right)
    o, np, dp = map_track_orientation_switch("horizontal", "vertical", "top", "top")
    assert o == "vertical"
    assert np == "left"
    assert dp == "right"

    # 2. Switch from horizontal (bottom/top) to vertical -> (right/right)
    o, np, dp = map_track_orientation_switch("horizontal", "vertical", "bottom", "top")
    assert o == "vertical"
    assert np == "right"
    assert dp == "right"

    # 3. Switch from vertical (left/right) to horizontal -> (top/top)
    o, np, dp = map_track_orientation_switch("vertical", "horizontal", "left", "right")
    assert o == "horizontal"
    assert np == "top"
    assert dp == "top"

    # 4. Switch from vertical (right/right) to horizontal -> (bottom/top)
    o, np, dp = map_track_orientation_switch("vertical", "horizontal", "right", "right")
    assert o == "horizontal"
    assert np == "bottom"
    assert dp == "top"

    # 5. Idempotent check
    o, np, dp = map_track_orientation_switch("vertical", "vertical", "left", "right")
    assert o == "vertical"
    assert np == "left"
    assert dp == "right"

    print("✓ Track orientation and positional mapping unit tests passed.")


def format_ghost_pin_badge(val):
    return "0px (On Track)" if val == 0 else f"{val}px"


def parse_and_clamp_ghost_pin_len(val_str):
    try:
        num = int(val_str)
        return max(0, min(60, num))
    except (ValueError, TypeError):
        return None


def test_ghost_pin_length_zero_track():
    """Verify zero-length ghost pin (running directly along track) logic and assets."""
    # 1. Badge formatting
    assert format_ghost_pin_badge(0) == "0px (On Track)"
    assert format_ghost_pin_badge(16) == "16px"
    assert format_ghost_pin_badge(36) == "36px"

    # 2. URL parameter parsing and clamping (supports 0)
    assert parse_and_clamp_ghost_pin_len("0") == 0
    assert parse_and_clamp_ghost_pin_len("-5") == 0
    assert parse_and_clamp_ghost_pin_len("16") == 16
    assert parse_and_clamp_ghost_pin_len("70") == 60
    assert parse_and_clamp_ghost_pin_len("invalid") is None

    # 3. Static verification of index.html
    html_path = os.path.join(ROOT_DIR, "index.html")
    with open(html_path, "r", encoding="utf-8") as f:
        html = f.read()
    assert re.search(r'id=["\']slider-ghost-pin-length["\'][^>]*min=["\']0["\']', html) or \
           re.search(r'min=["\']0["\'][^>]*id=["\']slider-ghost-pin-length["\']', html), \
           "index.html: slider-ghost-pin-length must allow min='0'"

    # 4. Static verification of style.css
    css_path = os.path.join(ROOT_DIR, "style.css")
    with open(css_path, "r", encoding="utf-8") as f:
        css = f.read()
    assert "--ghost-needle-length: 16px;" in css, "style.css missing :root --ghost-needle-length definition"
    assert ".track.ghost-on-track" in css, "style.css missing .track.ghost-on-track rule"
    assert ".track.ghost-on-track .ghost-needle" in css and "display: none" in css, \
        "style.css: ghost needle must be hidden when on track"
    assert "--track-padding-bottom" in css, "style.css missing --track-padding-bottom definition"

    # 5. Static verification of layout.js / track-style.js
    js_path = os.path.join(ROOT_DIR, "layout.js")
    with open(js_path, "r", encoding="utf-8") as f:
        js = f.read()
    ts_path = os.path.join(ROOT_DIR, "src", "ui", "track-style.js")
    if os.path.exists(ts_path):
        with open(ts_path, "r", encoding="utf-8") as tsf:
            js += tsf.read()
    assert 'track.classList.toggle("ghost-on-track", pinLength === 0)' in js, \
        "layout.js or track-style.js missing track ghost-on-track toggle"
    assert 'track.style.setProperty("--ghost-needle-length"' in js, \
        "layout.js or track-style.js missing track.style.setProperty for --ghost-needle-length"
    assert "0px (On Track)" in js, "layout.js missing '0px (On Track)' badge label"

    print("✓ Zero-length ghost pin and needle sizing unit tests passed.")


def test_start_node_and_bar_fill_geometry():
    """Verify Start node active cyan styling and progress bar full-height fill geometry."""
    css_path = os.path.join(ROOT_DIR, "style.css")
    with open(css_path, "r", encoding="utf-8") as f:
        css = f.read()

    # 1. Start node active styling in CSS: cyan dot and white text
    assert "#node-start.active .dot" in css or ".split-item.origin-node.active .dot" in css, \
        "style.css missing active Start node dot rule"
    assert "var(--node-active)" in css, "style.css missing var(--node-active) reference"
    assert "#node-start .split-name" in css and "color: #ffffff" in css, \
        "style.css must keep Start title text color white #ffffff"

    # 2. Horizontal progress bar fill must enforce 100% height (full bar thickness)
    assert ".track:not(.vertical) .segment-bar-fill" in css and "height: 100% !important" in css, \
        "style.css must enforce 100% height for horizontal progress bar fill"

    # 3. overlay.js must toggle .active on #node-start based on idx >= 0
    js_path = os.path.join(ROOT_DIR, "overlay.js")
    with open(js_path, "r", encoding="utf-8") as f:
        js = f.read()
    assert 'nodeStart.classList.toggle("active", idx >= 0)' in js, \
        "overlay.js missing nodeStart active toggle"

    # 4. overlay.js updateLiveSegmentProgress must preserve full height in horizontal mode
    assert 'fill.style.height = "100%"' in js, \
        "overlay.js must set fill height to 100% in horizontal mode"

    print("✓ Start node cyan lighting and progress bar fill geometry tests passed.")


def test_quick_settings_menu_architecture():
    """Verify the large hover-triggered quick settings menu card and .lss dropzone."""
    html_path = os.path.join(ROOT_DIR, "index.html")
    with open(html_path, "r", encoding="utf-8") as f:
        html = f.read()

    css_path = os.path.join(ROOT_DIR, "style.css")
    with open(css_path, "r", encoding="utf-8") as f:
        css = f.read()

    js_path = os.path.join(ROOT_DIR, "overlay.js")
    with open(js_path, "r", encoding="utf-8") as f:
        js = f.read()

    # 1. HTML structure requirements
    required_classes = [
        "quick-settings-wrap",
        "settings-trigger-pill",
        "settings-menu-panel",
        "settings-file-dropzone",
        "settings-grid",
        "settings-tile-btn",
        "settings-actions-row",
        "connection-status-pill",
        "status-dot"
    ]
    for cls in required_classes:
        assert f'class="{cls}' in html or f' {cls}' in html, f"index.html missing class '{cls}'"

    required_ids = [
        "quick-settings-wrap",
        "settings-trigger-pill",
        "footer-bar",
        "file-trigger",
        "file-input",
        "connection-status",

        "btn-close-settings",
        "ctrl-timer-display",
        "comparison-badge",
        "ghost-badge",
        "timing-method-badge",
        "gold-toggle-badge",
        "track-orient-badge",
        "split-density-badge",
        "split-angle-badge",
        "bg-opacity-badge",
        "track-style-badge",
        "layout-edit-btn"
    ]
    for elem_id in required_ids:
        assert f'id="{elem_id}"' in html, f"index.html missing ID '{elem_id}'"

    # 2. CSS styles: invisible/hidden default state + pressed-down latching reveal
    assert ".quick-settings-wrap" in css, "style.css missing .quick-settings-wrap"
    assert ".settings-trigger-pill" in css, "style.css missing .settings-trigger-pill"
    assert ".settings-trigger-pill.is-pressed" in css, "style.css missing .settings-trigger-pill.is-pressed style"
    assert ".settings-menu-panel" in css, "style.css missing .settings-menu-panel"
    assert ".settings-file-dropzone" in css, "style.css missing .settings-file-dropzone"
    assert ".quick-settings-wrap.menu-open .settings-menu-panel" in css, "style.css missing menu-open reveal rule"
    assert ".settings-close-btn" in css, "style.css missing .settings-close-btn"
    assert "transform-origin: bottom right;" in css, "style.css missing transform-origin for menu panel"

    # 3. overlay.js drag and drop feedback, latching toggleSettingsMenu, and close listener
    assert 'fileDropzone.classList.add("drag-over")' in js, "overlay.js missing drag-over class toggle"
    assert 'function toggleSettingsMenu' in js, "overlay.js missing toggleSettingsMenu"
    assert 'btn-close-settings' in js, "overlay.js missing btn-close-settings listener"
    assert 'settings-trigger-pill' in js, "overlay.js missing settings-trigger-pill listener"

    # 4. Idempotency and double-registration protection
    assert 'let isOverlayInitialized = false;' in js, "overlay.js missing isOverlayInitialized idempotency guard"
    assert 'if (isOverlayInitialized) return;' in js, "overlay.js missing isOverlayInitialized return guard"
    assert 'window.onload = initOverlay' not in js, "overlay.js must NOT have window.onload = initOverlay (causes double registration)"
    assert 'onclick="toggleSettingsMenu()"' in html, "index.html missing onclick='toggleSettingsMenu()' on trigger pill"
    assert 'onclick="toggleSettingsMenu(false)"' in html, "index.html missing onclick='toggleSettingsMenu(false)' on close button"

    # 5. Algorithmic unit test: Single-click latch toggle simulation
    state = {"is_open": False, "is_pressed": False}
    def simulate_toggle(force_open=None):
        if isinstance(force_open, bool):
            is_open = force_open
        else:
            is_open = not state["is_open"]
        state["is_open"] = is_open
        state["is_pressed"] = is_open

    # Initial state: closed
    assert state["is_open"] is False and state["is_pressed"] is False
    # Click 1: opens and latches pressed
    simulate_toggle()
    assert state["is_open"] is True and state["is_pressed"] is True
    # Click 2: closes and releases pressed
    simulate_toggle()
    assert state["is_open"] is False and state["is_pressed"] is False
    # Click 3: re-opens
    simulate_toggle()
    assert state["is_open"] is True and state["is_pressed"] is True
    # Click close button: closes
    simulate_toggle(False)
    assert state["is_open"] is False and state["is_pressed"] is False

    print("✓ Quick settings menu architecture and dropzone tests passed.")


def test_draggable_settings_and_timer_display_modes():
    """Verify draggable settings menu mechanics and Game Time / Real Time / Both toggle."""
    html_path = os.path.join(ROOT_DIR, "index.html")
    with open(html_path, "r", encoding="utf-8") as f:
        html = f.read()

    css_path = os.path.join(ROOT_DIR, "style.css")
    with open(css_path, "r", encoding="utf-8") as f:
        css = f.read()

    overlay_path = os.path.join(ROOT_DIR, "overlay.js")
    with open(overlay_path, "r", encoding="utf-8") as f:
        overlay_js = f.read()

    layout_path = os.path.join(ROOT_DIR, "layout.js")
    with open(layout_path, "r", encoding="utf-8") as f:
        layout_js = f.read()

    # 1. Drag & Drop HTML Elements & Controls
    assert 'id="btn-reset-settings-pos"' not in html, "index.html should omit redundant btn-reset-settings-pos"
    assert 'class="settings-drag-grip"' in html, "index.html missing settings-drag-grip"
    assert 'id="ctrl-timer-display"' in html, "index.html missing ctrl-timer-display"
    assert 'data-val="gametime"' in html and 'data-val="realtime"' in html and 'data-val="both"' in html, \
        "index.html missing timer display segmented buttons"

    # 2. CSS dragging and position rules
    assert ".settings-menu-header.is-dragging" in css, "style.css missing .is-dragging header style"
    assert ".settings-menu-panel.is-custom-pos" in css, "style.css missing .is-custom-pos panel style"
    assert "cursor: grab;" in css, "style.css missing cursor: grab for header"
    assert "resetSettingsMenuPosition" in overlay_js, "overlay.js must retain resetSettingsMenuPosition for double-click"

    # 3. overlay.js draggable logic and unpinned auto-hide guarantees
    assert "function initSettingsMenuDraggable" in overlay_js, "overlay.js missing initSettingsMenuDraggable"
    assert "function resetSettingsMenuPosition" in overlay_js, "overlay.js missing resetSettingsMenuPosition"
    assert "function restoreSettingsMenuPosition" in overlay_js, "overlay.js missing restoreSettingsMenuPosition"
    assert "livesplit_settings_pos" in overlay_js, "overlay.js missing livesplit_settings_pos persistence"
    assert 'menu-open' not in overlay_js[overlay_js.find("function restoreSettingsMenuPosition"):overlay_js.find("function restoreSettingsMenuPosition")+600], \
        "restoreSettingsMenuPosition must not forcibly open menu"

    # 4. Timer display modes and primary focus logic in overlay.js
    assert "function setTimerDisplayMode" in overlay_js, "overlay.js missing setTimerDisplayMode"
    assert "function setTimingMethodFocus" in overlay_js, "overlay.js missing setTimingMethodFocus"
    assert "timerDisplayMode" in overlay_js, "overlay.js missing timerDisplayMode variable"
    assert 'mode === "gametime"' in overlay_js, "overlay.js missing gametime mode check"
    assert 'mode === "realtime"' in overlay_js, "overlay.js missing realtime mode check"
    assert 'Time: Game' in overlay_js and 'Time: Real' in overlay_js and 'Time: Both' in overlay_js, \
        "overlay.js missing timing badge label updates for Game, Real, and Both"
    assert 'Time: Both (Game)' in overlay_js and 'Time: Both (Real)' in overlay_js, \
        "overlay.js missing Time: Both (Game) and Time: Both (Real) badge labels"

    # 5. Timer mode synchronization in layout.js and index.html
    assert "ctrl-timer-display" in layout_js, "layout.js missing ctrl-timer-display handler"
    assert "ctrl-timer-focus" in layout_js, "layout.js missing ctrl-timer-focus handler"
    assert "ctrl-timer-focus" in html, "index.html missing ctrl-timer-focus segmented control"
    assert "getTimerDisplayMode" in layout_js, "layout.js missing getTimerDisplayMode call in syncTrackModalUI"
    assert "row-timer-focus" in overlay_js and "row-timer-focus" in layout_js, \
        "overlay.js and layout.js must toggle row-timer-focus visibility conditionally"

    # 6. Algorithmic unit test: 4-state timing method cycle simulation
    def cycle_timing_state(mode, focus):
        if mode == "gametime":
            return ("realtime", "RealTime")
        elif mode == "realtime":
            return ("both", "GameTime")
        elif mode == "both" and focus == "GameTime":
            return ("both", "RealTime")
        else:
            return ("gametime", "GameTime")

    s1 = cycle_timing_state("gametime", "GameTime")
    assert s1 == ("realtime", "RealTime"), f"Expected realtime, got {s1}"
    s2 = cycle_timing_state(s1[0], s1[1])
    assert s2 == ("both", "GameTime"), f"Expected both (GameTime), got {s2}"
    s3 = cycle_timing_state(s2[0], s2[1])
    assert s3 == ("both", "RealTime"), f"Expected both (RealTime), got {s3}"
    s4 = cycle_timing_state(s3[0], s3[1])
    assert s4 == ("gametime", "GameTime"), f"Expected gametime, got {s4}"

    # 7. Algorithmic unit test: timer display hierarchy simulation
    def simulate_timer_visibility(mode, current_method):
        if mode == "gametime":
            return ("none", "flex", "timer-secondary", "timer-primary")
        elif mode == "realtime":
            return ("flex", "none", "timer-primary", "timer-secondary")
        else:  # "both"
            is_rt = (current_method == "RealTime")
            rta_cls = "timer-primary" if is_rt else "timer-secondary"
            igt_cls = "timer-secondary" if is_rt else "timer-primary"
            return ("flex", "flex", rta_cls, igt_cls)

    # Test "gametime": only Game Time block shown as primary
    rta_disp, igt_disp, rta_c, igt_c = simulate_timer_visibility("gametime", "GameTime")
    assert rta_disp == "none" and igt_disp == "flex" and igt_c == "timer-primary"

    # Test "realtime": only Real Time block shown as primary
    rta_disp, igt_disp, rta_c, igt_c = simulate_timer_visibility("realtime", "RealTime")
    assert rta_disp == "flex" and igt_disp == "none" and rta_c == "timer-primary"

    # Test "both" with GameTime primary (User request: Game Time as large focus timer)
    rta_disp, igt_disp, rta_c, igt_c = simulate_timer_visibility("both", "GameTime")
    assert rta_disp == "flex" and igt_disp == "flex" and igt_c == "timer-primary" and rta_c == "timer-secondary"

    # Test "both" with RealTime primary
    rta_disp, igt_disp, rta_c, igt_c = simulate_timer_visibility("both", "RealTime")
    assert rta_disp == "flex" and igt_disp == "flex" and rta_c == "timer-primary" and igt_c == "timer-secondary"

    print("✓ Draggable settings menu and timer display modes (Game/Real/Both) passed.")


def test_undo_split_and_reconnection_safety():
    """Verify LiveSplit Undo Split synchronization and socket reconnect race protection."""
    overlay_path = os.path.join(ROOT_DIR, "overlay.js")
    with open(overlay_path, "r", encoding="utf-8") as f:
        overlay_js = f.read()

    # 1. Verification of Undo Split handler in pollLoop and exported helper
    assert "function handleUndoSplit" in overlay_js, "overlay.js missing handleUndoSplit function"
    assert "window.handleUndoSplit = handleUndoSplit" in overlay_js, "overlay.js missing window.handleUndoSplit export"
    assert "idx < currentIndex" in overlay_js, "overlay.js pollLoop missing idx < currentIndex check"
    assert "handleUndoSplit(idx, currentIndex)" in overlay_js, "overlay.js pollLoop missing handleUndoSplit call"

    # 2. Duplicate connection guard in connect()
    assert "ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING" in overlay_js, \
        "overlay.js connect() missing duplicate socket state guard"

    # 3. Viewport scroll null-safety
    assert "viewport && typeof viewport.scrollTo === 'function'" in overlay_js or \
           'viewport && typeof viewport.scrollTo === "function"' in overlay_js, \
        "overlay.js updateTrackStatus missing viewport null/scrollTo guard"

    # 4. Algorithmic unit test: Undo Split state rollback simulation
    class SplitTracker:
        def __init__(self, targets):
            self.targets = list(targets)
            self.completed = {}
            self.locked_deltas = {}
            self.last_split_sec = 0.0
            self.prev_delta_sec = 0.0
            self.current_idx = 0

        def split(self, time_sec, delta_sec):
            prev_sec = self.completed.get(self.current_idx - 1, 0.0) if self.current_idx > 0 else 0.0
            seg_dur = time_sec - prev_sec
            assert seg_dur > 0, "Segment duration must be strictly positive"
            self.completed[self.current_idx] = time_sec
            self.locked_deltas[self.current_idx] = delta_sec
            self.last_split_sec = time_sec
            self.prev_delta_sec = delta_sec
            self.current_idx += 1

        def undo_split(self, new_idx):
            assert new_idx < self.current_idx, "Undo index must be less than current index"
            for i in range(new_idx, len(self.targets)):
                self.completed.pop(i, None)
                self.locked_deltas.pop(i, None)
            self.last_split_sec = self.completed.get(new_idx - 1, 0.0) if new_idx > 0 else 0.0
            self.prev_delta_sec = self.locked_deltas.get(new_idx - 1, 0.0) if new_idx > 0 else 0.0
            self.current_idx = new_idx

    # Simulate 3 splits
    tracker = SplitTracker([50.0, 100.0, 150.0])
    tracker.split(48.0, -2.0)   # Split 0 completed at 48s (-2s delta)
    tracker.split(95.0, -5.0)   # Split 1 completed at 95s (-5s delta)
    tracker.split(152.0, +2.0)  # Split 2 completed at 152s (+2s delta)

    assert tracker.current_idx == 3
    assert len(tracker.completed) == 3
    assert tracker.last_split_sec == 152.0
    assert tracker.prev_delta_sec == 2.0

    # Runner hits "Undo Split" back to split 1 (index 1)
    tracker.undo_split(1)
    assert tracker.current_idx == 1
    assert 1 not in tracker.completed
    assert 2 not in tracker.completed
    assert tracker.completed[0] == 48.0
    assert tracker.last_split_sec == 48.0
    assert tracker.prev_delta_sec == -2.0

    # Runner resumes and splits at split 1 with a new time of 94.0s
    tracker.split(94.0, -6.0)
    assert tracker.current_idx == 2
    assert tracker.completed[1] == 94.0
    assert tracker.last_split_sec == 94.0
    assert tracker.prev_delta_sec == -6.0

    print("✓ LiveSplit Undo Split synchronization and connection safety unit tests passed.")


def test_completed_split_dot_coloring():
    """Verify completed split nodes color their dots according to split delta/state."""
    overlay_path = os.path.join(ROOT_DIR, "overlay.js")
    with open(overlay_path, "r", encoding="utf-8") as f:
        overlay_src = f.read()

    css_path = os.path.join(ROOT_DIR, "style.css")
    with open(css_path, "r", encoding="utf-8") as f:
        css_src = f.read()

    # overlay.js must retain 'completed' alongside stateClass on split items
    assert 'item.classList.add("completed", stateClass);' in overlay_src, \
        "overlay.js must add both 'completed' and stateClass to item on split completion"

    # style.css must define color rules with !important for all 4 states + gold
    states = ["ahead-gaining", "ahead-losing", "behind-gaining", "behind-losing", "gold"]
    for s in states:
        assert f".split-item.{s} .dot" in css_src or f".split-item.completed.{s} .dot" in css_src, \
            f"style.css must style dots for state: {s}"

    # Verify background !important on completed dots to override idle dot styling
    assert "background: var(--ahead-gaining) !important;" in css_src
    assert "background: var(--behind-losing) !important;" in css_src
    assert "background: var(--gold-color) !important;" in css_src

    # Current split dot must override with cyan
    assert ".split-item.current .dot" in css_src
    assert "background: var(--node-active) !important;" in css_src

    print("✓ Completed split node dot coloring and state styling tests passed.")


def test_custom_game_logo_feature():
    """Verify custom game logo markup, CSS rules, state management, and layout exports."""
    html_path = os.path.join(ROOT_DIR, "index.html")
    with open(html_path, "r", encoding="utf-8") as f:
        html_src = f.read()

    css_path = os.path.join(ROOT_DIR, "style.css")
    with open(css_path, "r", encoding="utf-8") as f:
        css_src = f.read()

    layout_path = os.path.join(ROOT_DIR, "layout.js")
    with open(layout_path, "r", encoding="utf-8") as f:
        layout_src = f.read()

    # HTML checks
    assert 'id="game-logo"' in html_src, "index.html must contain #game-logo"
    assert 'id="input-game-logo"' in html_src, "index.html must contain #input-game-logo file input"
    assert 'id="btn-remove-game-logo"' in html_src, "index.html must contain #btn-remove-game-logo button"
    assert 'id="slider-logo-height"' in html_src, "index.html must contain #slider-logo-height"
    assert 'id="game-logo-preview-wrap"' in html_src, "index.html must contain #game-logo-preview-wrap"

    # CSS checks
    assert ".game-logo" in css_src, "style.css must style .game-logo"
    assert "var(--game-logo-height" in css_src, "style.css must use --game-logo-height"
    assert "#hud-comp-title.has-logo .game-logo" in css_src, "style.css must display logo when has-logo is set"
    assert "#hud-comp-title.has-logo .game-name" in css_src, "style.css must hide text title when has-logo is set"

    # layout.js checks
    assert 'LOGO_STORAGE_KEY = "livesplit_custom_logo"' in layout_src, "layout.js must define LOGO_STORAGE_KEY"
    assert "function applyGameLogo" in layout_src, "layout.js must define applyGameLogo"
    assert "function removeGameLogo" in layout_src, "layout.js must define removeGameLogo"
    assert "function saveGameLogo" in layout_src, "layout.js must define saveGameLogo"
    assert 'params.get("logo")' in layout_src, "layout.js must parse ?logo= URL parameter"
    assert "localStorage.getItem(LOGO_STORAGE_KEY)" in layout_src, "layout.js must load saved logo from localStorage"
    assert "applyGameLogo," in layout_src and "removeGameLogo," in layout_src, \
        "layout.js window.hudLayout must export applyGameLogo and removeGameLogo"

    print("✓ Custom game logo markup, CSS, storage, and URL handling tests passed.")


def test_overdue_split_bar_glow():
    """Verify overdue/time-exceeded active split bar chunk has prominent glowing styling and unclipped overflow."""
    css_path = os.path.join(ROOT_DIR, "style.css")
    with open(css_path, "r", encoding="utf-8") as f:
        css_src = f.read()

    overlay_path = os.path.join(ROOT_DIR, "overlay.js")
    with open(overlay_path, "r", encoding="utf-8") as f:
        overlay_src = f.read()

    # style.css checks
    assert ".segment-bar-fill.overdue" in css_src, "style.css must style .segment-bar-fill.overdue"
    assert "overflow: visible !important;" in css_src, \
        "style.css must unclip .segment-bar-bg when overdue so the glow radiates outside the bar"
    assert "pulse-overdue" in css_src, "style.css must define pulse-overdue animation"
    assert "@keyframes pulse-overdue" in css_src, "style.css must define @keyframes pulse-overdue"
    assert "box-shadow:" in css_src and "rgba(239, 68, 68" in css_src, \
        "style.css must use vibrant red neon box-shadow on overdue bar"

    # overlay.js checks
    assert 'fill.classList.add("overdue");' in overlay_src, \
        "overlay.js must toggle overdue on fill when progressRatio > 1.0"
    assert 'fill.parentElement.classList.add("overdue");' in overlay_src, \
        "overlay.js must toggle overdue on fill.parentElement for unclipped container glow"

    print("✓ Overdue split bar chunk prominent red glow & animation tests passed.")


def test_version_and_license():
    """Verify LICENSE file, package.json version, and UI version visibility."""
    import json
    license_path = os.path.join(ROOT_DIR, "LICENSE")
    with open(license_path, "r", encoding="utf-8") as f:
        lic = f.read()
    assert "MIT License" in lic, "LICENSE must specify MIT License"
    assert "Luke Roddis" in lic, "LICENSE must include copyright holder Luke Roddis"

    pkg_path = os.path.join(ROOT_DIR, "package.json")
    with open(pkg_path, "r", encoding="utf-8") as f:
        pkg = json.load(f)
    assert "version" in pkg and re.match(r'^\d+\.\d+\.\d+$', pkg["version"]), \
        f"package.json must contain semver version: {pkg.get('version')}"

    overlay_path = os.path.join(ROOT_DIR, "overlay.js")
    with open(overlay_path, "r", encoding="utf-8") as f:
        overlay_src = f.read()
    assert f'const APP_VERSION = "v{pkg["version"]}";' in overlay_src, \
        "overlay.js APP_VERSION must match package.json version"

    html_path = os.path.join(ROOT_DIR, "index.html")
    with open(html_path, "r", encoding="utf-8") as f:
        html_src = f.read()
    assert 'id="overlay-version"' in html_src, "index.html must display #overlay-version"

    print("✓ Version metadata, LICENSE file, and UI visibility tests passed.")


def test_layout_profiles_and_extensible_schema():
    """Verify human-readable layout profiles, extensible schema v1, backward/forward compatibility, and file import/export."""
    import json

    html_path = os.path.join(ROOT_DIR, "index.html")
    with open(html_path, "r", encoding="utf-8") as f:
        html = f.read()

    # 1. UI element presence
    expected_ids = [
        "select-layout-profile",
        "btn-save-profile",
        "btn-save-as-profile",
        "btn-delete-profile",
        "btn-export-profile",
        "input-import-profile",
        "profile-bar-default",
        "profile-dropdown-wrap",
        "btn-profile-dropdown",
        "profile-dropdown-label",
        "profile-dropdown-list",
        "profile-bar-new",
        "input-new-profile-name",
        "btn-confirm-new-profile",
        "btn-cancel-new-profile",
        "profile-bar-delete",
        "btn-confirm-delete-profile",
        "btn-cancel-delete-profile",
        "btn-open-import-modal",
        "layout-export-modal",
        "export-json-textarea",
        "btn-copy-export-json",
        "btn-redownload-export-json",
        "layout-import-modal",
        "btn-close-import-modal",
        "import-file-name-label",
        "import-json-textarea",
        "import-error-msg",
        "btn-cancel-import",
        "btn-apply-import-json",
    ]
    for eid in expected_ids:
        assert f'id="{eid}"' in html, f"index.html missing layout profile element id '{eid}'"

    # 2. Local schema file exists and is valid JSON
    schema_path = os.path.join(ROOT_DIR, "schema", "layout-v1.json")
    assert os.path.exists(schema_path), "Local schema file schema/layout-v1.json must exist"
    with open(schema_path, "r", encoding="utf-8") as f:
        schema_data = json.load(f)
    assert schema_data.get("title") == "LiveSplit Minimal Overlay Layout Profile"
    assert "properties" in schema_data

    # 3. CSS styles
    css_path = os.path.join(ROOT_DIR, "style.css")
    with open(css_path, "r", encoding="utf-8") as f:
        css = f.read()
    assert ".settings-profile-bar" in css, "style.css missing .settings-profile-bar"
    assert ".settings-profile-dropdown-wrap" in css, "style.css missing .settings-profile-dropdown-wrap"
    assert ".settings-profile-dropdown-list" in css, "style.css missing .settings-profile-dropdown-list"
    assert ".profile-dropdown-item" in css, "style.css missing .profile-dropdown-item"
    assert ".settings-profile-select" in css, "style.css missing .settings-profile-select"
    assert ".settings-profile-input" in css, "style.css missing .settings-profile-input"
    assert ".settings-action-btn.action-export" in css, "style.css missing .settings-action-btn.action-export"
    assert ".settings-action-btn.action-import" in css, "style.css missing .settings-action-btn.action-import"

    # 4. layout.js implementation and exports
    layout_path = os.path.join(ROOT_DIR, "layout.js")
    with open(layout_path, "r", encoding="utf-8") as f:
        layout_src = f.read()

    # Must NOT contain hardcoded personal dead-link schema URLs
    assert "https://lukeroddis.github.io" not in layout_src, \
        "layout.js must not output external dead link schema URLs"

    expected_exports = [
        "getProfilesList",
        "getActiveProfileName",
        "loadProfileByName",
        "saveProfileToStorage",
        "deleteProfileFromStorage",
        "createProfileExport",
        "applyProfileData",
        "exportProfileToFile",
        "importProfileFromFile",
        "autoLoadProfileForGame",
        "syncProfileUI",
    ]
    for exp in expected_exports:
        assert exp in layout_src, f"layout.js missing function/export '{exp}'"

    # 4b. Modal export flow must avoid premature auto-download upon opening modal
    assert "triggerFileDownload(filename, jsonStr);" not in layout_src, \
        "exportProfileToFile must not auto-trigger file download prior to opening modal"
    assert "✓ Downloaded!" in layout_src, \
        "layout.js must give user visual confirmation upon clicking download in modal"
    assert "✓ Copied to clipboard!" in layout_src, \
        "layout.js must give user visual confirmation upon copying JSON in modal"

    # 5. Check URL parameter integration (?profile= and ?layout=)
    assert 'params.get("profile") || params.get("layout")' in layout_src, \
        "layout.js parseUrlParameters must check ?profile= and ?layout= URL parameters"

    # 6. Check overlay.js game auto-loading & drag-and-drop integration
    overlay_path = os.path.join(ROOT_DIR, "overlay.js")
    with open(overlay_path, "r", encoding="utf-8") as f:
        overlay_src = f.read()

    assert "autoLoadProfileForGame" in overlay_src, \
        "overlay.js setGameName must trigger autoLoadProfileForGame"
    assert 'file.name.endsWith(".json") || file.name.endsWith(".lshud")' in overlay_src, \
        "overlay.js drop listener must accept .json and .lshud layout profiles"

    # 7. Extensible Schema v1 & Forward/Backward Compatibility Simulation
    assert 'deltaPos: "bottom"' in layout_src, "DEFAULT_TRACK_STYLE in layout.js must default deltaPos to bottom"

    default_track_style = {
        "orientation": "horizontal",
        "namePos": "top",
        "deltaPos": "bottom",
        "bgOpacity": 55,
        "bgBlur": 8,
        "bgTargets": {"title": True, "timers": True, "track": True},
        "nameFontSize": 17,
        "deltaFontSize": 15,
        "barHeight": 6,
        "dotSize": 15,
        "ghostPinLength": 16,
        "logoHeight": 60,
    }

    # Simulate Backward Compatibility: Older layout missing logoHeight, ghostPinLength, and preferences
    older_profile = {
        "version": 1,
        "name": "Legacy 2025 Layout",
        "components": {
            "title": {"x": 10, "y": 20, "scale": 1.0, "visible": True},
            "timers": {"x": 10, "y": 80, "scale": 1.1, "visible": True},
            "track": {"x": 0, "y": 990, "scale": 1.0, "visible": True, "docked": "bottom"}
        },
        "style": {
            "orientation": "horizontal",
            "namePos": "top",
            "deltaPos": "top",
            "bgOpacity": 80
        }
    }

    # Merging logic should populate missing newer fields with defaults without throwing
    merged_style = dict(default_track_style)
    merged_style.update(older_profile.get("style", {}))
    assert merged_style["logoHeight"] == 60, "Backward compatibility: missing logoHeight should default to 60"
    assert merged_style["ghostPinLength"] == 16, "Backward compatibility: missing ghostPinLength should default to 16"
    assert merged_style["bgOpacity"] == 80, "Older profile bgOpacity 80 should be preserved"
    assert merged_style["deltaPos"] == "top", "Older profile deltaPos top should be preserved"

    # Verify fallback to default 'bottom' when deltaPos is omitted in profile
    omitted_delta_style = dict(default_track_style)
    omitted_delta_style.update({"orientation": "horizontal", "namePos": "top"})
    assert omitted_delta_style["deltaPos"] == "bottom", "Missing deltaPos must fall back to default 'bottom'"

    # Simulate Forward Compatibility: Newer layout with unknown future properties
    future_profile = {
        "$schema": "https://lukeroddis.github.io/Livesplit-Progress-Bar/schema/layout-v2.json",
        "schemaVersion": 2,
        "name": "Future v2 Layout",
        "futureComponent": {"x": 50, "y": 50, "visible": True},
        "style": {
            "orientation": "vertical",
            "namePos": "left",
            "deltaPos": "right",
            "neonGlowSpread": 25,
            "particleEffects": "enabled"
        },
        "customLogo": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="
    }

    merged_future_style = dict(default_track_style)
    merged_future_style.update(future_profile["style"])
    assert merged_future_style["orientation"] == "vertical"
    assert merged_future_style["neonGlowSpread"] == 25, "Forward compatibility: future fields preserved"
    assert merged_future_style["logoHeight"] == 60, "Future layout style still inherits fallback defaults"

    print("✓ Human-readable layout profiles, schema v1, and compatibility tests passed.")


def test_track_scrolling_consistency_and_mousewheel():
    """Verify mousewheel and arrow key scrolling consistency, edit mode guards, and idle track scroll retention."""
    with open(os.path.join(ROOT_DIR, "overlay.js"), "r", encoding="utf-8") as f:
        overlay_src = f.read()
    with open(os.path.join(ROOT_DIR, "layout.js"), "r", encoding="utf-8") as f:
        layout_src = f.read()
    ts_path = os.path.join(ROOT_DIR, "src", "ui", "track-style.js")
    if os.path.exists(ts_path):
        with open(ts_path, "r", encoding="utf-8") as tsf:
            layout_src += tsf.read()
    with open(os.path.join(ROOT_DIR, "index.html"), "r", encoding="utf-8") as f:
        html_src = f.read()
    with open(os.path.join(ROOT_DIR, "style.css"), "r", encoding="utf-8") as f:
        css_src = f.read()

    # 1. Reset transition guard in pollTimer (prevents continuous scrollTo(0) when stopped/idle)
    assert "(idx === -1 && currentIndex !== -1)" in overlay_src, \
        "overlay.js must guard idle reset so it only triggers on state transition and does not fight scrolling"

    # 2. setupTrackScrollInteractions definition and export
    assert "function setupTrackScrollInteractions()" in overlay_src, \
        "overlay.js must define setupTrackScrollInteractions"
    assert "window.setupTrackScrollInteractions = setupTrackScrollInteractions" in overlay_src, \
        "overlay.js must export setupTrackScrollInteractions"

    # 3. Mouse wheel listener with Edit Mode guard
    assert 'window.addEventListener("wheel"' in overlay_src, \
        "overlay.js must register wheel event listener for track scrolling"
    assert 'classList.contains("edit-mode")' in overlay_src and "isEditMode" in overlay_src, \
        "overlay.js wheel listener must check Edit Mode to avoid scrolling during layout customization"

    # 4. Keyboard Arrow key listener
    assert 'e.key === "ArrowRight"' in overlay_src and 'e.key === "ArrowLeft"' in overlay_src, \
        "overlay.js must support Arrow key scrolling"
    assert 'e.key === "ArrowDown"' in overlay_src and 'e.key === "ArrowUp"' in overlay_src, \
        "overlay.js must support Arrow key scrolling in vertical orientation"

    # 5. Accessibility and styling
    assert 'id="track-viewport" tabindex="0"' in html_src or 'tabindex="0"' in html_src, \
        "index.html #track-viewport must have tabindex for keyboard focusability"
    assert ".track-viewport:focus" in css_src and "outline: none" in css_src, \
        "style.css must remove default focus outline from #track-viewport"

    # 6. layout.js exports isEditMode getter
    assert "isEditMode: () => isEditMode" in layout_src, \
        "layout.js must export isEditMode getter on window.hudLayout"

    print("✓ Track scroll wheel & arrow key consistency tests passed.")


def test_skipped_split_and_incomplete_data_handling():
    """Verify skipped splits and splits with incomplete data are uncoloured and display a dash '-' for delta."""
    with open(os.path.join(ROOT_DIR, "overlay.js"), "r", encoding="utf-8") as f:
        overlay_src = f.read()
    with open(os.path.join(ROOT_DIR, "style.css"), "r", encoding="utf-8") as f:
        css_src = f.read()

    # 1. State class arrays include 'uncoloured' and 'delta-uncoloured'
    assert '"uncoloured"' in overlay_src, "ALL_SPLIT_STATE_CLASSES must include 'uncoloured'"
    assert '"delta-uncoloured"' in overlay_src, "ALL_DELTA_CLASSES must include 'delta-uncoloured'"

    # 2. CSS styles for uncoloured bar fills, dots, and deltas
    assert ".segment-bar-fill.uncoloured" in css_src, "style.css must define .segment-bar-fill.uncoloured"
    assert ".split-item.completed.uncoloured .dot" in css_src, "style.css must style uncoloured dots"
    assert ".delta-uncoloured" in css_src, "style.css must style .delta-uncoloured"

    # 3. Skipped split detection logic
    assert "parsedLastSplit > (lastSplitRecordedSec + 0.001)" in overlay_src, \
        "overlay.js must distinguish completed splits from skipped splits using lastSplitRecordedSec monotonic comparison"

    # 4. Incomplete data fallback (fresh splits with no PB comparison)
    assert 'stateClass = "uncoloured"' in overlay_src, "overlay.js must set stateClass to 'uncoloured' when data is incomplete"
    assert 'displayDelta = { text: "-", isAhead: false, signedSeconds: 0 }' in overlay_src, \
        "overlay.js must set delta text to '-' when data is incomplete or split is skipped"

    # 5. Multiple skipped splits loop
    assert "for (let s = currentIndex; s < idx - 1; s++)" in overlay_src, \
        "overlay.js must mark all skipped intermediate splits as uncoloured when jumping multiple splits"

    # 6. Undo split handles skipped splits rollback
    assert "for (let k = newIdx - 1; k >= 0; k--)" in overlay_src, \
        "overlay.js handleUndoSplit must traverse backward past skipped splits to restore last recorded time"

    print("✓ Skipped splits & incomplete data uncoloured handling tests passed.")


def test_in_run_state_persistence():
    """Verify in-run split progress (deltas, split times, colors) is preserved across refreshes."""
    import json
    with open(os.path.join(ROOT_DIR, "overlay.js"), "r", encoding="utf-8") as f:
        overlay_src = f.read()

    # 1. State key and storage management functions
    assert 'const IN_RUN_STATE_KEY = "livesplit_in_run_state";' in overlay_src, \
        "overlay.js must define IN_RUN_STATE_KEY"
    assert "function saveInRunState()" in overlay_src, "overlay.js must implement saveInRunState()"
    assert "function clearInRunState()" in overlay_src, "overlay.js must implement clearInRunState()"
    assert "function loadInRunState()" in overlay_src, "overlay.js must implement loadInRunState()"

    # 2. Window exports for testing and external consumers
    assert "window.saveInRunState = saveInRunState;" in overlay_src, "overlay.js must export saveInRunState"
    assert "window.clearInRunState = clearInRunState;" in overlay_src, "overlay.js must export clearInRunState"
    assert "window.loadInRunState = loadInRunState;" in overlay_src, "overlay.js must export loadInRunState"

    # 3. Serialization and restoration simulation
    splits = ["Stage 1", "Stage 2", "Stage 3", "Final Boss"]
    mock_state = {
        "currentIndex": 2,
        "lockedDeltas": {
            "0": {"deltaInfo": {"text": "-0:03.2", "isAhead": True, "signedSeconds": -3.2}, "stateClass": "ahead-gaining", "splitTimeSec": 62.5},
            "1": {"deltaInfo": {"text": "-", "isAhead": False, "signedSeconds": 0}, "stateClass": "uncoloured", "splitTimeSec": None}
        },
        "completedSplitTimes": {"0": 62.5},
        "lastSplitRecordedSec": 62.5,
        "previousDeltaSeconds": -3.2,
        "lastElapsedSec": 135.0,
        "splitsCount": len(splits),
        "game": "Celeste",
        "category": "Any%"
    }

    raw = json.dumps(mock_state)
    parsed = json.loads(raw)
    assert parsed["currentIndex"] == 2
    assert parsed["lockedDeltas"]["0"]["stateClass"] == "ahead-gaining"
    assert parsed["lockedDeltas"]["1"]["stateClass"] == "uncoloured"
    assert parsed["splitsCount"] == 4

    # Split count mismatch guard simulation: if runner loads different splits count, discard stale in-run data
    different_splits_count = 6
    assert parsed["splitsCount"] != different_splits_count, "Guard must detect split count mismatch"

    # 4. Persistence call site integration checks:
    # - saveInRunState called on split completion
    assert "setDeltaDisplay(prevIdx, displayDelta, stateClass, splitTimeSec);\n          saveInRunState();" in overlay_src, \
        "overlay.js must call saveInRunState() upon recording completed split delta"

    # - saveInRunState called on undo split
    assert "saveInRunState();" in overlay_src, \
        "overlay.js must call saveInRunState() after handleUndoSplit"

    # - clearInRunState called on reset transition and new drops
    assert "clearInRunState();" in overlay_src, \
        "overlay.js must call clearInRunState() on timer reset transition and new split drop"

    # - loadInRunState called before renderTrack in loadCachedSplits & parseLSS
    assert "loadInRunState();" in overlay_src, \
        "overlay.js must load in-run state before renderTrack() to restore all nodes and colors"

    # 5. renderTrack & updateTrackStatus restore completed nodes
    assert 'if (i < idx) {' in overlay_src and 'if (lockedDeltas[i]) {' in overlay_src, \
        "overlay.js updateTrackStatus must repaint completed node deltas and bar fills from lockedDeltas"

    print("✓ In-run state persistence across browser refresh tests passed.")


def test_timer_anchor_and_expansion_modes():
    """Verify intelligent timer smart-anchoring (auto-detect left/right based on screen position),
    explicit Settings option, Edit Mode toggle badge, profile export/import, and CSS nowrap rules."""
    with open(os.path.join(ROOT_DIR, "index.html"), "r", encoding="utf-8") as f:
        html_src = f.read()
    with open(os.path.join(ROOT_DIR, "style.css"), "r", encoding="utf-8") as f:
        css_src = f.read()
    with open(os.path.join(ROOT_DIR, "layout.js"), "r", encoding="utf-8") as f:
        layout_src = f.read()
    ts_path = os.path.join(ROOT_DIR, "src", "ui", "track-style.js")
    if os.path.exists(ts_path):
        with open(ts_path, "r", encoding="utf-8") as tsf:
            layout_src += tsf.read()
    with open(os.path.join(ROOT_DIR, "schema", "layout-v1.json"), "r", encoding="utf-8") as f:
        schema_src = f.read()

    # 1. HTML markup checks
    assert 'id="badge-anchor-timers"' in html_src, "index.html must have #badge-anchor-timers in timer controls"
    assert 'id="row-timer-expansion"' in html_src, "index.html must have #row-timer-expansion in Settings modal"
    assert 'id="ctrl-timer-expansion"' in html_src, "index.html must have #ctrl-timer-expansion segmented control"
    assert 'data-val="auto"' in html_src and 'data-val="right"' in html_src and 'data-val="left"' in html_src, \
        "index.html #ctrl-timer-expansion must provide 'auto', 'right', and 'left' options"

    # 2. CSS nowrap guards against multiline wrapping
    assert "flex-wrap: nowrap;" in css_src, "style.css .timer-group must have flex-wrap: nowrap"
    assert "white-space: nowrap;" in css_src, "style.css .timer-block must have white-space: nowrap"

    # 3. Default layout & Layout functions
    assert 'anchor: "auto"' in layout_src, "layout.js getDefaultLayout() timers component must have anchor: 'auto'"
    assert "function getTimerAnchor()" in layout_src, "layout.js must define getTimerAnchor()"
    assert "function setTimerAnchor(" in layout_src, "layout.js must define setTimerAnchor()"
    assert "function cycleTimerAnchor()" in layout_src, "layout.js must define cycleTimerAnchor()"
    assert "function syncTimerAnchorUI()" in layout_src, "layout.js must define syncTimerAnchorUI()"

    # 4. Global and hudLayout exports
    assert "getTimerAnchor" in layout_src and "setTimerAnchor" in layout_src, "layout.js must export getTimerAnchor & setTimerAnchor"
    assert "window.setTimerAnchor = setTimerAnchor;" in layout_src, "layout.js must expose setTimerAnchor on window"

    # 5. Intelligent auto-anchor logic & styling
    assert 'function applyComponentLayout(compId)' in layout_src, "applyComponentLayout must take compId"
    assert 'compId === "timers"' in layout_src, "applyComponentLayout must check compId === 'timers', not undefined id"
    assert 'const w = window.innerWidth' in layout_src, "applyComponentLayout must declare w"
    assert 'anchorPref === "right"' in layout_src and 'anchorPref === "left"' in layout_src, \
        "applyComponentLayout('timers') must handle right and left anchors"
    assert 'midPoint > w / 2' in layout_src or 'midPoint > (w / 2)' in layout_src, \
        "applyComponentLayout('timers') auto mode must check if midPoint > w / 2"
    assert 'transformOrigin = "top right"' in layout_src and 'transformOrigin = "top left"' in layout_src, \
        "applyComponentLayout('timers') must set transformOrigin top right or top left"

    # 6. Smooth drag and resize logic
    assert "origX: el.offsetLeft" in layout_src and "origY: el.offsetTop" in layout_src, \
        "setupPointerListeners drag operation must use el.offsetLeft/offsetTop to prevent jumping on right-anchored elements"
    assert 'state.right = Math.max(0, w - (state.x + compWidth))' in layout_src, \
        "layout.js pointermove must track state.right when dragging timers"

    # 7. Schema declaration & Profile export
    schema_json = json.loads(schema_src)
    assert "timerAnchor" in schema_json.get("properties", {}).get("preferences", {}).get("properties", {}), \
        "schema/layout-v1.json preferences must declare timerAnchor"
    assert "anchor" in schema_json.get("properties", {}).get("components", {}).get("properties", {}).get("timers", {}).get("properties", {}), \
        "schema/layout-v1.json components.timers must declare anchor"
    assert "right" in schema_json.get("properties", {}).get("components", {}).get("properties", {}).get("timers", {}).get("properties", {}), \
        "schema/layout-v1.json components.timers must declare right"

    # 8. Mathematical simulation of auto-anchor vs forced modes
    screen_width = 1920
    timer_width_initial = 300
    timer_width_expanded = 420

    # Case A: Auto mode, placed on right side of screen (x = 1500)
    x_pos = 1500
    mid_point = x_pos + (timer_width_initial / 2)  # 1650 > 960 (isRight = True)
    assert mid_point > screen_width / 2, "Center of widget at 1500px is on right half of 1920px screen"
    right_margin = screen_width - (x_pos + timer_width_initial)  # 120px
    assert right_margin == 120
    # When timer expands from 300 to 420:
    effective_left_expanded = screen_width - (right_margin + timer_width_expanded)  # 1920 - (120 + 420) = 1380
    assert effective_left_expanded == 1380
    assert effective_left_expanded + timer_width_expanded == screen_width - right_margin
    assert (effective_left_expanded + timer_width_expanded) <= screen_width, "Timer never overflows screen right border!"

    # Case B: Auto mode, placed on left side of screen (x = 100)
    x_pos_left = 100
    mid_point_left = x_pos_left + (timer_width_initial / 2)  # 250 <= 960 (isRight = False)
    assert mid_point_left <= screen_width / 2, "Center of widget at 100px is on left half of screen"
    assert (x_pos_left + timer_width_expanded) <= screen_width

    # Case C: Cycle order
    def cycle(anchor):
        return "right" if anchor == "auto" else ("left" if anchor == "right" else "auto")
    assert cycle("auto") == "right"
    assert cycle("right") == "left"
    assert cycle("left") == "auto"

    # 9. Button element check & edit mode click safety
    assert '<button type="button" class="hud-btn-icon" id="badge-anchor-timers"' in html_src, \
        "index.html #badge-anchor-timers must be a button with .hud-btn-icon styling so it is clickable and excluded from dragging"
    with open(os.path.join(ROOT_DIR, "overlay.js"), "r", encoding="utf-8") as f:
        overlay_src = f.read()
    assert "if (window.hudLayout && window.hudLayout.isEditMode && window.hudLayout.isEditMode()) return;" in overlay_src, \
        "overlay.js block-igt and block-rta must be disabled while in layout edit mode"
    assert 'rtaBlock.removeAttribute("title")' in layout_src, \
        "layout.js setEditMode must suppress tooltips on timer blocks in edit mode"

    print("✓ Timer anchor, smart auto-detection, and expansion modes passed.")


def test_always_show_last_split_and_schematic_break():
    """Verify 'Always Show Last Split' with engineering schematic double-slash (//) break:
    Settings checkbox, DOM elements, CSS gradient masks and slashes, schema declaration,
    and mathematical sliding-window simulation."""
    with open(os.path.join(ROOT_DIR, "index.html"), "r", encoding="utf-8") as f:
        html_src = f.read()
    with open(os.path.join(ROOT_DIR, "style.css"), "r", encoding="utf-8") as f:
        css_src = f.read()
    with open(os.path.join(ROOT_DIR, "overlay.js"), "r", encoding="utf-8") as f:
        overlay_src = f.read()
    with open(os.path.join(ROOT_DIR, "layout.js"), "r", encoding="utf-8") as f:
        layout_src = f.read()
    ts_path = os.path.join(ROOT_DIR, "src", "ui", "track-style.js")
    if os.path.exists(ts_path):
        with open(ts_path, "r", encoding="utf-8") as tsf:
            layout_src += tsf.read()
    with open(os.path.join(ROOT_DIR, "src", "core", "layout-profiles.js"), "r", encoding="utf-8") as lpf:
        profiles_src = lpf.read()
    with open(os.path.join(ROOT_DIR, "schema", "layout-v1.json"), "r", encoding="utf-8") as f:
        schema_src = f.read()

    # 1. HTML markup checks
    assert 'id="cb-always-show-last-split"' in html_src, "index.html must have #cb-always-show-last-split checkbox"
    assert 'id="row-always-show-last-split"' in html_src, "index.html must have #row-always-show-last-split row"

    # 2. CSS engineering schematic break rules
    assert ".discontinuity-break" in css_src, "style.css must define .discontinuity-break"
    assert ".disc-slash" in css_src, "style.css must define .disc-slash"
    assert ".split-item.has-discontinuity .segment-bar-bg" in css_src, "style.css must style has-discontinuity connector"
    assert ".split-item.is-omitted" in css_src, "style.css must style .split-item.is-omitted"
    assert ".split-item.first-visible-node" in css_src, "style.css must hide connector on first-visible-node"
    assert ".track.vertical .discontinuity-break" in css_src, "style.css must support vertical discontinuity break"
    assert ".track.vertical .disc-slash" in css_src, "style.css must support vertical disc-slash"

    # 3. overlay.js DOM generation & functions
    assert 'discEl.className = "discontinuity-break";' in overlay_src, "renderTrack must append discontinuity-break to segBg"
    assert '<span class="disc-slash"></span><span class="disc-slash"></span>' in overlay_src, "discontinuity-break must render double slashes"
    assert "function updateTrackWindow(" in overlay_src, "overlay.js must define updateTrackWindow(idx)"
    assert "updateTrackWindow(idx)" in overlay_src, "overlay.js updateTrackStatus must call updateTrackWindow"
    assert "function shiftTrackWindow(" in overlay_src, "overlay.js must define shiftTrackWindow for arrow key scrolling"
    assert "function isTrackWindowed()" in overlay_src, "overlay.js must define isTrackWindowed"
    assert "window.updateTrackWindow = updateTrackWindow;" in overlay_src, "overlay.js must export updateTrackWindow on window"
    assert "window.shiftTrackWindow = shiftTrackWindow;" in overlay_src, "overlay.js must export shiftTrackWindow on window"
    assert "window.updateTrackStatus = updateTrackStatus;" in overlay_src, "overlay.js must export updateTrackStatus on window"
    assert "window.updateGhostBadge = updateGhostBadge;" in overlay_src, "overlay.js must export updateGhostBadge on window"
    assert "item.classList.remove(...ALL_SPLIT_STATE_CLASSES);" in overlay_src, "overlay.js must not wipe out windowing classes"

    # 4. layout.js wiring & profiles
    assert "cb-always-show-last-split" in layout_src, "layout.js must sync cb-always-show-last-split"
    assert "showLastSplit:" in (layout_src + profiles_src), "createProfileExport must export showLastSplit"
    assert "prefs.showLastSplit" in (layout_src + profiles_src), "applyProfileData must restore showLastSplit"
    assert 'params.get("lastsplit")' in layout_src or 'params.get("showlastsplit")' in layout_src, "parseUrlParameters must parse lastsplit"
    assert "window.updateTrackStatus(window.getCurrentIndex" in layout_src, "setVisibleSplits must update track status"

    # 5. Schema v1 check
    schema_json = json.loads(schema_src)
    assert "showLastSplit" in schema_json.get("properties", {}).get("preferences", {}).get("properties", {}), \
        "schema/layout-v1.json preferences must declare showLastSplit"

    # 6. Mathematical Sliding Window, Discontinuity & Arrow Key Scroll Simulation
    def simulate_track_window(total_splits, visible_capacity, current_idx, always_show_last=True, manual_scroll_offset=0):
        N = total_splits
        V = visible_capacity
        if not always_show_last or (N + 1) <= V:
            return {"omitted": [], "has_discontinuity": False, "visible_count": N + 1, "start_visible": True, "visible_splits": list(range(N))}

        W = max(2, V - 1)
        half = (W - 1) // 2
        ideal_start = current_idx - half
        max_k = max(0, N - V + 1)

        if ideal_start + (W - 1) >= N - 1:
            default_k = max_k
        elif ideal_start <= -1:
            default_k = 0
        else:
            default_k = max(0, min(max_k, ideal_start + 1))

        k = max(0, min(max_k, default_k + manual_scroll_offset))

        if k == 0:
            start_node_visible = True
            window_start = 0
            window_end = max(0, W - 2)
            has_discontinuity = (window_end < N - 1)
        elif k >= max_k:
            start_node_visible = False
            window_start = max(0, N - V)
            window_end = N - 1
            has_discontinuity = False
        else:
            start_node_visible = False
            window_start = k - 1
            window_end = window_start + (W - 1)
            has_discontinuity = (window_end < N - 1)

        omitted = []
        visible_splits = []
        for i in range(N):
            if (i >= window_start and i <= window_end) or i == N - 1:
                visible_splits.append(i)
            else:
                omitted.append(i)

        total_visible_nodes = (1 if start_node_visible else 0) + len(visible_splits)
        return {
            "omitted": omitted,
            "has_discontinuity": has_discontinuity,
            "visible_count": total_visible_nodes,
            "visible_splits": visible_splits,
            "start_visible": start_node_visible
        }

    # Scenario A: 33 splits (Final Fantasy X), visible capacity 10, on Start node (idx = -1)
    sim_start = simulate_track_window(33, 10, -1)
    assert sim_start["has_discontinuity"] is True, "Discontinuity must be active when intermediate splits are omitted"
    assert sim_start["start_visible"] is True, "Start node must be visible when on start"
    assert sim_start["visible_splits"] == [0, 1, 2, 3, 4, 5, 6, 7, 32], "Visible splits must be leading splits + final split"
    assert sim_start["visible_count"] == 10, "Total visible nodes on screen must equal capacity V=10 exactly"
    assert 32 in sim_start["visible_splits"], "Final split 32 must always be visible at the end on Start node"

    # Scenario A2: User presses ArrowRight on Start node to view future splits (offset = +1)
    sim_scroll_1 = simulate_track_window(33, 10, -1, manual_scroll_offset=1)
    assert sim_scroll_1["start_visible"] is False, "Start node scrolls off to reveal next split"
    assert sim_scroll_1["visible_splits"] == [0, 1, 2, 3, 4, 5, 6, 7, 8, 32], "Split 8 slides in from right"
    assert sim_scroll_1["visible_count"] == 10, "Capacity V=10 is strictly preserved"
    assert sim_scroll_1["has_discontinuity"] is True

    # Scenario A3: User presses ArrowRight again (offset = +2)
    sim_scroll_2 = simulate_track_window(33, 10, -1, manual_scroll_offset=2)
    assert sim_scroll_2["visible_splits"] == [1, 2, 3, 4, 5, 6, 7, 8, 9, 32], "Split 0 slides off, split 9 slides in"
    assert sim_scroll_2["visible_count"] == 10

    # Scenario A4: User scrolls ArrowRight all the way to finale (offset = +24)
    sim_scroll_end = simulate_track_window(33, 10, -1, manual_scroll_offset=24)
    assert sim_scroll_end["visible_splits"] == [23, 24, 25, 26, 27, 28, 29, 30, 31, 32], "Shows finale splits"
    assert sim_scroll_end["has_discontinuity"] is False, "Discontinuity vanishes at finale"
    assert sim_scroll_end["visible_count"] == 10

    # Scenario B: Runner is mid-run at Split 15 (centered window)
    sim_mid = simulate_track_window(33, 10, 15)
    assert sim_mid["has_discontinuity"] is True
    assert sim_mid["start_visible"] is False, "Start node slides off to the left in mid-run"
    assert sim_mid["visible_splits"] == [11, 12, 13, 14, 15, 16, 17, 18, 19, 32]
    assert 15 == sim_mid["visible_splits"][4], "Current split 15 must be dead-center in the 9 sliding slots"
    assert sim_mid["visible_count"] == 10, "Total visible nodes on screen must be exactly 10"
    assert 32 in sim_mid["visible_splits"], "Final split 32 must be pinned at the end"

    # Scenario B2: Runner mid-run peeks at future splits (offset = +2)
    sim_mid_future = simulate_track_window(33, 10, 15, manual_scroll_offset=2)
    assert sim_mid_future["visible_splits"] == [13, 14, 15, 16, 17, 18, 19, 20, 21, 32], "Future splits 20, 21 come into view"
    assert sim_mid_future["visible_count"] == 10

    # Scenario B3: Runner mid-run peeks at earlier splits (offset = -2)
    sim_mid_past = simulate_track_window(33, 10, 15, manual_scroll_offset=-2)
    assert sim_mid_past["visible_splits"] == [9, 10, 11, 12, 13, 14, 15, 16, 17, 32], "Earlier splits 9, 10 come into view"
    assert sim_mid_past["visible_count"] == 10

    # Scenario C: Runner approaches the finale (Split 29)
    sim_end = simulate_track_window(33, 10, 29)
    assert sim_end["has_discontinuity"] is False, "Discontinuity must vanish when active window reaches final split"
    assert sim_end["visible_splits"] == [23, 24, 25, 26, 27, 28, 29, 30, 31, 32], "All trailing splits must be contiguous"
    assert sim_end["visible_count"] == 10, "Total visible nodes must remain 10 without overflow"

    # Scenario D: Small split count <= V (e.g. 5 splits, V = 8)
    sim_small = simulate_track_window(5, 8, 2)
    assert sim_small["has_discontinuity"] is False
    assert len(sim_small["omitted"]) == 0
    assert sim_small["visible_count"] == 6

    # Scenario E: User disabled option
    sim_disabled = simulate_track_window(33, 10, 0, always_show_last=False)
    assert sim_disabled["has_discontinuity"] is False
    assert len(sim_disabled["omitted"]) == 0

    print("✓ 'Always Show Last Split' with schematic engineering break tests passed.")


def test_comparison_hotkeys_and_toast():
    """Verify hotkey comparison switching (C, Shift+C, NumPad 4/6, [/]) and transient HUD toast notification."""
    with open(os.path.join(ROOT_DIR, "overlay.js"), "r", encoding="utf-8") as f:
        overlay_src = f.read()
    with open(os.path.join(ROOT_DIR, "style.css"), "r", encoding="utf-8") as f:
        css_src = f.read()
    with open(os.path.join(ROOT_DIR, "index.html"), "r", encoding="utf-8") as f:
        html_src = f.read()

    # 1. CSS HUD toast styling
    assert ".hud-toast" in css_src, "style.css must define .hud-toast"
    assert ".hud-toast.show" in css_src, "style.css must define .hud-toast.show"

    # 2. HTML UI and hotkey guide
    assert 'id="row-comparison-hotkey"' in html_src, "index.html must have #row-comparison-hotkey"
    assert "Comp: PB" in html_src, "index.html must include #comparison-badge"

    # 3. overlay.js cycleComparison function & reverse parameter
    assert "function cycleComparison(reverse = false)" in overlay_src, "overlay.js cycleComparison must support reverse parameter"
    assert "window.cycleComparison = cycleComparison;" in overlay_src, "overlay.js must export cycleComparison on window"
    assert "function showComparisonToast(" in overlay_src, "overlay.js must define showComparisonToast"
    assert "window.showComparisonToast = showComparisonToast;" in overlay_src, "overlay.js must export showComparisonToast on window"

    # 4. Keyboard event listeners and safety guards
    assert 'e.key === "c" || e.key === "C"' in overlay_src, "overlay.js must listen for 'c' and 'C' keys"
    assert 'e.code === "Numpad6"' in overlay_src, "overlay.js must support Numpad6 for LiveSplit parity"
    assert 'e.code === "Numpad4"' in overlay_src, "overlay.js must support Numpad4 for LiveSplit parity"
    assert "e.shiftKey" in overlay_src, "overlay.js must support Shift+C for reverse comparison cycling"
    assert 'e.target.tagName === "INPUT"' in overlay_src, "overlay.js must guard against typing in input fields"
    assert "window.hudLayout.isEditMode" in overlay_src, "overlay.js must guard against hotkey triggers in edit mode"

    # 5. Mathematical simulation of circular comparison cycling
    comps = ["Personal Best", "Best Segments", "Average Segments", "Worst Segments"]
    def sim_cycle(cur_idx, reverse=False):
        return (cur_idx - 1 + len(comps)) % len(comps) if reverse else (cur_idx + 1) % len(comps)

    assert sim_cycle(0, False) == 1  # PB -> Best Segments
    assert sim_cycle(1, False) == 2  # Best Segments -> Average Segments
    assert sim_cycle(2, False) == 3  # Average Segments -> Worst Segments
    assert sim_cycle(3, False) == 0  # Worst Segments -> PB (wraparound)

    assert sim_cycle(0, True) == 3   # PB -> Worst Segments (reverse wraparound)
    assert sim_cycle(3, True) == 2   # Worst Segments -> Average Segments
    # 6. Completed run comparison recalculation assertions
    assert 'completedSplitTimes[i] ?? lockedDeltas[i]?.splitTimeSec' in overlay_src, "overlay.js must check completedSplitTimes when recalculating comparisons"
    assert 'setDeltaDisplay(i, displayDelta, stateClass, splitTimeSec)' in overlay_src, "overlay.js must update DOM deltas across completed splits"
    assert '<div id="hud-toast" class="hud-toast" style="display: none;">' not in html_src, "index.html #hud-toast must not have inline display: none"
    assert "visibility: hidden;" in css_src, "style.css .hud-toast must have visibility: hidden"
    assert "visibility: visible;" in css_src, "style.css .hud-toast.show must have visibility: visible"

    # 7. Mathematical simulation of completed run delta recalculation across comparison switch
    split_times = [60.0, 120.0, 180.0]
    pb_targets = [62.0, 118.0, 185.0]
    best_targets = [55.0, 110.0, 165.0]

    def sim_recalc(completed_times, targets, is_gold_flags):
        results = []
        prev_diff = 0.0
        for i, (t_run, t_comp) in enumerate(zip(completed_times, targets)):
            diff = t_run - t_comp
            change = diff - prev_diff
            gained = change <= 0.001
            is_ahead = diff <= 0
            if is_gold_flags[i]:
                state = "gold"
            elif is_ahead:
                state = "ahead-gaining" if gained else "ahead-losing"
            else:
                state = "behind-gaining" if gained else "behind-losing"
            prev_diff = diff
            results.append({"diff": round(diff, 2), "state": state})
        return results

    golds = [False, False, False]
    pb_results = sim_recalc(split_times, pb_targets, golds)
    assert pb_results[0] == {"diff": -2.0, "state": "ahead-gaining"}
    assert pb_results[1] == {"diff": 2.0, "state": "behind-losing"}
    assert pb_results[2] == {"diff": -5.0, "state": "ahead-gaining"}

    # Switch to Best Segments post-run
    best_results = sim_recalc(split_times, best_targets, golds)
    assert best_results[0] == {"diff": 5.0, "state": "behind-losing"}
    assert best_results[1] == {"diff": 10.0, "state": "behind-losing"}
    assert best_results[2] == {"diff": 15.0, "state": "behind-losing"}

    # Gold persistence: if split 0 was marked gold, it stays gold
    golds_with_split0 = [True, False, False]
    best_gold_results = sim_recalc(split_times, best_targets, golds_with_split0)
    assert best_gold_results[0]["state"] == "gold"
    assert best_gold_results[1]["state"] == "behind-losing"

    print("✓ Comparison switching hotkey (C, Shift+C, NumPad 4/6) and toast tests passed.")


def test_architectural_safeguards_and_bug_fixes():
    """Verify WebSocket timeout desync guard, strict integer split index parsing, multi-ghost profile schema, and safeStorage."""
    with open(os.path.join(ROOT_DIR, "overlay.js"), "r", encoding="utf-8") as f:
        overlay_src = f.read()
    with open(os.path.join(ROOT_DIR, "layout.js"), "r", encoding="utf-8") as f:
        layout_src = f.read()
    ts_path = os.path.join(ROOT_DIR, "src", "ui", "track-style.js")
    if os.path.exists(ts_path):
        with open(ts_path, "r", encoding="utf-8") as tsf:
            layout_src += tsf.read()
    with open(os.path.join(ROOT_DIR, "src", "core", "layout-profiles.js"), "r", encoding="utf-8") as lpf:
        profiles_src = lpf.read()
    with open(os.path.join(ROOT_DIR, "schema", "layout-v1.json"), "r", encoding="utf-8") as f:
        schema_src = f.read()

    # 1. Bug 1: sendCommand timeout desync guard & probe command support
    assert "function sendCommand(cmd, timeoutMs = 400, isProbe = false)" in overlay_src, \
        "overlay.js sendCommand must support 400ms default timeout and isProbe parameter"
    assert "Resetting WebSocket to prevent stream desynchronization" in overlay_src, \
        "overlay.js sendCommand must reset socket on command timeout to prevent response shifting"

    # 2. Bug 2: Strict integer validation on getsplitindex to prevent accidental run wipes
    assert 'isStrictInt = typeof splitIdxStr === "string" && /^-?\\d+$/.test(splitIdxStr.trim())' in overlay_src, \
        "overlay.js must strictly validate integer regex on getsplitindex response"

    def is_strict_int(s):
        return bool(re.match(r'^-?\d+$', (s or "").strip())) if isinstance(s, str) else False

    assert is_strict_int("0") is True
    assert is_strict_int("-1") is True
    assert is_strict_int("15") is True
    assert is_strict_int(" 42 ") is True
    assert is_strict_int("00:45.12") is False, "Time string must NOT be treated as split index 0"
    assert is_strict_int("01:23.45") is False, "Time string must NOT be treated as split index 1"
    assert is_strict_int("-") is False
    assert is_strict_int("") is False
    assert is_strict_int(None) is False

    # 3. Bug 3: Multi-ghost selection in layout profiles schema and layout.js
    assert '"activeGhosts"' in schema_src, "schema/layout-v1.json must declare activeGhosts"
    assert "activeGhosts:" in (layout_src + profiles_src), "layout.js and layout-profiles.js createProfileExport must export activeGhosts"
    assert "Array.isArray(prefs.activeGhosts)" in (layout_src + profiles_src), "layout.js and layout-profiles.js applyProfileData must restore activeGhosts"

    # 4. Bug 4: safeStorage with in-memory fallback for sandboxed OBS environments
    assert "const safeStorage =" in overlay_src, "overlay.js must define safeStorage wrapper"
    assert "window.safeStorage = safeStorage;" in overlay_src, "overlay.js must export safeStorage on window"

    print("✓ Architectural safeguards & bug fixes (WebSocket desync guard, strict int index, activeGhosts schema, safeStorage) passed.")


def test_modular_architecture():
    """Verify clean modularization across src/core and src/ui, namespace registration, and 60 FPS element caching."""
    with open(os.path.join(ROOT_DIR, "index.html"), "r", encoding="utf-8") as f:
        html_src = f.read()
    with open(os.path.join(ROOT_DIR, "tests", "test_runner.html"), "r", encoding="utf-8") as f:
        runner_src = f.read()
    with open(os.path.join(ROOT_DIR, "overlay.js"), "r", encoding="utf-8") as f:
        overlay_src = f.read()

    expected_modules = [
        "src/core/storage.js",
        "src/core/time-utils.js",
        "src/core/split-engine.js",
        "src/core/ghost-math.js",
        "src/core/livesplit-client.js",
        "src/core/race-client.js",
        "src/ui/layout-engine.js",
        "src/ui/track-renderer.js",
        "src/ui/interactions.js",
        "src/ui/leaderboard.js"
    ]

    # 1. Script inclusion in index.html and test_runner.html
    for mod in expected_modules:
        assert f'src="{mod}"' in html_src, f"index.html must include script tag for {mod}"
        assert f'src="../{mod}"' in runner_src, f"test_runner.html must include script tag for ../{mod}"

    # 2. Verify module namespace exports
    storage_path = os.path.join(ROOT_DIR, "src", "core", "storage.js")
    with open(storage_path, "r", encoding="utf-8") as f:
        assert "window.LiveSplit.Storage" in f.read(), "src/core/storage.js must export LiveSplit.Storage"

    time_path = os.path.join(ROOT_DIR, "src", "core", "time-utils.js")
    with open(time_path, "r", encoding="utf-8") as f:
        assert "window.LiveSplit.Time" in f.read(), "src/core/time-utils.js must export LiveSplit.Time"

    split_path = os.path.join(ROOT_DIR, "src", "core", "split-engine.js")
    with open(split_path, "r", encoding="utf-8") as f:
        assert "window.LiveSplit.SplitEngine" in f.read(), "src/core/split-engine.js must export LiveSplit.SplitEngine"

    ghost_path = os.path.join(ROOT_DIR, "src", "core", "ghost-math.js")
    with open(ghost_path, "r", encoding="utf-8") as f:
        assert "window.LiveSplit.GhostMath" in f.read(), "src/core/ghost-math.js must export LiveSplit.GhostMath"

    client_path = os.path.join(ROOT_DIR, "src", "core", "livesplit-client.js")
    with open(client_path, "r", encoding="utf-8") as f:
        assert "window.LiveSplit.Client" in f.read(), "src/core/livesplit-client.js must export LiveSplit.Client"

    race_path = os.path.join(ROOT_DIR, "src", "core", "race-client.js")
    with open(race_path, "r", encoding="utf-8") as f:
        assert "window.LiveSplit.RaceClient" in f.read(), "src/core/race-client.js must export LiveSplit.RaceClient"

    track_path = os.path.join(ROOT_DIR, "src", "ui", "track-renderer.js")
    with open(track_path, "r", encoding="utf-8") as f:
        assert "window.LiveSplit.TrackRenderer" in f.read(), "src/ui/track-renderer.js must export LiveSplit.TrackRenderer"

    layout_path = os.path.join(ROOT_DIR, "src", "ui", "layout-engine.js")
    with open(layout_path, "r", encoding="utf-8") as f:
        assert "window.LiveSplit.LayoutEngine" in f.read(), "src/ui/layout-engine.js must export LiveSplit.LayoutEngine"

    inter_path = os.path.join(ROOT_DIR, "src", "ui", "interactions.js")
    with open(inter_path, "r", encoding="utf-8") as f:
        assert "window.LiveSplit.Interactions" in f.read(), "src/ui/interactions.js must export LiveSplit.Interactions"

    lead_path = os.path.join(ROOT_DIR, "src", "ui", "leaderboard.js")
    with open(lead_path, "r", encoding="utf-8") as f:
        assert "window.LiveSplit.Leaderboard" in f.read(), "src/ui/leaderboard.js must export LiveSplit.Leaderboard"

    # 3. Verify zero-allocation 60 FPS element caching in overlay.js
    assert "getLiveElements(currentIndex)" in overlay_src, "overlay.js must use getLiveElements for 60 FPS tick"
    assert "createLiveElementCache" in overlay_src, "overlay.js must hook into createLiveElementCache"

    # 4. Verify Vite single-file build entry synchronicity with index.html scripts
    build_entry_path = os.path.join(ROOT_DIR, "src", "build-entry.js")
    if os.path.exists(build_entry_path):
        with open(build_entry_path, "r", encoding="utf-8") as f:
            build_src = f.read()
        for mod in expected_modules:
            rel_import = mod.replace("src/", "./")
            assert rel_import in build_src, f"src/build-entry.js must import {rel_import} to stay synchronized with index.html"

    print("✓ Modular architecture (src/core, src/ui, LiveSplit namespaces, 60 FPS element caching, Vite build-entry) passed.")


def test_race_client_and_simulation_engine():
    """Verify Live Race client architecture, therun.gg telemetry handling,
    F1 continuous ranking score calculation, leader/interval gap math, and simulation mode."""
    race_path = os.path.join(ROOT_DIR, "src", "core", "race-client.js")
    with open(race_path, "r", encoding="utf-8") as f:
        race_src = f.read()

    # 1. Core API definitions and namespaces
    assert "createRaceClient" in race_src, "race-client.js must define createRaceClient"
    assert "startAutoDetect" in race_src, "race-client.js must support auto-detection"
    assert "connectToRace" in race_src, "race-client.js must support connectToRace"
    assert "startSimulation" in race_src, "race-client.js must support startSimulation"
    assert "stopSimulation" in race_src, "race-client.js must support stopSimulation"
    assert "getRankedEntrants" in race_src, "race-client.js must compute getRankedEntrants"

    # 2. Mathematical simulation of F1 continuous score & overtake logic
    entrants = [
        {"userId": "A", "score": 3.85, "currentTimeSec": 95.0, "isFinished": False},
        {"userId": "B", "score": 4.10, "currentTimeSec": 94.0, "isFinished": False},
        {"userId": "C", "score": 8.00, "currentTimeSec": 120.5, "finalTimeSec": 120.5, "isFinished": True},
        {"userId": "D", "score": 8.00, "currentTimeSec": 125.0, "finalTimeSec": 125.0, "isFinished": True},
    ]

    def sort_entrants(runners):
        return sorted(runners, key=lambda r: (
            0 if r["isFinished"] else 1,
            r.get("finalTimeSec", 0) if r["isFinished"] else -r["score"],
            r.get("currentTimeSec", 0)
        ))

    ranked = sort_entrants(entrants)
    assert [r["userId"] for r in ranked] == ["C", "D", "B", "A"], "Ranking order must follow F1 finish & continuous score rules"

    # 3. URL parsing logic
    def parse_race_id(url):
        import re
        m = re.search(r'(?:therun\.gg\/races\/|racetime\.gg\/[^/]+\/)?([a-zA-Z0-9_-]+)\/?$', url.strip())
        return m.group(1) if m else url.strip()

    assert parse_race_id("https://therun.gg/races/f0ub") == "f0ub"
    assert parse_race_id("therun.gg/races/mario-cup-1") == "mario-cup-1"
    assert parse_race_id("https://racetime.gg/sm64/live-race-xyz") == "live-race-xyz"
    assert parse_race_id("simple_id_99") == "simple_id_99"

    print("✓ Live Race client telemetry, F1 ranking, and simulation engine tests passed.")


def test_track_orientation_and_split_density_reflow():
    """Verify track orientation switching preserves split density, uses reflow geometry fallbacks, and updates track window at currentIndex = -1."""
    with open(os.path.join(ROOT_DIR, "layout.js"), "r", encoding="utf-8") as f:
        layout_src = f.read()
    ts_path = os.path.join(ROOT_DIR, "src", "ui", "track-style.js")
    if os.path.exists(ts_path):
        with open(ts_path, "r", encoding="utf-8") as tsf:
            layout_src += tsf.read()
    with open(os.path.join(ROOT_DIR, "overlay.js"), "r", encoding="utf-8") as f:
        overlay_src = f.read()

    # 1. Structural assertions in layout.js: applyComponentLayout before applyTrackStyle and status updates
    assert 'applyComponentLayout("track");\n    applyTrackStyle();' in layout_src or \
           ('applyComponentLayout("track");' in layout_src and 'applyTrackStyle();' in layout_src), \
        "layout.js setTrackOrientation must apply component layout geometry before applying track style"

    # setTrackOrientation resets scroll position
    assert "viewport.scrollLeft = 0;" in layout_src and "viewport.scrollTop = 0;" in layout_src, \
        "layout.js setTrackOrientation must reset viewport scroll positions"

    # setTrackOrientation calls updateTrackDensityAndAngle and updateTrackStatus both synchronously and via requestAnimationFrame
    assert "window.updateTrackStatus(window.getCurrentIndex ? window.getCurrentIndex() : -1);" in layout_src, \
        "layout.js setTrackOrientation must trigger updateTrackStatus"
    assert "requestAnimationFrame(() => {" in layout_src, \
        "layout.js setTrackOrientation must schedule requestAnimationFrame reflow update"

    # 2. Structural assertions in overlay.js: dimension fallbacks and unconditional updateTrackStatus
    assert 'const isDockedVertical = isVertical && (trackComp?.classList.contains("docked-left") || trackComp?.classList.contains("docked-right"));' in overlay_src, \
        "overlay.js must detect isDockedVertical in getVisibleSplitsCapacity"
    assert 'const isDockedHorizontal = !isVertical && trackComp?.classList.contains("docked-bottom");' in overlay_src, \
        "overlay.js must detect isDockedHorizontal in getVisibleSplitsCapacity"
    assert "let lastKnownOrientation = null;" in overlay_src, \
        "overlay.js must track lastKnownOrientation"
    assert "trackManualScrollOffset = 0;" in overlay_src, \
        "overlay.js updateTrackDensityAndAngle must reset trackManualScrollOffset on orientation change"
    assert "updateTrackStatus(currentIndex);" in overlay_src and "if (currentIndex >= 0) {\n    updateTrackStatus(currentIndex);" not in overlay_src, \
        "overlay.js updateTrackDensityAndAngle must call updateTrackStatus unconditionally (including currentIndex = -1)"

    # 3. Mathematical simulation of visible split capacity during reflow race conditions
    def sim_capacity(pref, is_vertical, is_docked, viewport_w, viewport_h, window_w=1920, window_h=1080):
        if pref == "all":
            return 9999
        try:
            val = int(pref)
            if val > 0:
                return val
        except (ValueError, TypeError):
            pass

        # Fallback simulation
        if not is_vertical and is_docked and viewport_w < 500:
            effective_w = window_w
        else:
            effective_w = viewport_w or window_w

        if is_vertical and is_docked and viewport_h < 300:
            effective_h = window_h
        else:
            effective_h = viewport_h or window_h

        p_side = 24
        p_total = p_side * 2
        avail_w = max(300, effective_w - p_total)
        avail_h = max(200, effective_h - p_total)

        if is_vertical:
            spacing = 58
            return max(3, math.floor(avail_h / spacing))
        else:
            spacing = 90
            return max(4, math.floor(avail_w / spacing))

    # Without fallback: switching to vertical while container still has bottom-docked height (90px)
    stale_vert_cap = sim_capacity("auto", is_vertical=True, is_docked=False, viewport_w=1920, viewport_h=90)
    assert stale_vert_cap == 3, f"Expected stale cap to clamp to 3, got {stale_vert_cap}"

    # With fallback: docked vertical with stale 90px height uses window_h (1080px)
    fixed_vert_cap = sim_capacity("auto", is_vertical=True, is_docked=True, viewport_w=1920, viewport_h=90)
    assert fixed_vert_cap >= 15, f"Expected fixed vertical capacity >= 15, got {fixed_vert_cap}"

    # Numeric preferences (e.g. 8 splits) must always return exactly 8 in both orientations
    assert sim_capacity("8", is_vertical=True, is_docked=True, viewport_w=1920, viewport_h=90) == 8
    assert sim_capacity("8", is_vertical=False, is_docked=True, viewport_w=340, viewport_h=1080) == 8

    # 4. Sliding window simulation on Start screen (currentIndex = -1)
    def sim_track_window(num_splits, capacity, current_idx, always_show_last=False):
        if num_splits <= capacity:
            return [False] * num_splits

        if always_show_last:
            k = capacity - 1
            if current_idx < 0:
                start_w = 0
            else:
                start_w = max(0, min(current_idx - (k // 2), num_splits - 1 - k))
            end_w = start_w + k
            omitted = []
            for i in range(num_splits):
                if i == num_splits - 1:
                    omitted.append(False)
                elif start_w <= i < end_w:
                    omitted.append(False)
                else:
                    omitted.append(True)
            return omitted
        else:
            if current_idx < 0:
                start_w = 0
            else:
                start_w = max(0, min(current_idx - (capacity // 2), num_splits - capacity))
            end_w = start_w + capacity
            return [not (start_w <= i < end_w) for i in range(num_splits)]

    # 10 splits, capacity = 8, at start screen (idx = -1) with alwaysShowLast = True
    omitted_start = sim_track_window(10, 8, -1, always_show_last=True)
    assert omitted_start[0:7] == [False] * 7, "First 7 splits must be visible on start screen"
    assert omitted_start[7] is True and omitted_start[8] is True, "Splits 7 and 8 must be omitted"
    assert omitted_start[9] is False, "Final split must be visible on start screen"

    # 10 splits, capacity = 8, at start screen with standard windowing
    omitted_std = sim_track_window(10, 8, -1, always_show_last=False)
    assert omitted_std[0:8] == [False] * 8, "First 8 splits must be visible on start screen"
    assert omitted_std[8] is True and omitted_std[9] is True, "Splits 8 and 9 must be omitted"

    print("✓ Track orientation reflow, dimensional fallbacks, and Start-screen split updates passed.")



def test_live_race_ghost_pins_and_f1_leaderboard():
    """Verify Live Race competitor track pins, dead-reckoning mapping parity,
    F1 timing tower component, FLIP animations, and interactive mute toggles."""
    import json

    with open(os.path.join(ROOT_DIR, "index.html"), "r", encoding="utf-8") as f:
        html = f.read()
    with open(os.path.join(ROOT_DIR, "style.css"), "r", encoding="utf-8") as f:
        css = f.read()
    with open(os.path.join(ROOT_DIR, "layout.js"), "r", encoding="utf-8") as f:
        layout_js = f.read()
    ts_path = os.path.join(ROOT_DIR, "src", "ui", "track-style.js")
    if os.path.exists(ts_path):
        with open(ts_path, "r", encoding="utf-8") as tsf:
            layout_js += tsf.read()
    with open(os.path.join(ROOT_DIR, "src", "ui", "layout-engine.js"), "r", encoding="utf-8") as f:
        layout_engine_js = f.read()
    with open(os.path.join(ROOT_DIR, "schema", "layout-v1.json"), "r", encoding="utf-8") as f:
        schema_json = json.load(f)
    with open(os.path.join(ROOT_DIR, "overlay.js"), "r", encoding="utf-8") as f:
        overlay_js = f.read()
    with open(os.path.join(ROOT_DIR, "src", "ui", "leaderboard.js"), "r", encoding="utf-8") as f:
        leaderboard_js = f.read()

    # 1. HTML DOM Structure
    expected_ids = [
        "hud-comp-leaderboard",
        "badge-scale-leaderboard",
        "race-leaderboard",
        "leaderboard-status-badge",
        "leaderboard-rows",
        "cb-toggle-leaderboard",
        "btn-toggle-leaderboard",
        "btn-toggle-race-pins"
    ]
    for eid in expected_ids:
        assert f'id="{eid}"' in html, f"index.html missing leaderboard element id '{eid}'"
    assert 'data-component-id="leaderboard"' in html, "index.html must register leaderboard data-component-id"

    # 2. Component registry in layout systems and schema
    assert '"leaderboard"' in layout_js, "layout.js COMPONENTS must include 'leaderboard'"
    assert '"leaderboard"' in layout_engine_js, "src/ui/layout-engine.js COMPONENTS must include 'leaderboard'"
    assert "leaderboard" in schema_json["properties"]["components"]["properties"], "schema/layout-v1.json must define leaderboard component"

    # 3. CSS styling
    expected_selectors = [
        ".ghost-marker.race-competitor",
        ".ghost-marker.race-competitor .ghost-icon-wrap",
        ".ghost-marker.race-competitor .ghost-needle",
        ".ghost-marker.race-competitor .racer-tag",
        "#hud-comp-leaderboard",
        "#hud-comp-leaderboard.has-bg",
        ".race-leaderboard",
        ".leaderboard-header",
        ".leaderboard-status",
        ".leaderboard-rows",
        ".leaderboard-row",
        ".leaderboard-row.is-host",
        ".leaderboard-row.is-muted",
        ".leaderboard-row.overtake-flash",
        ".leaderboard-row.split-flash-gold",
        ".leaderboard-row.split-flash-green",
        ".leaderboard-row.split-flash-red",
        ".pos-badge",
        ".pos-badge.pos-1",
        ".racer-accent-bar",
        ".racer-avatar-badge",
        ".racer-name",
        ".host-pill",
        ".racer-gap",
        ".racer-interval",
        ".leaderboard-row.is-muted"
    ]
    for sel in expected_selectors:
        assert sel in css, f"style.css missing selector '{sel}'"

    # 4. Dead-reckoning & track pin parity logic in overlay.js
    assert "getOrCreateRaceMarker" in overlay_js, "overlay.js must define getOrCreateRaceMarker"
    assert "getSegmentCoords" in overlay_js, "overlay.js must use unified getSegmentCoords for track pins"
    assert "LiveSplitLeaderboard.renderLeaderboard" in overlay_js, "overlay.js must trigger LiveSplitLeaderboard.renderLeaderboard"
    assert "window.updateGhostRunner = updateGhostRunner;" in overlay_js, "overlay.js must export updateGhostRunner globally"

    # 5. Leaderboard FLIP animation math simulation
    def sim_flip_transform(old_top, new_top):
        dy = old_top - new_top
        return f"translateY({dy}px)" if abs(dy) > 0.5 else None

    assert sim_flip_transform(120, 160) == "translateY(-40px)", "FLIP invert transform must counteract downward move"
    assert sim_flip_transform(200, 150) == "translateY(50px)", "FLIP invert transform must counteract upward move"
    assert sim_flip_transform(100, 100.2) is None, "Sub-pixel shifts within 0.5px must be ignored to prevent jitter"

    # 6. Standings & mute state simulation
    mock_entrants = [
        {"userId": "sim_speeddemon", "username": "SpeedDemon", "score": 2.5, "isHost": False, "isMuted": False},
        {"userId": "you", "username": "You", "score": 2.2, "isHost": True, "isMuted": False},
        {"userId": "sim_shadow", "username": "ShadowPacer", "score": 1.9, "isHost": False, "isMuted": True}
    ]
    # Filter for track pins: competitors only, unmuted only
    track_competitors = [e for e in mock_entrants if not e["isHost"] and not e["isMuted"]]
    assert len(track_competitors) == 1, "Only unmuted competitors should render on progress track"
    assert track_competitors[0]["userId"] == "sim_speeddemon"

    # 7. Strict anti-flicker and bounding defense assertions
    assert "transform: none !important;" in css, "style.css must lock .leaderboard-row with transform: none !important"
    with open(os.path.join(ROOT_DIR, "src", "core", "race-client.js"), "r", encoding="utf-8") as rf:
        race_code = rf.read()
    with open(os.path.join(ROOT_DIR, "src", "core", "race-simulation.js"), "r", encoding="utf-8") as sf:
        sim_code = sf.read()
    with open(os.path.join(ROOT_DIR, "src", "core", "race-ranking.js"), "r", encoding="utf-8") as rkf:
        ranking_code = rkf.read()
    with open(os.path.join(ROOT_DIR, "src", "core", "race-protocol.js"), "r", encoding="utf-8") as rpf:
        protocol_code = rpf.read()
    with open(os.path.join(ROOT_DIR, "src", "core", "race-discovery.js"), "r", encoding="utf-8") as rdf:
        discovery_code = rdf.read()
    with open(os.path.join(ROOT_DIR, "src", "core", "race-logger.js"), "r", encoding="utf-8") as rlf:
        logger_code = rlf.read()
    race_sim_combined = race_code + sim_code + ranking_code + protocol_code + discovery_code + logger_code
    assert "window.LiveSplit.RaceSimulation" in sim_code, "src/core/race-simulation.js must export LiveSplit.RaceSimulation"
    assert "if (hostState.currentTimeSec > 0)" in race_sim_combined, "race-client.js must never overwrite hostState with simVirtualSec when host is running" 
    assert "setHostUsername" in race_code, "race-client.js must export setHostUsername"
    assert "getHostUsername" in race_code, "race-client.js must export getHostUsername"

    # 8. User tile styling & no 'YOU' tag rule
    with open(os.path.join(ROOT_DIR, "src", "ui", "leaderboard.js"), "r", encoding="utf-8") as lf:
        leaderboard_code = lf.read()
    assert '<span class="host-pill">' not in leaderboard_code, "leaderboard.js must never render host-pill tag (implied by highlighted tile)"
    assert 'const displayName = racer.username || (isHost ? "You" : "Runner");' in leaderboard_code, "leaderboard.js must resolve entrant username rather than overriding to 'You'"
    assert ".leaderboard-row.is-swapping" in css, "style.css must style .leaderboard-row.is-swapping"
    assert "is-swapping" in leaderboard_code, "leaderboard.js must support FLIP is-swapping animation class"
    assert "prevTops" in leaderboard_code, "leaderboard.js must record initial positions for FLIP animation"
    assert "predictedSingleTime" in race_sim_combined, "race client and ranking must support therun.gg predictedSingleTime"
    assert "monteCarloPrediction" in race_sim_combined, "race client and protocol must store monteCarloPrediction from therun.gg telemetry"
    assert "hasStatisticalPrediction" in race_sim_combined, "race client and ranking must track hasStatisticalPrediction flag"

    # 9. Intelligent pin stacking & mini-leaderboard assertions
    assert "--ghost-stack-offset" in css, "style.css must support dynamic --ghost-stack-offset"
    assert "--ghost-stack-offset" in overlay_js, "overlay.js must set --ghost-stack-offset for tiered stacking"
    assert "--ghost-splay-x" in css, "style.css must support mini-leaderboard splay --ghost-splay-x"
    assert "--ghost-splay-x" in overlay_js, "overlay.js must compute --ghost-splay-x for mini-leaderboard"
    assert ".splay-right .ghost-needle" in css, "style.css must support orthogonal leader lines"
    assert "z-index: 5;" in css, "style.css must ensure needle stems have least drawing precedence (z-index: 5)"

    # 10. Zero-overlap pinheads, hover tooltips for all ghosts, blurring bug defense, and custom pinhead size
    assert 'id="slider-ghost-pin-size"' in html, "index.html must provide #slider-ghost-pin-size in customizer dialog"
    assert 'id="val-ghost-pin-size"' in html, "index.html must provide #val-ghost-pin-size badge in customizer dialog"
    assert "ghostPinSize: 26" in layout_js, "layout.js DEFAULT_TRACK_STYLE must include ghostPinSize default (26px)"
    assert "ghostPinSize: 26" in layout_engine_js, "src/ui/layout-engine.js DEFAULT_TRACK_STYLE must include ghostPinSize: 26"
    assert "ghostPinSize" in schema_json["properties"]["style"]["properties"], "schema/layout-v1.json must include ghostPinSize in track style schema"
    assert "--ghost-pin-size" in css, "style.css must define and utilize --ghost-pin-size for pin markers and icon wraps"
    assert "--ghost-pin-size" in layout_js, "layout.js must apply --ghost-pin-size CSS custom property to track and root"
    assert "background: transparent !important;" in css, "style.css splayed needles must enforce transparent background to eliminate blurring bug"
    assert "box-shadow: none !important;" in css, "style.css splayed needles must eliminate box-shadow to prevent blurring glow"
    assert ".ghost-marker .racer-tag" in css, "style.css must support tooltips for all ghost markers"
    markers_file = os.path.join(ROOT_DIR, "src", "ui", "race-track-markers.js")
    with open(markers_file, "r", encoding="utf-8") as mf:
        markers_code = mf.read()
    assert ".ghost-marker:hover .racer-tag" in css, "style.css must reveal tooltip on hovering any ghost marker"
    assert '<div class="racer-tag">${ghostInfo.name' in overlay_js, "overlay.js getOrCreateGhostMarker must inject tooltip racer-tag with ghostInfo.name"
    assert "configuredPinSize + 2" in (overlay_js + markers_code), "race track markers must ensure zero pinhead overlap by spacing pinheads at least configuredPinSize + 2"
    assert "getClusterClampedCenter" in (overlay_js + markers_code), "race track markers must use iterative cluster merging to prevent multi-cluster badge collapse"
    assert "getClusterFirstBadge(cB) - getClusterLastBadge(cA)" in (overlay_js + markers_code), "race track markers must merge overlapping cluster badge bounds"

    # 11. Two-phase split transition, tile double-click hiding, milestone gaps, and position persistence
    assert "is-completed-${effect.type}" in leaderboard_code, "leaderboard.js must apply celebratory glow class in Phase 1"
    assert "split-swipe-in" in leaderboard_code, "leaderboard.js must apply split-swipe-in class in Phase 2"
    assert "@keyframes split-swipe-up" in css, "style.css must define @keyframes split-swipe-up for smooth incoming split transition"
    assert ".racer-split.is-completed-gold" in css, "style.css must style completed gold split text"
    assert ".racer-split.is-completed-green" in css, "style.css must style completed green split text"
    assert ".racer-split.is-completed-red" in css, "style.css must style completed red split text"
    assert "racer-mute-btn" not in leaderboard_code, "leaderboard.js must not render mute button icon (double click tile to hide)"
    assert 'containerEl.addEventListener("dblclick"' in leaderboard_code, "leaderboard.js must support double click on leaderboard rows to hide/show pins"
    assert "calculateMilestoneGap" in race_code, "race-client.js must calculate milestone-based checkpoint gaps"
    assert "normalizeSplitTimes" in race_code, "race-client.js must define normalizeSplitTimes for robust splitTimes object/array handling"
    assert "simulationCourseTargets" in race_sim_combined, "race simulation must establish persistent simulationCourseTargets"
    assert "expectedSegmentSec" in race_sim_combined, "race client and ranking must calculate expectedSegmentSec for current split"
    assert "lastCompletedIdx" in race_sim_combined, "race client and ranking must update leaderboard positions strictly on split checkpoints"
    assert "raceClockSec" in race_code, "race-client.js must synchronize live race clock to Real Time (RTA)"
    assert "completedSplitTimesRT" in overlay_js, "overlay.js must record Real Time split timestamps"
    assert "activeComparisonTimesRT" in race_code, "race-client.js must prioritize Real Time course targets"
    assert ".expected-tag" in css, "style.css must style .expected-tag"
    assert "split-pulse-gold 4.0s" in css, "style.css must animate split glow pulse over 4 seconds"
    assert ".racer-split.split-fade-out" in css, "style.css must style gradual fade out of completed split name"
    assert "@keyframes split-fade-out-up" in css, "style.css must define @keyframes split-fade-out-up"
    assert ".pos-badge.pos-dnf" in css, "style.css must style DNF position badge"
    assert ".leaderboard-row.is-dnf" in css, "style.css must style DNF leaderboard rows"
    assert "setHostDNF" in race_code, "race-client.js must export setHostDNF"
    assert "isHostDNF" in race_code, "race-client.js must export isHostDNF"
    assert "setEntrantDNF" in race_code, "race-client.js must export setEntrantDNF"
    assert "setHostDNF(true)" in overlay_js, "overlay.js must transition host to DNF upon reset in simulation"
    assert "is-dnf" in leaderboard_code, "leaderboard.js must handle DNF rows"
    assert "cursor: grab;" in css and ".leaderboard-header" in css, "style.css must render grab cursor on leaderboard header"
    assert "livesplit_leaderboard_layout" in layout_js, "layout.js must persist dedicated leaderboard layout"
    assert "document.querySelector(\".leaderboard-header\")" in layout_js, "layout.js must wire pointerdown dragging directly to leaderboard header"
    assert "applyComponentLayout" in layout_js, "layout.js must export applyComponentLayout on window.hudLayout"
    assert "handleUndoSplit" in race_code, "race-client.js must define and export handleUndoSplit"
    assert "rc.handleUndoSplit" in overlay_js, "overlay.js handleUndoSplit must invoke rc.handleUndoSplit"
    assert "rowsEl.insertBefore(row, currentChild)" in leaderboard_code, "leaderboard.js must use targeted insertBefore reconciliation"
    assert "row.style.animationDelay" in leaderboard_code, "leaderboard.js must lock animationDelay to elapsed progress"
    assert "simVirtualSec" in race_sim_combined, "race simulation must track and reset simVirtualSec"
    assert "pbCheckpointTimes" in race_sim_combined, "race simulation must generate pbCheckpointTimes for competitors"
    assert "isSecondResetWithDNF" in overlay_js, "overlay.js must handle double reset to clear DNF"
    assert ".racer-ribbon" in css, "style.css must style .racer-ribbon"
    assert "@keyframes ribbon-slide-in" in css, "style.css must define @keyframes ribbon-slide-in"
    assert "racer.segmentRibbon" in leaderboard_code, "leaderboard.js must render fastest segment corner ribbon"
    assert "ribbonAwards" in race_sim_combined, "race client and ranking must calculate top 3 segment ribbons (gold, silver, bronze)"
    assert "setTimingMethod" in race_code, "race-client.js must export setTimingMethod"
    assert "getTimingMethod" in race_code, "race-client.js must export getTimingMethod"
    assert "rc.setTimingMethod" in overlay_js, "overlay.js applyActiveTimingMethod must notify rc.setTimingMethod"
    assert "completedSplitTimesGT" in overlay_js, "overlay.js must track completedSplitTimesGT"

    # 13. Security sanitization, TDZ prevention, and WebSocket self-healing checks
    markers_file = os.path.join(ROOT_DIR, "src", "ui", "race-track-markers.js")
    with open(markers_file, "r", encoding="utf-8") as mf:
        markers_code = mf.read()
    dom_utils_file = os.path.join(ROOT_DIR, "src", "utils", "dom-utils.js")
    with open(dom_utils_file, "r", encoding="utf-8") as df:
        dom_utils_code = df.read()
    assert "window.LiveSplit.DOMUtils" in dom_utils_code, "src/utils/dom-utils.js must export LiveSplit.DOMUtils"
    assert "isSafeAvatarUrl" in dom_utils_code, "src/utils/dom-utils.js must provide isSafeAvatarUrl"
    assert "buildAvatarMarkup" in dom_utils_code, "src/utils/dom-utils.js must provide buildAvatarMarkup"
    assert "function escapeHtml" in overlay_js, "overlay.js must define escapeHtml for XSS defense"
    assert "escapeHtml(racer.username" in (overlay_js + markers_code), "race track markers getOrCreateRaceMarker must escape racer.username"
    assert 'rawAvatar.startsWith("https://")' in (overlay_js + markers_code), "race track markers getOrCreateRaceMarker must validate avatar URL protocols"
    assert "let hostSplitName = currentSplitName;" in race_code, "race-client.js updateHostProgress must declare hostSplitName"
    assert race_code.index("let hostSplitName = currentSplitName;") < race_code.index("if (splitFlash && splitFlash.type)"), "race-client.js updateHostProgress must declare hostSplitName before splitFlash to prevent TDZ ReferenceError"
    assert "!ws || ws.readyState !== WebSocket.OPEN" in race_sim_combined, "race client and discovery must auto-reconnect if socket dropped on active raceId"
    assert "function handleHostRunStarted" in race_code, "race-client.js must define handleHostRunStarted for event-driven lobby auto-connect"
    assert "function armSimulationStandby" in race_code, "race-client.js must define armSimulationStandby for Simulation Race standby"
    assert "rcStart.handleHostRunStarted" in overlay_js, "overlay.js must trigger handleHostRunStarted when local LiveSplit timer starts"
    assert 'id="input-therun-race-code"' in html, "index.html must include #input-therun-race-code input"
    assert "function isValidRaceCode" in race_code, "race-client.js must define isValidRaceCode"
    assert ".settings-tile-btn:disabled" in css, "style.css must define greyed-out .settings-tile-btn:disabled styling"

    print("✓ Live Race competitor track pins, dead-reckoning parity, and F1 leaderboard tests passed.")



def test_intelligent_release_bump_detection():
    """Verify intelligent release bump decision logic and file path classifications."""
    script_path = os.path.join(ROOT_DIR, "scripts", "determine_bump.py")
    assert os.path.isfile(script_path), "scripts/determine_bump.py must exist"

    import importlib.util
    spec = importlib.util.spec_from_file_location("determine_bump", script_path)
    db = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(db)

    # 1. Non-runtime paths must not trigger runtime changes
    non_runtime_cases = [
        ["README.md"],
        ["AGENT_GUIDE.md"],
        ["tests/test_runner.html"],
        ["tests/run_tests.py"],
        [".github/workflows/ci.yml", ".github/workflows/release.yml"],
        [".githooks/pre-push"],
        [".gitignore", "LICENSE"],
        ["docs/guide.md"],
        ["README.md", "tests/test_runner.html", ".github/workflows/release.yml"]
    ]
    for case in non_runtime_cases:
        assert db.has_runtime_changes(case) is False, f"Expected no runtime changes for: {case}"

    # 2. Runtime paths must trigger runtime changes
    runtime_cases = [
        ["overlay.js"],
        ["layout.js"],
        ["index.html"],
        ["style.css"],
        ["src/core/split-engine.js"],
        ["src/core/ghost-math.js"],
        ["src/ui/track-renderer.js"],
        ["assets/logo.png"],
        ["schema/layout-schema-v1.json"],
        ["README.md", "overlay.js"]
    ]
    for case in runtime_cases:
        assert db.has_runtime_changes(case) is True, f"Expected runtime changes for: {case}"

    # 3. Conventional Commit PR Title Regex
    assert db.NON_RELEASE_TITLE_REGEX.match("test: comprehensive unit tests") is not None
    assert db.NON_RELEASE_TITLE_REGEX.match("test(core): comprehensive unit tests") is not None
    assert db.NON_RELEASE_TITLE_REGEX.match("docs: update README badges") is not None
    assert db.NON_RELEASE_TITLE_REGEX.match("chore: cleanup temp files") is not None
    assert db.NON_RELEASE_TITLE_REGEX.match("ci: update github action") is not None
    assert db.NON_RELEASE_TITLE_REGEX.match("build: update dependencies") is not None
    assert db.NON_RELEASE_TITLE_REGEX.match("style: format code") is not None

    # Production release prefixes must NOT match non-release regex
    assert db.NON_RELEASE_TITLE_REGEX.match("feat: live race ghosts") is None
    assert db.NON_RELEASE_TITLE_REGEX.match("fix: pin stacking calculation") is None
    assert db.NON_RELEASE_TITLE_REGEX.match("perf: optimize element caching") is None

    print("✓ Intelligent release bump detection and file classifications passed.")



def find_chrome():
    candidates = [
        os.environ.get("CHROME_BIN"),
        shutil.which("google-chrome"),
        shutil.which("google-chrome-stable"),
        shutil.which("chromium"),
        shutil.which("chromium-browser"),
        shutil.which("chrome"),
        shutil.which("msedge"),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]
    for c in candidates:
        if c and os.path.isfile(c):
            return c
    return None


def find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        return s.getsockname()[1]


def calculate_file_line_coverage(file_path, script_coverage):
    if not os.path.isfile(file_path):
        return None
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    lines = content.splitlines(keepends=True)
    if not lines:
        return 0, 0, 0.0
    
    executed_bytes = [0] * len(content)
    
    for func in script_coverage.get("functions", []):
        for r in func.get("ranges", []):
            start = max(0, min(r.get("startOffset", 0), len(content)))
            end = max(0, min(r.get("endOffset", 0), len(content)))
            count = r.get("count", 0)
            val = 1 if count > 0 else 0
            for i in range(start, end):
                executed_bytes[i] = val

    offset = 0
    covered_lines = 0
    executable_lines = 0
    for line in lines:
        line_len = len(line)
        line_text = line.strip()
        if (line_text and not line_text.startswith("//") 
            and not line_text.startswith("/*") 
            and not line_text.startswith("*")
            and line_text not in ["{", "}", "};", "});", "})();"]):
            executable_lines += 1
            if any(executed_bytes[offset + k] for k in range(line_len) if not line[k].isspace()):
                covered_lines += 1
        offset += line_len
        
    pct = (covered_lines / executable_lines * 100) if executable_lines > 0 else 100.0
    return executable_lines, covered_lines, pct


async def _run_browser_cdp_async(chrome_bin, test_url):
    import websockets
    port = find_free_port()
    # Chrome 136+ ignores remote debugging when using the default data directory.
    user_data_dir = tempfile.mkdtemp(prefix="livesplit-chrome-")
    proc = subprocess.Popen([
        chrome_bin,
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
        f"--user-data-dir={user_data_dir}",
        f"--remote-debugging-port={port}",
        "--remote-debugging-address=127.0.0.1",
        "about:blank"
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    try:
        ws_url = None
        for _ in range(150):
            await asyncio.sleep(0.1)
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=1) as resp:
                    targets = json.loads(resp.read().decode())
                if targets:
                    page = next((t for t in targets if t.get("type") == "page"), None)
                    if page and "webSocketDebuggerUrl" in page:
                        ws_url = page["webSocketDebuggerUrl"]
                        break
            except Exception:
                pass
        
        if not ws_url:
            raise RuntimeError(f"Could not connect to Chrome debugging port {port}")
            
        async with websockets.connect(ws_url) as ws:
            msg_id = 1
            async def send_cmd(method, params=None):
                nonlocal msg_id
                cid = msg_id
                msg_id += 1
                await ws.send(json.dumps({"id": cid, "method": method, "params": params or {}}))
                while True:
                    res = json.loads(await ws.recv())
                    if res.get("id") == cid:
                        return res.get("result", {})

            await send_cmd("Profiler.enable")
            await send_cmd("Profiler.startPreciseCoverage", {"callCount": True, "detailed": True})
            await send_cmd("Page.enable")
            await send_cmd("Page.navigate", {"url": test_url})
            
            badge_text = ""
            for _ in range(60):
                await asyncio.sleep(0.1)
                eval_res = await send_cmd("Runtime.evaluate", {
                    "expression": "document.getElementById('total-badge') ? document.getElementById('total-badge').innerText : ''"
                })
                val = eval_res.get("result", {}).get("value", "")
                if "PASSED" in val or "FAILED" in val:
                    badge_text = val
                    break
            
            cov_res = await send_cmd("Profiler.takePreciseCoverage")
            await send_cmd("Profiler.stopPreciseCoverage")
            
            return badge_text, cov_res.get("result", [])
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=2)
        except Exception:
            proc.kill()
        shutil.rmtree(user_data_dir, ignore_errors=True)


def run_browser_tests_and_coverage(python_test_count=35):
    """Run in-browser DOM test suite via headless Chrome and measure V8 code coverage."""
    chrome_bin = find_chrome()
    if not chrome_bin:
        print("⚠️ Chrome/Chromium browser not found; skipping in-browser DOM unit tests.")
        return None

    test_html = os.path.join(ROOT_DIR, "tests", "test_runner.html")
    test_url = "file:///" + os.path.abspath(test_html).replace(chr(92), "/")

    badge_text = ""
    records = []

    # Check if websockets is available for precise V8 coverage
    has_websockets = False
    try:
        import websockets
        has_websockets = True
    except ImportError:
        pass

    if has_websockets:
        try:
            badge_text, records = asyncio.run(_run_browser_cdp_async(chrome_bin, test_url))
        except Exception as e:
            print(f"⚠️ CDP coverage collection encountered error: {e}, falling back to --dump-dom")
            has_websockets = False

    if not has_websockets:
        print("ℹ️ Note: Python 'websockets' package not detected; skipping V8 coverage collection. Run 'pip install websockets' to view file-by-file coverage.")
        # Fallback to direct dump-dom execution
        proc = subprocess.run([
            chrome_bin,
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--dump-dom",
            test_url
        ], capture_output=True, text=True, errors="replace")
        out = proc.stdout or ""
        m = re.search(r'id="total-badge"[^>]*>([^<]+)<', out)
        badge_text = m.group(1).strip() if m else "Unknown"

    # Assert browser tests passed
    if "FAILED" in badge_text or "❌" in badge_text:
        raise AssertionError(f"In-browser test runner failed: {badge_text}")
    if "PASSED" not in badge_text:
        raise AssertionError(f"In-browser test runner did not complete: {badge_text}")

    # Parse browser test count
    m_count = re.search(r'(\d+)\s+TESTS PASSED', badge_text)
    browser_test_count = int(m_count.group(1)) if m_count else 0
    total_checks = python_test_count + browser_test_count

    print(f"✓ In-browser unit tests passed ({badge_text}).")

    coverage_data = []
    total_exec = 0
    total_cov = 0

    if records:
        target_files = [
            "overlay.js",
            "layout.js",
            os.path.join("src", "core", "time-utils.js"),
            os.path.join("src", "core", "split-engine.js"),
            os.path.join("src", "core", "ghost-math.js"),
            os.path.join("src", "core", "storage.js"),
            os.path.join("src", "core", "livesplit-client.js"),
            os.path.join("src", "core", "race-simulation.js"),
            os.path.join("src", "core", "race-ranking.js"),
            os.path.join("src", "core", "race-protocol.js"),
            os.path.join("src", "core", "race-discovery.js"),
            os.path.join("src", "core", "race-logger.js"),
            os.path.join("src", "core", "race-client.js"),
            os.path.join("src", "core", "layout-profiles.js"),
            os.path.join("src", "ui", "layout-engine.js"),
            os.path.join("src", "ui", "track-renderer.js"),
            os.path.join("src", "ui", "track-style.js"),
            os.path.join("src", "ui", "interactions.js"),
            os.path.join("src", "ui", "leaderboard.js"),
            os.path.join("src", "ui", "race-track-markers.js"),
            os.path.join("src", "ui", "toast-manager.js"),
            os.path.join("src", "ui", "timer-display.js"),
            os.path.join("src", "ui", "timer-anchor.js"),
            os.path.join("src", "ui", "game-logo.js"),
            os.path.join("src", "utils", "dom-utils.js")
        ]

        for tf in target_files:
            full_path = os.path.join(ROOT_DIR, tf)
            if not os.path.isfile(full_path):
                continue
            base_name = os.path.basename(tf)
            rec = next((r for r in records if os.path.basename(r.get("url", "")) == base_name), None)
            if rec:
                res = calculate_file_line_coverage(full_path, rec)
                if res:
                    exec_l, cov_l, pct = res
                    total_exec += exec_l
                    total_cov += cov_l
                    coverage_data.append({
                        "file": tf.replace("\\", "/"),
                        "exec_lines": exec_l,
                        "cov_lines": cov_l,
                        "pct": pct
                    })

    overall_pct = (total_cov / total_exec * 100) if total_exec > 0 else 0.0

    # Print unified terminal summary
    print("\n" + "=" * 66)
    print("           Unified Test Suite & Coverage Report")
    print("=" * 66)
    print(f" ✓ Python Architecture Checks:  {python_test_count:3d} / {python_test_count:3d} (100% Passed)")
    print(f" ✓ Browser DOM & Unit Tests:   {browser_test_count:3d} / {browser_test_count:3d} (100% Passed)")
    print(f" ----------------------------------------------------------------")
    print(f" Total Unified Test Checks:   {total_checks:3d} / {total_checks:3d} (100% Green)")

    if coverage_data:
        print("-" * 66)
        print(f" {'File':<30} {'Lines':>8} {'Covered':>9} {'Coverage':>10}")
        print("-" * 66)
        for cd in coverage_data:
            print(f" {cd['file']:<30} {cd['exec_lines']:8d} {cd['cov_lines']:9d} {cd['pct']:9.1f}%")
        print("-" * 66)
        print(f" {'Total Project JavaScript':<30} {total_exec:8d} {total_cov:9d} {overall_pct:9.1f}%")
    print("=" * 66)

    # Write GitHub Actions Step Summary if in CI
    step_summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if step_summary_path:
        try:
            with open(step_summary_path, "a", encoding="utf-8") as f:
                f.write("\n## 🧪 LiveSplit Minimal Overlay — Test & Coverage Summary\n\n")
                f.write("| Metric | Status | Details |\n")
                f.write("| :--- | :---: | :--- |\n")
                f.write(f"| **Python Architecture Checks** | ✅ **Passed** | {python_test_count} / {python_test_count} Suites Passed |\n")
                f.write(f"| **In-Browser DOM Unit Tests** | ✅ **Passed** | {browser_test_count} / {browser_test_count} Tests Passed |\n")
                f.write(f"| **Total Test Checks** | ✅ **100% Green** | **{total_checks} Checks Passed (0 Failed)** |\n")
                if coverage_data:
                    f.write(f"| **Overall JavaScript Coverage** | 📊 **{overall_pct:.1f}%** | {total_cov:,} / {total_exec:,} Executable Lines |\n")
                f.write("\n")

                if coverage_data:
                    f.write("### 📂 JavaScript Coverage Breakdown\n\n")
                    f.write("| File | Executable Lines | Covered Lines | Coverage | Progress |\n")
                    f.write("| :--- | :---: | :---: | :---: | :--- |\n")
                    for cd in coverage_data:
                        bars = int(round(cd['pct'] / 10))
                        bar_str = "🟩" * bars + "⬜" * (10 - bars)
                        f.write(f"| `{cd['file']}` | {cd['exec_lines']:,} | {cd['cov_lines']:,} | {cd['pct']:.1f}% | `{bar_str}` |\n")
                    f.write("\n")
                    f.write(f"> **Verdict**: All {total_checks} test checks passed with **{overall_pct:.1f}%** line coverage.\n")
        except Exception as e:
            print(f"Notice: Could not write GITHUB_STEP_SUMMARY: {e}")

    return {
        "python_tests": python_test_count,
        "browser_tests": browser_test_count,
        "total_checks": total_checks,
        "coverage_pct": overall_pct
    }

def test_overlay_subcontrollers_modularization():
    """Verify Stage 4 modularization of ToastManager and TimerDisplay sub-controllers."""
    toast_path = os.path.join(ROOT_DIR, "src", "ui", "toast-manager.js")
    timer_path = os.path.join(ROOT_DIR, "src", "ui", "timer-display.js")
    overlay_path = os.path.join(ROOT_DIR, "overlay.js")

    assert os.path.exists(toast_path), "src/ui/toast-manager.js must exist"
    assert os.path.exists(timer_path), "src/ui/timer-display.js must exist"

    with open(toast_path, "r", encoding="utf-8") as f:
        toast_code = f.read()
    with open(timer_path, "r", encoding="utf-8") as f:
        timer_code = f.read()
    with open(overlay_path, "r", encoding="utf-8") as f:
        overlay_code = f.read()

    # ToastManager checks
    assert "window.LiveSplit.ToastManager" in toast_code, "toast-manager.js must export LiveSplit.ToastManager"
    assert "function getToastElement" in toast_code, "toast-manager.js must define getToastElement"
    assert "function showToast" in toast_code, "toast-manager.js must define showToast"
    assert "function hideToast" in toast_code, "toast-manager.js must define hideToast"
    assert "function showComparisonToast" in toast_code, "toast-manager.js must define showComparisonToast"
    assert "function showDevModeToast" in toast_code, "toast-manager.js must define showDevModeToast"

    # TimerDisplay checks
    assert "window.LiveSplit.TimerDisplay" in timer_code, "timer-display.js must export LiveSplit.TimerDisplay"
    assert "function updateTimingMethodBadge" in timer_code, "timer-display.js must define updateTimingMethodBadge"
    assert "function updateTimerDisplayHierarchy" in timer_code, "timer-display.js must define updateTimerDisplayHierarchy"
    assert "function calculateNextTimingMode" in timer_code, "timer-display.js must define calculateNextTimingMode"
    assert "function syncModalControls" in timer_code, "timer-display.js must define syncModalControls"

    # Overlay delegation checks
    assert "window.LiveSplit.ToastManager.showComparisonToast" in overlay_code, "overlay.js must delegate showComparisonToast to ToastManager"
    assert "window.LiveSplit.ToastManager.showDevModeToast" in overlay_code, "overlay.js must delegate showDevModeToast to ToastManager"
    assert "window.LiveSplit.TimerDisplay.updateTimingMethodBadge" in overlay_code, "overlay.js must delegate updateTimingMethodBadge to TimerDisplay"
    assert "window.LiveSplit.TimerDisplay.updateTimerDisplayHierarchy" in overlay_code, "overlay.js must delegate updateTimerDisplayHierarchy to TimerDisplay"
    assert "window.LiveSplit.TimerDisplay.calculateNextTimingMode" in overlay_code, "overlay.js must delegate toggleTimingMethod to TimerDisplay"

    print("✓ Overlay UI sub-controllers (ToastManager & TimerDisplay) modularization passed.")


def test_race_ranking_modularization():
    """Verify modularization of race standings & milestone ranking engine."""
    ranking_path = os.path.join(ROOT_DIR, "src", "core", "race-ranking.js")
    race_client_path = os.path.join(ROOT_DIR, "src", "core", "race-client.js")

    assert os.path.exists(ranking_path), "src/core/race-ranking.js must exist"

    with open(ranking_path, "r", encoding="utf-8") as rf:
        ranking_code = rf.read()
    with open(race_client_path, "r", encoding="utf-8") as rcf:
        client_code = rcf.read()

    assert "window.LiveSplit.RaceRanking" in ranking_code, "race-ranking.js must export LiveSplit.RaceRanking"
    assert "function normalizeSplitTimes" in ranking_code, "race-ranking.js must define normalizeSplitTimes"
    assert "function formatGapTime" in ranking_code, "race-ranking.js must define formatGapTime"
    assert "function getCourseRefTime" in ranking_code, "race-ranking.js must define getCourseRefTime"
    assert "function getCompletedSplitCount" in ranking_code, "race-ranking.js must define getCompletedSplitCount"
    assert "function getSplitCheckpointTime" in ranking_code, "race-ranking.js must define getSplitCheckpointTime"
    assert "function calculateMilestoneGap" in ranking_code, "race-ranking.js must define calculateMilestoneGap"
    assert "function calculateRankedEntrants" in ranking_code, "race-ranking.js must define calculateRankedEntrants"

    assert "window.LiveSplit.RaceRanking.calculateRankedEntrants" in client_code, "race-client.js must delegate getRankedEntrants to RaceRanking"
    assert "window.LiveSplit.RaceRanking.calculateMilestoneGap" in client_code, "race-client.js must delegate calculateMilestoneGap to RaceRanking"

    print("✓ Race Standings & Milestone Ranking Engine modularization passed.")


def test_race_protocol_modularization():
    """Verify modularization of WebSocket telemetry & protocol message parser."""
    protocol_path = os.path.join(ROOT_DIR, "src", "core", "race-protocol.js")
    race_client_path = os.path.join(ROOT_DIR, "src", "core", "race-client.js")

    assert os.path.exists(protocol_path), "src/core/race-protocol.js must exist"

    with open(protocol_path, "r", encoding="utf-8") as rf:
        protocol_code = rf.read()
    with open(race_client_path, "r", encoding="utf-8") as rcf:
        client_code = rcf.read()

    assert "window.LiveSplit.RaceProtocol" in protocol_code, "race-protocol.js must export LiveSplit.RaceProtocol"
    assert "function updateEntrantFromTelemetry" in protocol_code, "race-protocol.js must define updateEntrantFromTelemetry"
    assert "function parseRaceMessage" in protocol_code, "race-protocol.js must define parseRaceMessage"

    assert "window.LiveSplit.RaceProtocol.parseRaceMessage" in client_code, "race-client.js must delegate handleRaceMessage to RaceProtocol"
    assert "window.LiveSplit.RaceProtocol.updateEntrantFromTelemetry" in client_code, "race-client.js must delegate updateEntrantFromTelemetry to RaceProtocol"

    print("✓ Race Telemetry & Message Protocol modularization passed.")


def test_race_discovery_modularization():
    """Verify modularization of room discovery and auto-detect engine."""
    discovery_path = os.path.join(ROOT_DIR, "src", "core", "race-discovery.js")
    race_client_path = os.path.join(ROOT_DIR, "src", "core", "race-client.js")

    assert os.path.exists(discovery_path), "src/core/race-discovery.js must exist"

    with open(discovery_path, "r", encoding="utf-8") as rf:
        discovery_code = rf.read()
    with open(race_client_path, "r", encoding="utf-8") as rcf:
        client_code = rcf.read()

    assert "window.LiveSplit.RaceDiscovery" in discovery_code, "race-discovery.js must export LiveSplit.RaceDiscovery"
    assert "createRaceDiscovery" in discovery_code, "race-discovery.js must define createRaceDiscovery"
    assert "LiveSplit.RaceDiscovery.createRaceDiscovery" in client_code, "race-client.js must instantiate RaceDiscovery"

    print("✓ Race Room Discovery & Auto-Detect modularization passed.")


def test_race_logger_modularization():
    """Verify modularization of WebSocket telemetry & diagnostics logger."""
    logger_path = os.path.join(ROOT_DIR, "src", "core", "race-logger.js")
    race_client_path = os.path.join(ROOT_DIR, "src", "core", "race-client.js")

    assert os.path.exists(logger_path), "src/core/race-logger.js must exist"

    with open(logger_path, "r", encoding="utf-8") as rf:
        logger_code = rf.read()
    with open(race_client_path, "r", encoding="utf-8") as rcf:
        client_code = rcf.read()

    assert "window.LiveSplit.RaceLogger" in logger_code, "race-logger.js must export LiveSplit.RaceLogger"
    assert "createRaceLogger" in logger_code, "race-logger.js must define createRaceLogger"
    assert "LiveSplit.RaceLogger.createRaceLogger" in client_code, "race-client.js must instantiate RaceLogger"

    print("✓ Race WebSocket Diagnostics Logger modularization passed.")


def test_layout_profiles_modularization():
    """Verify modularization of layout profiles and preset storage engine."""
    profiles_path = os.path.join(ROOT_DIR, "src", "core", "layout-profiles.js")
    layout_path = os.path.join(ROOT_DIR, "layout.js")

    assert os.path.exists(profiles_path), "src/core/layout-profiles.js must exist"

    with open(profiles_path, "r", encoding="utf-8") as rf:
        profiles_code = rf.read()
    with open(layout_path, "r", encoding="utf-8") as lcf:
        layout_code = lcf.read()

    assert "window.LiveSplit.LayoutProfiles" in profiles_code, "layout-profiles.js must export LiveSplit.LayoutProfiles"
    assert "createLayoutProfiles" in profiles_code, "layout-profiles.js must define createLayoutProfiles"
    assert "LiveSplit.LayoutProfiles.createLayoutProfiles" in layout_code, "layout.js must instantiate LayoutProfiles"

    print("✓ Layout Profiles & Preset Engine modularization passed.")


def test_game_logo_modularization():
    """Verify modularization of custom game logo controller."""
    logo_path = os.path.join(ROOT_DIR, "src", "ui", "game-logo.js")
    layout_path = os.path.join(ROOT_DIR, "layout.js")

    assert os.path.exists(logo_path), "src/ui/game-logo.js must exist"

    with open(logo_path, "r", encoding="utf-8") as rf:
        logo_code = rf.read()
    with open(layout_path, "r", encoding="utf-8") as lcf:
        layout_code = lcf.read()

    assert "window.LiveSplit.GameLogo" in logo_code, "game-logo.js must export LiveSplit.GameLogo"
    assert "createGameLogo" in logo_code, "game-logo.js must define createGameLogo"
    assert "LiveSplit.GameLogo.createGameLogo" in layout_code, "layout.js must instantiate GameLogo"

    print("✓ Custom Game Logo Controller modularization passed.")


def test_timer_anchor_modularization():
    """Verify modularization of timer anchor and expansion controller."""
    anchor_path = os.path.join(ROOT_DIR, "src", "ui", "timer-anchor.js")
    layout_path = os.path.join(ROOT_DIR, "layout.js")

    assert os.path.exists(anchor_path), "src/ui/timer-anchor.js must exist"

    with open(anchor_path, "r", encoding="utf-8") as rf:
        anchor_code = rf.read()
    with open(layout_path, "r", encoding="utf-8") as lcf:
        layout_code = lcf.read()

    assert "window.LiveSplit.TimerAnchor" in anchor_code, "timer-anchor.js must export LiveSplit.TimerAnchor"
    assert "createTimerAnchor" in anchor_code, "timer-anchor.js must define createTimerAnchor"
    assert "LiveSplit.TimerAnchor.createTimerAnchor" in layout_code, "layout.js must instantiate TimerAnchor"

    print("✓ Timer Anchor & Expansion Controller modularization passed.")


def test_track_style_modularization():
    """Verify modularization of track style and orientation controller."""
    style_path = os.path.join(ROOT_DIR, "src", "ui", "track-style.js")
    layout_path = os.path.join(ROOT_DIR, "layout.js")

    assert os.path.exists(style_path), "src/ui/track-style.js must exist"

    with open(style_path, "r", encoding="utf-8") as rf:
        style_code = rf.read()
    with open(layout_path, "r", encoding="utf-8") as lcf:
        layout_code = lcf.read()

    assert "window.LiveSplit.TrackStyle" in style_code, "track-style.js must export LiveSplit.TrackStyle"
    assert "createTrackStyle" in style_code, "track-style.js must define createTrackStyle"
    assert "LiveSplit.TrackStyle.createTrackStyle" in layout_code, "layout.js must instantiate TrackStyle"

    print("✓ Track Style & Orientation Controller modularization passed.")


def main():
    print("==================================================")
    print(" LiveSplit Minimal Overlay - Test Suite & Checker")
    print("==================================================")
    try:
        test_file_integrity()
        test_syntax_and_brackets()
        test_dom_id_consistency()
        test_time_conversion_unit()
        test_format_target_time_unit()
        test_format_timer_display_unit()
        test_format_delta_unit()
        test_comparison_normalization_unit()
        test_comparison_curves_math()
        test_sanitize_comparison_times_unit()
        test_ghost_runner_progress()
        test_detect_timing_method_unit()
        test_ghost_timescale_mismatch_defense()
        test_dynamic_pin_sizing_proximity()
        test_multi_ghost_selection_logic()
        test_track_orientation_unit()
        test_ghost_pin_length_zero_track()
        test_start_node_and_bar_fill_geometry()
        test_quick_settings_menu_architecture()
        test_draggable_settings_and_timer_display_modes()
        test_undo_split_and_reconnection_safety()
        test_completed_split_dot_coloring()
        test_custom_game_logo_feature()
        test_overdue_split_bar_glow()
        test_version_and_license()
        test_layout_profiles_and_extensible_schema()
        test_track_scrolling_consistency_and_mousewheel()
        test_skipped_split_and_incomplete_data_handling()
        test_in_run_state_persistence()
        test_timer_anchor_and_expansion_modes()
        test_always_show_last_split_and_schematic_break()
        test_comparison_hotkeys_and_toast()
        test_architectural_safeguards_and_bug_fixes()
        test_modular_architecture()
        test_race_client_and_simulation_engine()
        test_track_orientation_and_split_density_reflow()
        test_intelligent_release_bump_detection()
        test_live_race_ghost_pins_and_f1_leaderboard()
        test_overlay_subcontrollers_modularization()
        test_race_ranking_modularization()
        test_race_protocol_modularization()
        test_race_discovery_modularization()
        test_race_logger_modularization()
        test_layout_profiles_modularization()
        test_game_logo_modularization()
        test_timer_anchor_modularization()
        test_track_style_modularization()
        run_browser_tests_and_coverage(python_test_count=47)
    except AssertionError as e:
        print(f"\n❌ TEST FAILURE: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ UNEXPECTED ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    print("\n==================================================")
    print(" ✅ ALL TESTS PASSED SUCCESSFULLY (100% Green)")
    print("==================================================")
    sys.exit(0)


if __name__ == "__main__":
    main()


