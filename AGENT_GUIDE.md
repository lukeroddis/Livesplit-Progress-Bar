# LiveSplit Minimal Overlay — Agent & Developer Guide

> **Audience**: AI Agents (Antigravity, Copilot, etc.) and human core maintainers working on this codebase.  
> **Purpose**: Establish architectural rules, LiveSplit Server protocol nuances, data schemas, and testing guidelines to avoid regressions, avoid duplicated work, and maintain code stability.

---

## 1. Architectural Philosophy & Core Constraints

1. **Zero-Build, Pure Client-Side Web Application**:
   - **Rule**: Do **NOT** introduce Node.js build tools (Vite, Webpack, Babel, npm dependencies) as mandatory prerequisites to run or test the overlay.
   - **Rationale**: The overlay is designed to run directly as a static file or local server in OBS Studio's CEF Browser Source and desktop browsers. It must run by opening [index.html](file:///c:/Users/Luke/Livesplit-Progress-Bar/index.html) directly.
2. **Zero-Allocation 60 FPS Render Loop**:
   - Never allocate new DOM nodes or perform expensive querySelectors inside the 33ms animation tick (`requestAnimationFrame`).
   - Only modify `textContent` and `style` transforms on cached element references during live timing.
3. **Modular File Structure**:
   - [index.html](file:///c:/Users/Luke/Livesplit-Progress-Bar/index.html): Clean semantic structure and SVG icons.
   - [style.css](file:///c:/Users/Luke/Livesplit-Progress-Bar/style.css): Glassmorphic HUD styles, typography, layout editor UI, and animations.
   - [layout.js](file:///c:/Users/Luke/Livesplit-Progress-Bar/layout.js): Interactive drag & drop, proportional scaling, visibility toggles, modal customizers, and localStorage state persistence.
   - [overlay.js](file:///c:/Users/Luke/Livesplit-Progress-Bar/overlay.js): WebSocket connection to LiveSplit Server, `.lss` XML parsing, 4-state delta engine, timer formatting, and comparisons.

---

## 2. LiveSplit Server Protocol Nuances (`ws://localhost:16834/livesplit`)

LiveSplit Server is a single-threaded TCP socket bridge. Deviating from these protocol constraints will crash communication or induce severe UI desynchronization:

### ⚠️ Blacklisted Commands
* **`gettimingmethod`**: **STRICTLY BLACKLISTED**. Do **never** query this command. LiveSplit Server does not implement it; queries hang indefinitely until socket timeout (80ms), blocking the entire command queue.
* Timing method must be inferred from the state of active timers (`igt` vs `rta`) or set via `switchto gametime` / `switchto realtime`.

### High-Frequency Polling (Every 33ms)
Only query the 3 core state values during active runs:
1. `getcurrentgametime`
2. `getcurrentrealtime`
3. `getsplitindex`

### Event-Driven Transition Queries
Query these **strictly upon split index transition, start, or reset**:
* `getlastsplittime`: Recorded cumulative split duration.
* `getdelta`: Official LiveSplit delta string.
* `getcomparisonsplittime`: Active comparison target for the current segment.
* `getgamename` & `getcategoryname`: Game metadata.

### Reset Behavior & Gold Splits
* **LiveSplit Dialog Limitation**: LiveSplit's desktop application asks the user whether to save beaten best segments on reset. The WebSocket server does **not** broadcast this dialog's outcome.
* **Default Policy**: The overlay **discards temporary in-run golds upon receiving a reset signal (`getsplitindex = -1`)** by default, protecting official `.lss` baselines from aborted runs.
* A user toggle (`Discard In-Run Golds on Reset`) is available in the Bar Styles modal.

---

## 3. Data Processing & Algorithm Specifications

### 1. `.lss` XML Parsing & Segment History
* `<BestSegmentTime>` can become stale or unpopulated in exported `.lss` files.
* Parse all history attempts from `<SegmentHistory><Time>`:
  $$\text{BestSegment}_{\text{effective}} = \min\left(\text{BestSegmentTime}, \min(\text{SegmentHistory})\right)$$
* Apply a 50ms buffer when detecting in-run gold splits to prevent false positives from sub-frame jitter:
  $$\text{isGold} \iff \text{segmentDuration} < (\text{bestSec} - 0.05)$$

### 2. Statistical Curves Monotonicity
* When calculating **Average Segments** and **Worst Segments** from `<SegmentHistory>`, ensure every computed segment duration is strictly positive ($> 0$).
* If historical duration is missing or non-positive, fallback to PB segment duration or `bestSegmentTimes`.
* Cumulative sums must always maintain mathematical ordering:
  $$\text{Best Segments} \le \text{Average Segments} \le \text{Worst Segments}$$

### 3. Dynamic Live Delta Reveal
* While the runner is on pace for a Gold split ($t_{\text{elapsed}} \le t_{\text{best}}$), the active split delta is kept hidden (`#delta-val-${idx}` is empty).
* Once $t_{\text{elapsed}} > t_{\text{best}}$, reveal the delta immediately and tick in memory ($t_{\text{current}} - t_{\text{target}}$) without extra WebSocket roundtrips.

### 4. 40° Angle Mode (Anti-Collision Guarantee)
* When angled text is enabled or auto-triggered:
  * **Angle applies strictly to Split Titles** (`.split-name`).
  * **Deltas and Timers remain strictly flat (0°)** and are forced to the opposite side of the connector bar line:
    - Split Names on Top $\implies$ Deltas/Timers on Bottom.
    - Split Names on Bottom $\implies$ Deltas/Timers on Top.
  * This prevents title and timer text from ever colliding.

### 5. Live Ghost Runner Calculation (`calculateGhostProgress`)
* Given current run elapsed seconds $t$ and cumulative comparison split timestamps $C = [c_0, c_1, \dots, c_n]$:
  - If $t \ge c_n$: Ghost has finished (progress 1.0 at final split).
  - Else find interval $c_{k-1} \le t < c_k$. Progress ratio $p = \frac{t - c_{k-1}}{c_k - c_{k-1}}$.
  - Physical X: $\text{X}_{\text{ghost}} = \text{startX}_k + p \times (\text{endX}_k - \text{startX}_k)$.
  - Screen bounds check: If $\text{X}_{\text{ghost}} < \text{scrollLeft}$, activate left edge pill (`❮ 🏆`); if $\text{X}_{\text{ghost}} > \text{scrollLeft} + \text{clientWidth}$, activate right edge pill (`🏆 ❯`).

---

## 4. LocalStorage Keys & State Schema

| Key | Type / Format | Purpose |
| :--- | :--- | :--- |
| `livesplit_hud_layout_v2` | JSON Object | Positions (`x`, `y`, `docked`) and scales for `title`, `timers`, `track`. |
| `livesplit_visible_splits` | String (`"auto"`, `"all"`, or `"2"`–`"60"`) | Number of splits visible on track. |
| `livesplit_split_angle` | String (`"auto"`, `"angle"`, `"flat"`) | Split name tilt angle preference. |
| `livesplit_ghost_comparison` | String (`"off"`, `"wr"`, `"pb"`, `"best"`, `"average"`, or custom) | Live ghost runner comparison target. |
| `livesplit_ghost_opacity` | String / Integer (`"30"`–`"100"`) | Live ghost pin visual opacity percentage. |
| `livesplit_bg_opacity` | Float (`0.0`–`0.95`) | Frosted glass background opacity. |
| `livesplit_bg_blur` | Integer (`0`–`20`) | Background backdrop-filter blur in pixels. |
| `livesplit_bg_targets` | JSON Object (`{title: bool, timers: bool, track: bool}`) | Independent background plate toggles. |
| `livesplit_track_styles` | JSON Object | Font sizes, bar thickness, dot size, name/delta positions. |
| `livesplit_settings_pos` | JSON Object (`{left, top}`) | Saved screen coordinates for the draggable settings panel. |
| `livesplit_timer_display_mode` | String (`"gametime"`, `"realtime"`, `"both"`) | Timer display visibility mode. |
| `livesplit_timing_method` | String (`"GameTime"`, `"RealTime"`) | Active primary timing method focus. |
| `livesplit_timing_method_manual` | Boolean string (`"true"` / `"false"`) | Whether runner manually overrode timing method focus. |
| `livesplit_discard_gold_on_reset` | Boolean | Whether to discard in-run golds when a reset signal arrives. |
| `livesplit_custom_logo` | String (Data URL or URI) | Custom uploaded game logo image replacing text title. |
| `livesplit_profiles_index` | JSON Array (`string[]`) | Registered profile names list (`["Default", "Mario 64", ...]`). |
| `livesplit_active_profile` | String | Name of the currently active layout profile. |
| `livesplit_profile_<name>` | JSON Object | Saved layout profile with schema v1 structure. |
| `livesplit_lss_xml` | String (XML) | Cached `.lss` content for offline/instant reload. |

### Layout Profile Schema v1 Specification

Layout profiles are stored and exported as formatted JSON with the following extensible structure:

```json
{
  "$schema": "https://lukeroddis.github.io/Livesplit-Progress-Bar/schema/layout-v1.json",
  "schemaVersion": 1,
  "name": "Super Mario 64",
  "exportedAt": "2026-10-13T16:20:00.000Z",
  "generator": "LiveSplit Minimal Overlay v1.0.0",
  "components": {
    "title": { "x": 42, "y": 30, "scale": 1.0, "visible": true },
    "timers": { "x": 42, "y": 90, "scale": 1.15, "visible": true },
    "track": { "x": 0, "y": 990, "scale": 1.0, "visible": true, "docked": "bottom" }
  },
  "style": {
    "orientation": "horizontal",
    "namePos": "top",
    "deltaPos": "bottom",
    "bgOpacity": 55,
    "bgBlur": 8,
    "bgTargets": { "title": true, "timers": true, "track": true },
    "nameFontSize": 17,
    "deltaFontSize": 15,
    "barHeight": 6,
    "dotSize": 15,
    "ghostPinLength": 16,
    "logoHeight": 60
  },
  "preferences": {
    "timerDisplayMode": "both",
    "timingMethodFocus": "GameTime",
    "ghostComparison": "wr,pb",
    "ghostOpacity": 85,
    "splitDensity": "auto",
    "splitAngle": "auto",
    "discardGoldsOnReset": true,
    "syncHotkeys": true
  },
  "customLogo": "data:image/png;base64,..."
}
```

* **Backward Compatibility**: If an older layout missing newer properties (e.g. `logoHeight` or future properties) is loaded, `applyProfileData` deep-merges with `getDefaultLayout()` and `DEFAULT_TRACK_STYLE` so default values are gracefully applied without errors.
* **Forward Compatibility**: Unknown future properties present in layout files do not throw errors or break loading.

---

## 5. Testing & Verification Checklist Before Any Commit

Before committing any changes, you must ensure:

1. **Automated Test Suite**:
   ```bash
   python tests/run_tests.py
   ```
   Must pass with **100% green**.
2. **DOM Reference Validation**:
   - Any new element added in [index.html](file:///c:/Users/Luke/Livesplit-Progress-Bar/index.html) must have a consistent `id`.
   - Any `document.getElementById` added in JS must match an ID in `index.html`.
3. **Do Not Break Exported Helpers**:
   - The following functions in [overlay.js](file:///c:/Users/Luke/Livesplit-Progress-Bar/overlay.js) are exported on `window` for layout interop and test runners:
     `timeStringToSeconds`, `formatTargetTime`, `formatDeltaSeconds`, `formatDeltaLive`, `normalizeComparisonName`, `getShortComparisonName`, `applyActiveComparison`, `cycleComparison`.
4. **Git Pre-Push Hook**:
   - Repository uses `.githooks/pre-push`. Ensure `git config core.hooksPath .githooks` is active.

---

## 6. Commit Message Attribution Standard

To maintain transparency without tagging third-party GitHub users (since GitHub matches `Co-authored-by:` emails to existing GitHub accounts, including `username@users.noreply.github.com`), **do not** use `Co-authored-by:` trailers.

Instead, place the attribution statement directly within the commit body:

```text
<Short imperative commit title>

<Detailed summary of changes, rationale, and verification performed>

🤖 Generated with Antigravity (Google DeepMind)
Reviewed, tested, and approved by Luke.
```
