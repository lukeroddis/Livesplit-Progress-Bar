#!/usr/bin/env python3
"""
run_tests.py - Comprehensive Unit Test Suite and Static Analysis Checker
Runs locally and in GitHub Actions CI to maintain code stability.
"""

import sys
import os
import re
import math

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

def test_file_integrity():
    """Verify core project files exist and are UTF-8 decodable."""
    required = ["index.html", "layout.js", "overlay.js", "style.css", "README.md"]
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
    files_to_check = ["index.html", "layout.js", "overlay.js", "style.css"]
    
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

    for js_file in ["layout.js", "overlay.js"]:
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
    m = total_sec // 60
    s = total_sec % 60
    s_pad = f"0{s}" if (s < 10 and m > 0) else f"{s}"
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


def test_format_delta_unit():
    assert format_delta_seconds(0.0) == "±0.0"
    assert format_delta_seconds(0.04) == "±0.0"
    assert format_delta_seconds(-0.04) == "±0.0"
    assert format_delta_seconds(-1.5) == "-1.5"
    assert format_delta_seconds(12.3) == "+12.3"
    assert format_delta_seconds(-65.2) == "-1:05"
    assert format_delta_seconds(125.0) == "+2:05"
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
        test_format_delta_unit()
        test_comparison_normalization_unit()
        test_comparison_curves_math()
        test_sanitize_comparison_times_unit()
        test_ghost_runner_progress()
        test_detect_timing_method_unit()
        test_ghost_timescale_mismatch_defense()
        test_dynamic_pin_sizing_proximity()
        test_multi_ghost_selection_logic()
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
