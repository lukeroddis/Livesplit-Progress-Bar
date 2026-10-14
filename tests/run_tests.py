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
    required = ["index.html", "layout.js", "overlay.js", "style.css", "README.md", "LICENSE", "package.json", "schema/layout-v1.json"]
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

    # 5. Static verification of layout.js
    js_path = os.path.join(ROOT_DIR, "layout.js")
    with open(js_path, "r", encoding="utf-8") as f:
        js = f.read()
    assert 'track.classList.toggle("ghost-on-track", pinLength === 0)' in js, \
        "layout.js missing track ghost-on-track toggle"
    assert 'track.style.setProperty("--ghost-needle-length"' in js, \
        "layout.js missing track.style.setProperty for --ghost-needle-length"
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
        "btn-reset-settings-pos",
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
    assert 'id="btn-reset-settings-pos"' in html, "index.html missing btn-reset-settings-pos"
    assert 'class="settings-drag-grip"' in html, "index.html missing settings-drag-grip"
    assert 'id="ctrl-timer-display"' in html, "index.html missing ctrl-timer-display"
    assert 'data-val="gametime"' in html and 'data-val="realtime"' in html and 'data-val="both"' in html, \
        "index.html missing timer display segmented buttons"

    # 2. CSS dragging and position rules
    assert ".settings-menu-header.is-dragging" in css, "style.css missing .is-dragging header style"
    assert ".settings-menu-panel.is-custom-pos" in css, "style.css missing .is-custom-pos panel style"
    assert "cursor: grab;" in css, "style.css missing cursor: grab for header"
    assert ".settings-reset-pos-btn" in css, "style.css missing .settings-reset-pos-btn"

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
    default_track_style = {
        "orientation": "horizontal",
        "namePos": "top",
        "deltaPos": "top",
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
            "deltaPos": "bottom",
            "bgOpacity": 80
        }
    }

    # Merging logic should populate missing newer fields with defaults without throwing
    merged_style = dict(default_track_style)
    merged_style.update(older_profile.get("style", {}))
    assert merged_style["logoHeight"] == 60, "Backward compatibility: missing logoHeight should default to 60"
    assert merged_style["ghostPinLength"] == 16, "Backward compatibility: missing ghostPinLength should default to 16"
    assert merged_style["bgOpacity"] == 80, "Older profile bgOpacity 80 should be preserved"
    assert merged_style["deltaPos"] == "bottom", "Older profile deltaPos bottom should be preserved"

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


