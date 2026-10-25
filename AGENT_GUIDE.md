# LiveSplit Minimal Overlay — Agent & Developer Guide

> **Audience**: AI Agents (Antigravity, Copilot, etc.) and human core maintainers working on this codebase.  
> **Purpose**: Establish architectural rules, LiveSplit Server protocol nuances, data schemas, and testing guidelines to avoid regressions, avoid duplicated work, and maintain code stability.

---

## 1. Architectural Philosophy & Core Constraints

1. **Vite Build, Zero-Runtime-Dependency Web Application**:
   - **Rule**: All runtime code must remain local and pure client-side. Vite and `vite-plugin-singlefile` are **devDependencies only**; do **not** add runtime npm dependencies, CDN imports, or remote asset URLs.
   - **Distribution**: `npm run build` is the supported release path. It must produce exactly one fully self-contained `dist/index.html` with JavaScript and CSS inlined and no external or local asset references. The postbuild check ([`verify-single-file.mjs`](scripts/verify-single-file.mjs)) enforces this.
   - **Rationale**: The released single file must run from `file://` in OBS Studio's CEF Browser Source and desktop browsers with no server or companion files.
   - **Source shape**: Keep the application as classic scripts so the existing test runner and direct `file://` debugging continue to work. [`src/build-entry.js`](src/build-entry.js) imports them in `<script>` order; keep it synchronized when adding or removing source scripts.
2. **Zero-Allocation 60 FPS Render Loop**:
   - Never allocate new DOM nodes or perform expensive querySelectors inside the 33ms animation tick (`requestAnimationFrame`).
   - Only modify `textContent` and `style` transforms on cached element references during live timing.
3. **Modular Vite-Built Architecture**:
   - [index.html](index.html): Clean semantic structure, HUD components, and SVG icons.
   - [style.css](style.css): Glassmorphic HUD styles, typography, layout editor UI, and animations.
   - **`src/core/` Core Speedrun & Persistence Modules**:
     - [`storage.js`](src/core/storage.js): `safeStorage` wrapper with in-memory fallback for sandboxed OBS CEF sources, state persistence, and centralized keys.
     - [`time-utils.js`](src/core/time-utils.js): `timeStringToSeconds`, `formatTimerDisplay`, `formatTargetTime`, and `formatDeltaSeconds`.
     - [`split-engine.js`](src/core/split-engine.js): `.lss` XML parsing, statistical curves (Best/Average/Worst), comparison normalization, and timing method detection.
     - [`ghost-math.js`](src/core/ghost-math.js): Multi-ghost pace interpolation, timescale mismatch defenses, and proximity calculations.
     - [`livesplit-client.js`](src/core/livesplit-client.js): Sequential command queue, socket lifecycle, and protocol safeguards.
     - [race-client.js](src/core/race-client.js): therun.gg/racetime.gg live telemetry bridge, F1-style continuous scoring, leader gap/interval calculations, and local simulated race engine.
   - **`src/ui/` Interface & Layout Modules**:
     - [`layout-engine.js`](src/ui/layout-engine.js): Component geometry, default coordinates, and timer expansion anchor resolution.
     - [`track-renderer.js`](src/ui/track-renderer.js): Sliding window math, schematic breaks, and zero-allocation 60 FPS element caching.
     - [`interactions.js`](src/ui/interactions.js): Scroll wheel / arrow key navigation, comparison hotkeys, and input guards.
     - [leaderboard.js](src/ui/leaderboard.js): Live race F1 timing tower controller, 60 FPS FLIP overtake reorder animations, and entrant mute controls.
   - [layout.js](layout.js): Interactive drag & drop, proportional scaling, visibility toggles, profiles CRUD, modal customizers, and `window.hudLayout`.
   - [overlay.js](overlay.js): Application bootstrap, high-frequency render ticks, and LiveSplit Server WebSocket bridge.
   - [`vite.config.mjs`](vite.config.mjs): Vite configuration. During a build it swaps the classic script tags for the module build entry and enables the single-file plugin.
   - [`src/build-entry.js`](src/build-entry.js): Build-only entry that imports every source script in its original `<script>` order. It is not loaded when opening `index.html` directly.
   - [`scripts/verify-single-file.mjs`](scripts/verify-single-file.mjs): Postbuild contract check for the generated `dist/index.html`; run automatically by `npm run build`.
   - `dist/index.html`: Generated, fully self-contained distribution file. It is git-ignored and attached to GitHub releases.

---

## 2. LiveSplit Server Protocol Nuances (`ws://localhost:16834/livesplit`)

LiveSplit Server is a single-threaded WebSocket bridge (natively built-in as of LiveSplit v1.8.30+ under `Right-click → Control → Start WebSocket Server`, or via legacy `LiveSplit.Server.dll` in v1.7.0+). Deviating from these protocol constraints will crash communication or induce severe UI desynchronization:

### ⚠️ Blacklisted Commands
* **`gettimingmethod`**: **STRICTLY BLACKLISTED**. Do **never** query this command in overlay polling or communication loops.
  * *Why:* While modern LiveSplit core (v1.8.30+ / v1.8.37 built-in WebSocket server) technically implements `gettimingmethod`, the standalone `LiveSplit.Server.dll` (which many runners still use) does **not** implement it. Unhandled command queries in older servers hang indefinitely until socket timeout (80ms), blocking the entire command queue.
  * Furthermore, the overlay already polls `getcurrentgametime` and `getcurrentrealtime` on every 33ms tick, making an additional round-trip query redundant.
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

  $$
  \text{BestSegment}_{\text{effective}} = \min\left(\text{BestSegmentTime}, \min(\text{SegmentHistory})\right)
  $$

* Apply a 50ms buffer when detecting in-run gold splits to prevent false positives from sub-frame jitter:

  $$
  \text{isGold} \iff \text{segmentDuration} < (\text{bestSec} - 0.05)
  $$

### 2. Statistical Curves Monotonicity
* When calculating **Average Segments** and **Worst Segments** from `<SegmentHistory>`, ensure every computed segment duration is strictly positive (> 0 seconds).
* If historical duration is missing or non-positive, fallback to PB segment duration or `bestSegmentTimes`.
* Cumulative sums must always maintain mathematical ordering:

  $$
  \text{Best Segments} \le \text{Average Segments} \le \text{Worst Segments}
  $$

### 3. Dynamic Live Delta Reveal
* While the runner is on pace for a Gold split ($t_{\text{elapsed}} \le t_{\text{best}}$), the active split delta is kept hidden (`#delta-val-{idx}` is empty).
* Once $t_{\text{elapsed}} > t_{\text{best}}$, reveal the delta immediately and tick in memory ($t_{\text{current}} - t_{\text{target}}$) without extra WebSocket roundtrips.

### 4. 40° Angle Mode (Anti-Collision Guarantee)
* When angled text is enabled or auto-triggered:
  * **Angle applies strictly to Split Titles** (`.split-name`).
  * **Deltas and Timers remain strictly flat (0°)** and are forced to the opposite side of the connector bar line:
    - Split Names on Top ⟹ Deltas/Timers on Bottom.
    - Split Names on Bottom ⟹ Deltas/Timers on Top.
  * This prevents title and timer text from ever colliding.

### 5. Live Ghost Runner Calculation (`calculateGhostProgress`)
* Given current run elapsed seconds $t$ and cumulative comparison split timestamps $C = [c_0, c_1, \dots, c_n]$:
  - If $t \ge c_n$: Ghost has finished (progress 1.0 at final split).
  - Else find interval $c_{k-1} \le t < c_k$. Progress ratio:

    $$
    p = \frac{t - c_{k-1}}{c_k - c_{k-1}}
    $$

  - Track coordinate interpolation:

    $$
    \text{ghostCoord} = \text{startCoord}_k + p \times (\text{endCoord}_k - \text{startCoord}_k)
    $$

    *(Mapped to X in horizontal track mode, Y in vertical track mode).*
  - Screen bounds check: If `ghostCoord < scrollOffset + 25`, activate leading edge pill (`❮ 🏆`); if `ghostCoord > scrollOffset + clientSpan - 25`, activate trailing edge pill (`🏆 ❯`).

### 6. Skipped Splits & Incomplete Comparison Data
* **Skipped Split Detection**:
  - LiveSplit Server does not record a new split time when a split is skipped; `getlastsplittime` returns the time of the previous completed split (or `"-"` / `null`).
  - A split is recorded as completed if and only if `parsedLastSplit > lastSplitRecordedSec + 0.001`.
  - If not, it is marked as skipped (`isSkipped = true`, `splitTimeSec = null`).
* **Uncoloured Styling & Dash Deltas**:
  - Skipped splits and splits with incomplete data (e.g. fresh new splits with no PB comparison targets) are assigned `stateClass = "uncoloured"`.
  - The progress bar segment fill is styled with `.segment-bar-fill.uncoloured` (`#475569`, no colored glow).
  - The node dot is styled with `.split-item.completed.uncoloured .dot` (`#334155`).
  - The delta is displayed as `"-"` (`.delta-uncoloured`).
  - For completed splits on fresh splits, `timeSpan` displays the recorded split time, whereas for skipped splits `timeSpan` displays `"-"`.

### 7. Comparison Switching & Keyboard Hotkeys
* **Hotkeys**:
  - `C` or `NumPad 6` or `]`: Cycle forward to the next comparison.
  - `Shift + C` or `NumPad 4` or `[`: Cycle backward to the previous comparison.
* **Safety Guards**:
  - Hotkeys are suppressed when typing in form inputs (`INPUT`, `TEXTAREA`, `SELECT`).
  - Hotkeys are suppressed when Edit Layout Mode is active.
* **Transient HUD Toast Notification**:
  - When switching comparisons via hotkey, badge click, or LiveSplit hotkey auto-sync, a glassmorphic `#hud-toast` notification pill is rendered for 1.8 seconds.
  - Changes are synchronized to LiveSplit Server via WebSocket command `setcomparison <name>`.

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
| `livesplit_always_show_last_split` | Boolean string (`"true"` / `"false"`) | Whether to pin the final split at the track end with schematic `//` break. |
| `livesplit_in_run_state` | JSON Object | In-run deltas, segment progress, and completed split times for refresh persistence. |
| `livesplit_timer_anchor` | String (`"auto"`, `"right"`, `"left"`) | Timer expansion direction and anchoring mode. |
| `livesplit_sync_hotkeys` | Boolean string (`"true"` / `"false"`) | Whether comparison and timing method auto-sync with LiveSplit hotkeys. |
| `livesplit_active_ghosts` | JSON Array (`string[]`) | Active multi-ghost comparison runner identifiers (`["wr", "pb", ...]`). |
| `livesplit_lss_xml` | String (XML) | Cached `.lss` content for offline/instant reload. |
| `livesplit_dev_mode` | Boolean string (`"true"` / `"false"`) | Enables developer tools (Test Race simulation, WS debug logs, diagnostics). |

### Layout Profile Schema v1 Specification

Layout profiles are stored and exported as formatted JSON with the following extensible structure:

```json
{
  "version": 1,
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
   npm ci
   npm test
   ```
   Must pass with **100% green**.
2. **Single-File Build**:
   ```bash
   npm run build
   ```
   - `dist/` must contain only `index.html`.
   - The postbuild check must report no external or local asset references and confirm JS/CSS are inlined.
   - The built file must initialize when opened from `file://`.
3. **DOM Reference Validation**:
   - Any new element added in [index.html](index.html) must have a consistent `id`.
   - Any `document.getElementById` added in JS must match an ID in `index.html`.
4. **Do Not Break Exported Helpers**:
   - The following functions in [overlay.js](overlay.js) are exported on `window` for layout interop and test runners:
     `timeStringToSeconds`, `formatTargetTime`, `formatDeltaSeconds`, `formatDeltaLive`, `normalizeComparisonName`, `getShortComparisonName`, `applyActiveComparison`, `cycleComparison`.
5. **Git Pre-Push Hook**:
   - Repository uses `.githooks/pre-push`. Ensure `git config core.hooksPath .githooks` is active.

> **Test Suite Architecture**: In-browser unit tests are modularized under `tests/unit/core/` and `tests/unit/ui/` with a lightweight test framework harness in `tests/harness/mini-test.js`. When adding tests for a module, add or edit the corresponding spec file (e.g. `tests/unit/core/race-client.test.js`, `tests/unit/ui/leaderboard.test.js`) rather than modifying `test_runner.html` directly. The browser suite requires Chrome/Chromium; without `websockets` it falls back to `--dump-dom` and skips coverage. A Vitest/browser-test consolidation is future work; prefer behavior-level tests for new code.

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

---

## 7. Developer & Diagnostics Mode (Feature Gating)

To maintain a clean, distraction-free interface for standard livestreaming while preserving powerful testing and inspection tools during development, developer features are tagged with the `.dev-only` class:
* **🧪 Test Race (`#race-sim-badge`)**: Local high-fidelity race simulation test engine.
* **📜 WS Logs (`#btn-open-ws-logs`)**: Real-time incoming/outgoing WebSocket telemetry stream inspector and JSON payload exporter.

### Methods to Activate Developer Mode

Developer Mode can be activated via any of the following 4 methods:

1. **URL Query Parameter (Recommended for OBS & Testing Links)**:
   Append `?debug=true` or `?dev=true` (or `?debug=1` / `?dev=1`) to the overlay URL:
   ```text
   http://localhost:8080/index.html?debug=true
   ```
   *OBS Studio Browser Source Tip*: Open the Browser Source properties in OBS and add `?debug=true` to the URL.

2. **Global Keyboard Hotkey**:
   Press <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>D</kbd> (or <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>D</kbd> on macOS) anywhere on the overlay. A HUD toast notification will confirm:
   `🛠️ Developer Mode: Enabled (Test Race & WS Logs visible)`.

3. **In-App Quick Unlock (Settings Footer Easter Egg)**:
   Open the Settings menu (<kbd>S</kbd> or click the gear), scroll to the footer, and **click the version label (`#overlay-version`, e.g. `v1.0.3`) 5 times** within 2.5 seconds.

4. **Console Helper**:
   Open browser Developer Tools (<kbd>F12</kbd>) and execute:
   ```javascript
   window.toggleDevMode(); // Toggles between Enabled and Disabled
   // or explicitly:
   window.setDevMode(true);  // Enable
   window.setDevMode(false); // Disable
   ```

### Implementation Details & Architecture
* **CSS Visibility Gating**: In [`style.css`](style.css), `.dev-only` elements have `display: none !important;` by default. When active, `body.dev-mode` is added to the DOM and `.dev-only` elements render with `display: flex !important;`.
* **State Persistence**: The active mode is saved to `safeStorage` under the key `livesplit_dev_mode` (`"true"` / `"false"`), surviving page refreshes.
* **Layout Symmetry**: In production mode (`body:not(.dev-mode)`), the Live Race Telemetry settings grid automatically reflows so the remaining tiles fill the grid evenly.
