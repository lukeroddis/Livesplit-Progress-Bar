# Speedrun Overlay — Developer Guide

> **Audience**: Contributors and maintainers working on this codebase.  
> **Purpose**: Establish architectural rules, LiveSplit Server protocol nuances, data schemas, and testing guidelines to avoid regressions, avoid duplicated work, and maintain code stability.

---

## 1. Architectural Philosophy & Core Constraints

1. **Vite Build, Zero-Runtime-Dependency Web Application**:
   - **Rule**: All runtime code must remain local and pure client-side. Vite and `vite-plugin-singlefile` are **devDependencies only**; do **not** add runtime npm dependencies, CDN imports, or remote asset URLs.
   - **Distribution**: `npm run build` is the supported release path. It must produce exactly one fully self-contained `dist/index.html` with JavaScript and CSS inlined and no external or local asset references. The postbuild check ([`verify-single-file.mjs`](scripts/verify-single-file.mjs)) enforces this.
   - **Rationale**: The released single file must run from `file://` in OBS Studio's CEF Browser Source and desktop browsers with no server or companion files.
   - **Source shape**: Keep the application as classic scripts so the generated test runner and direct `file://` debugging continue to work. [index.html](index.html) is the only list of scripts: the Vite build entry and the test runner page are both generated from its `<script>` tags.
2. **Zero-Allocation 60 FPS Render Loop**:
   - Never allocate new DOM nodes or perform expensive querySelectors inside the 33ms animation tick (`requestAnimationFrame`).
   - Only modify `textContent` and `style` transforms on cached element references during live timing.
3. **Modular Vite-Built Architecture**:
   - [index.html](index.html): Clean semantic structure, HUD components, and SVG icons.
   - **`src/styles/` Stylesheets** (linked from `index.html` in cascade order; the Vite build inlines them in the same order):
     `base.css` (design tokens), `hud-layout.css`, `layout-toolbar.css`, `hud-components.css`, `track.css`, `track-nodes.css`, `track-angled.css`, `track-vertical.css`, `settings-menu.css`, `settings-profiles.css`, `track-modal.css`, `widget-popover.css`, `ghost-markers.css`, `toast.css`, `race-pins.css`, `leaderboard.css`, `leaderboard-animations.css`, `leaderboard-badges.css`, `dev-mode.css`. Link order is part of the cascade: add rules to the file that owns the component, and add new files with a `<link>` placed where their rules should win.
   - **`src/core/` Core Speedrun & Persistence Modules**:
     - [`storage.js`](src/core/storage.js): `safeStorage` wrapper with in-memory fallback for sandboxed OBS CEF sources, state persistence, and centralized keys.
     - [`time-utils.js`](src/core/time-utils.js): `timeStringToSeconds`, `formatTimerDisplay`, `formatTargetTime`, and `formatDeltaSeconds`.
     - [`split-engine.js`](src/core/split-engine.js): `.lss` XML parsing, statistical curves (Best/Average/Worst), comparison normalization, and timing method detection.
     - [`split-evaluation.js`](src/core/split-evaluation.js): Pure completed-split classification (gold detection with 50ms buffer, ahead/behind gaining/losing state, leaderboard flash colour).
     - [`ghost-math.js`](src/core/ghost-math.js): Multi-ghost pace interpolation, timescale mismatch defenses, and proximity calculations.
     - [`livesplit-client.js`](src/core/livesplit-client.js): Sequential command queue with probe timeouts and desync guard.
     - [`livesplit-connection.js`](src/core/livesplit-connection.js): LiveSplit Server socket lifecycle (duplicate guard, auto-reconnect, status pill, `sendRaw` for reply-less commands).
     - [`overlay-state.js`](src/core/overlay-state.js): The shared overlay `state` object (splits, comparison curves per timing method, active comparison/method, live run progress). Its JSDoc `OverlayState` typedef documents every field.
     - [`run-tracker.js`](src/core/run-tracker.js): 33ms poll loop and split transitions (reset, start, split advance with skips/golds/PB commit, undo, host progress).
     - [`run-persistence.js`](src/core/run-persistence.js): In-run state save/restore across reloads with split-count/game/category guards.
     - [`comparison-controller.js`](src/core/comparison-controller.js): Active comparison and timing-method curve switching, default curves, timing detection, ghost comparison lookup.
     - [`splits-loader.js`](src/core/splits-loader.js): Applies parsed `.lss` data to state and restores cached splits on startup.
     - [`settings-registry.js`](src/core/settings-registry.js): Live settings described once by id (type, options, surfaces `dock`/`widget`, `instant`/`draft`) with `get`/`set` over the existing controllers, plus `range` entries (whole numbers whose options are the allowed values, e.g. `trackPosition`, the dock's split view slider over `getTrackScrollPosition` / `setTrackScrollPosition` in track-status.js) and `action` entries (`run`, e.g. `trackScroll`) that store nothing. `app.settings` (also `window.LiveSplit.Overlay.settings`) validates values, steps badges (`cycle`), runs actions, takes snapshots and notifies subscribers; `describeSettings(where)` is the plain-data schema the dock renders from. Comparison hotkeys, timer blocks, Standings/Pins buttons, the Layout toolbar visibility checkboxes, widget header hide buttons and popover checkboxes marked `data-setting="<id>"` (e.g. Gold Splits) go through it.
     - [`window-api.js`](src/core/window-api.js): `window.LiveSplit.Overlay`, the overlay API that layout.js and layout-side modules call (`window.LiveSplit.Overlay.refreshTrack?.()`), also copied onto legacy `window.*` names for the console and tests.
     - [race-client.js](src/core/race-client.js): Race client facade: creates isolated clients and their public API, composing the race modules below over one `ctx` (shared `raceState` + functions, same pattern as overlay's `app`).
     - [`race-state.js`](src/core/race-state.js): Per-client race state, host runner defaults (`createHostState`), shared runner resets, `isLiveRoom`. JSDoc typedefs: `RaceState`, `Runner`, `RaceEvent`.
     - [`race-identity.js`](src/core/race-identity.js): Username / race code validation and the stored therun username.
     - [`race-host.js`](src/core/race-host.js): Host progress from LiveSplit, undo, DNF, username matching, timing method, reset.
     - [`race-connection.js`](src/core/race-connection.js): therun.gg REST snapshot, room WebSocket (reopened with backoff if the server drops it, so a rematch in the same room is still heard) and protocol hand-off.
     - `race-protocol.js`, `race-ranking.js`, `race-discovery.js`, `race-logger.js`: message parsing, F1 standings/gaps, auto-detect/standby, WS log.
     - [`race-simulation.js`](src/core/race-simulation.js): Offline race engine (start/stop/standby/reset/undo, 50ms loop, `SIM_RACE_ID`) composing [`race-sim-roster.js`](src/core/race-sim-roster.js) (rival presets + pure `buildCompetitorEntrant`), [`race-sim-lobby.js`](src/core/race-sim-lobby.js) (lobby schedules, countdown, `startRaceNow`) and [`race-sim-pacing.js`](src/core/race-sim-pacing.js) (rival pacing, virtual host). The race client reads the running course via `getSimulationCourseTargets()`.
   - **`src/ui/` Interface & Layout Modules**:
     - [`layout-engine.js`](src/ui/layout-engine.js): `COMPONENTS`, the HUD component ids in layout order (default coordinates live in `layout.js`, anchor resolution in `timer-anchor.js`).
     - [`layout-drag.js`](src/ui/layout-drag.js): Edit-mode pointer drag, the corner handle (scales components; resizes the track, Ctrl/Shift-drag scales it), track docking and on-screen clamping. The header ✕/👁 button toggles `visible.<id>` through the settings registry. Track size lives in its layout state: `verticalWidth` (vertical track, docked or floating: room for split text), `height` (floating vertical: split spacing via track density), `width` (floating horizontal: split spacing) and `nameLines` (horizontal, docked or floating: 1-4 lines split names wrap onto; above 1 the track gets `wrap-names`, which replaces auto 40° tilting).
     - [`track-renderer.js`](src/ui/track-renderer.js): Track DOM building, sliding window math and class application, schematic breaks, scroll-to-split, visible-split capacity, and zero-allocation 60 FPS element caching.
     - [`track-density.js`](src/ui/track-density.js): `--node-spacing` from visible-splits preference, auto 40° angled split names, split-count controls and density/angle cycle badges.
     - [`track-scroll.js`](src/ui/track-scroll.js): Mouse wheel and arrow-key track scrolling (windowed or native scroll).
     - [`ghost-runner.js`](src/ui/ghost-runner.js): Active ghost selection/opacity, on-track ghost markers, race pin rendering hand-off, off-screen edge pills, leaderboard refresh.
     - [`race-controls.js`](src/ui/race-controls.js): Race settings controls (standings/pins toggles, connect/disconnect with cooldown, test race) and race client event handling.
     - [`dock-bridge.js`](src/ui/dock-bridge.js): Experimental OBS Custom Browser Dock bridge: hears `connect` / `disconnect` / `set` / `run` commands from [`dock.html`](dock.html) via localStorage `storage` events (`DOCK_COMMAND`); `set` only reaches dock settings and is validated by the settings registry. The overlay stays the only writer and publishes a v2 status snapshot (`DOCK_STATUS`: race state, the dock settings' schema, values and options, active profile, last command result; v1 race fields kept at the top level) after commands, settings changes, race events and on a 2s heartbeat.
     - [`ws-log-panel.js`](src/ui/ws-log-panel.js): Dev-mode race WebSocket telemetry log modal.
     - [`settings-menu.js`](src/ui/settings-menu.js): Draggable quick-settings panel, position persistence and open/close toggle.
     - [`dev-mode.js`](src/ui/dev-mode.js): Developer mode gating (`?dev`/`?debug`, Ctrl+Shift+D, version 5-click).
     - [`splits-file-loader.js`](src/ui/splits-file-loader.js): `.lss` file picker and window drag-and-drop (`.lss`/`.xml` splits, `.json`/`.lshud` profiles).
     - [leaderboard.js](src/ui/leaderboard.js): Live race F1 timing tower orchestrator (visibility, pre-race detection, mute, Layout Mode preview) over [`leaderboard-row.js`](src/ui/leaderboard-row.js) (pure `describeRow` view model + in-place row DOM), [`leaderboard-banners.js`](src/ui/leaderboard-banners.js) (status badge, countdown / lobby / waiting banners), [`leaderboard-flip.js`](src/ui/leaderboard-flip.js) (FLIP overtake reorder) and [`leaderboard-marquee.js`](src/ui/leaderboard-marquee.js) (scrolling long names).
     - [`track-status.js`](src/ui/track-status.js): Track render, per-split completed/current classes, locked delta display, window shifting, 60 FPS live segment progress.
     - [`timing-controls.js`](src/ui/timing-controls.js): Timer display mode (Game/Real/Both), timing method focus, gold toggle and badges.
     - [`hud-titles.js`](src/ui/hud-titles.js): Game/category labels, tab title, LiveSplit metadata sync.
     - [`hud-bindings.js`](src/ui/hud-bindings.js): Settings pill, comparison hotkeys (through the settings registry), timer block focus.
     - [`widget-popover.js`](src/ui/widget-popover.js): Per-widget settings popovers (`.widget-popover[data-widget]` in index.html): pure `placePopover` (roomiest side of the widget, clamped, height capped; centred when the widget is hidden) and a controller that opens / toggles / closes them, repositions after changes inside, pointer releases and resizes, and closes on outside clicks (not on HUD widgets). Drag by the header / resize from the corner grip (pure `clampBox` keeps the box usable and on screen); a moved popover keeps its box until reload, double-clicking the header puts it back beside its widget.
     - [`layout-modal.js`](src/ui/layout-modal.js): Layout toolbar + widget settings composer (toolbar, logo, hotkeys, resize clamp, settings sync on entering Layout Mode, widget header cogs via `openWidgetSettings(id)` toggle the widget's popover (Title, Timers, Track, Leaderboard = Live Race Settings; Done saves, Reset restores only `TrackStyle.WIDGET_STYLE_KEYS[id]`). Ghost Pins is a popover without a widget of its own (`data-anchor="track"` places it beside the track). Buttons open one: `data-open-widget-popover="<id>"` in Layout Mode (Title / Timer / Track Settings in the menu), `data-open-popover="<id>"` without it (Ghost Pins, Live Race Settings, the Track dialog's ghost link)) over the settings panels. The Customizer modal is gone; `track-modal.css` still styles the export / import / WS log dialogs and the popovers' rows:
       [`settings-track-panel.js`](src/ui/settings-track-panel.js) (orientation, positions, angle, sizes, visible splits), [`settings-background-panel.js`](src/ui/settings-background-panel.js), [`settings-ghost-panel.js`](src/ui/settings-ghost-panel.js), [`settings-timing-panel.js`](src/ui/settings-timing-panel.js), [`layout-profiles-panel.js`](src/ui/layout-profiles-panel.js) (profiles, export/import). Each panel exposes `sync(style)` / `bind()`; [`settings-controls.js`](src/ui/settings-controls.js) holds the shared slider / segmented / spinner / checkbox helpers.
   - [layout.js](layout.js): Interactive drag & drop, proportional scaling, track sizing, visibility toggles, profiles CRUD, widget settings popovers, and `window.hudLayout`.
   - [overlay.js](overlay.js): Composition root (~280 lines). Creates `state` and the shared `app` registry, installs the overlay controllers, wires the stateful UI helpers (connection, ghost runner, track density, menus) and boots the overlay.
   - **Controller pattern**: overlay controllers export `installX(app)`, which adds their functions to `app` and reads/writes `app.state`. Cross-controller calls go through `app.<fn>` at call time, so controllers can load in any order before overlay.js. Self-contained UI helpers keep the `createX({ getters })` factory style. `test_app_registry_calls_are_provided` fails if a controller calls an `app.<fn>` nobody registers.
   - **Shared constants have one owner module** (enforced by `tests/test_project_rules.py`): localStorage keys → `window.LiveSplit.Storage.KEYS` (`src/core/storage.js`, never raw `"livesplit_*"` strings); default track style → `TrackStyle.DEFAULT_TRACK_STYLE`; HUD component ids → `LayoutEngine.COMPONENTS`; built-in comparison names → `SplitEngine.DEFAULT_COMPARISONS`; LiveSplit Server URL → `Client.DEFAULT_WS_URL`. These are frozen; copy (`[...x]`, `Object.assign({}, x)`) before mutating. Keep constants with the module that owns the concept rather than a shared constants file.
   - **Adding a module**: add one `<script>` tag to `index.html` before `layout.js`/`overlay.js`; nothing else needs registering. Every script is an ES module in the Vite build, so share state through `app` / `window.LiveSplit.*` namespaces and injected getters, never through top-level `let` across files.
   - **Cross-module calls go through namespaces**: layout-side code calls the overlay as `window.LiveSplit.Overlay.fn?.(...)` (at call time; the object exists from page load), other modules via `window.LiveSplit.<Module>`, and the overlay calls the layout through `window.hudLayout`. Never read the legacy `window.*` copies from app code; `test_app_code_calls_the_overlay_api_not_window_globals` enforces it.
   - [`vite.config.mjs`](vite.config.mjs): Vite configuration. During a build it swaps the classic script tags for a virtual module entry generated from those same tags, and enables the single-file plugin.
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
* A user toggle (`Discard In-Run Golds on Reset`) is available in the Track settings popover (Layout Mode ⚙ on the track).

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
| `livesplit_hud_layout_v2` | JSON Object | Positions (`x`, `y`, `docked`) and scales for `title`, `timers`, `track`; a floating track also stores the `width` (horizontal) or `height` (vertical) frozen on its first drag or scale. |
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
| `livesplit_last_ghosts` | JSON Array (`string[]`) | Last non-off ghost selection, restored when ghosts are switched back on (`ghostsOn` setting). |
| `livesplit_lss_xml` | String (XML) | Cached `.lss` content for offline/instant reload. |
| `livesplit_dev_mode` | Boolean string (`"true"` / `"false"`) | Enables developer tools (Test Race simulation, WS debug logs, diagnostics). |

### Layout Profile Schema v1 Specification

Layout profiles are stored and exported as formatted JSON with the following extensible structure:

```json
{
  "version": 1,
  "name": "Super Mario 64",
  "exportedAt": "2026-10-13T16:20:00.000Z",
  "generator": "Speedrun Overlay v1.0.0",
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
    "ghostPinSize": 26,
    "pinPos": "auto",
    "pinLane": true,
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

* **Ghost pin side**: `pinPos` is `auto` (top, or the delta side of a vertical track) or an explicit `top`/`bottom`/`left`/`right`, resolved by `TrackStyle.resolvePinSide` into a `pins-<side>` track class. With `pinLane` on, the track also gets `pin-lane`, and while any ghost or race pins are switched on the ghost runner adds `has-pins`; together they push split text on the pin side out by `--pin-lane` so pins never cover it.
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
   - The following functions are part of `window.LiveSplit.Overlay` (and its legacy `window.*` copies) in [window-api.js](src/core/window-api.js), used by layout code and test runners:
     `timeStringToSeconds`, `formatTargetTime`, `formatDeltaSeconds`, `formatDeltaLive`, `normalizeComparisonName`, `getShortComparisonName`, `applyActiveComparison`, `cycleComparison`.
5. **Git Pre-Push Hook**:
   - Repository uses `.githooks/pre-push`. Ensure `git config core.hooksPath .githooks` is active.

> **Test Suite Architecture** (`python tests/run_tests.py` / `npm test` → pytest; install with `pip install -r requirements-dev.txt`):
>
> | Where | What goes there |
> | :--- | :--- |
> | `tests/unit/<core\|ui\|utils>/<module>.test.js` | **Behaviour tests (default home for new tests).** One spec per module, run in headless Chrome against the real scripts. New files are discovered automatically. Cross-module race flows (leaderboard, standings, simulation, live connection, pins) live in `tests/unit/race/<topic>.test.js`. |
> | `tests/test_structure.py` | Cross-file contracts: files parse (`node --check`), DOM ids exist in `index.html`, JS-toggled CSS classes exist in `src/styles/`. |
> | `tests/test_project_rules.py` | Short list of project-wide rules (version sync, blacklisted `gettimingmethod`, no external assets, classic scripts only) plus the ESLint run (`npm run lint`, `no-undef` / `no-unused-vars`, config in `eslint.config.mjs`). |
> | `tests/test_release_bump.py` | `scripts/determine_bump.py` release classification. |
> | `tests/browser/` | Runner page generator (`build_runner.py`), Chrome/CDP driver, coverage maths. |
> | `tests/harness/` | `mini-test.js` (`describe`/`it`/`assert`; `async` tests run serially after sync specs) and `fake-livesplit.js`, a scriptable fake LiveSplit Server installed as `window.WebSocket` so tests never touch a real LiveSplit. Call `FakeLiveSplit.acceptConnection()` and set `FakeLiveSplit.state` to drive the poll loop (see `tests/unit/core/run-tracker.test.js`). `test-utils.js` (`window.TestUtils`): `mountHtml` (temporary DOM that wins over the runner page's own ids), `captureWindowListeners` (call window handlers directly without firing the app's), `withFakeTimers` (manual clock for `setTimeout` / `setInterval` / `Date.now` flows), `stubOverlay` / `stubWindow` / `stubProps` (temporarily replace `window.LiveSplit.Overlay`, `window` or any object's members), `waitFor`. |
> | `tests/fixtures/` | Real-world sample files (`.lss` splits). The runner inlines them as `window.TestFixtures["<file name>"]`; add a file and it is available to every spec (see `tests/unit/core/splits-loader.test.js`). |
>
> **Run modes:** `npm test` (everything, one-line coverage summary), `npm run test:quick` (skip the browser suite), `python tests/run_tests.py --spec race/` (only browser specs whose path contains the substring; repeatable), `npm run test:coverage` (per-file JS coverage table), `npm run lint`.
>
> **Coverage floors:** `pytest.ini` sets `js_coverage_floor` (total) and `js_file_coverage_floor` (every app script). Full runs fail below them; `--spec` runs skip the check. Raise them when coverage improves; lower one only with a reason in the commit.
>
> Do **not** assert on source text (`"function foo" in overlay_js`): it breaks on every refactor and does not test behaviour. Do not re-implement JS logic in Python to test it; test the JS directly. `tests/test_runner.html` is generated (gitignored); edit `tests/test_runner.template.html` for harness changes. The browser suite needs Chrome/Chromium (required when `CI` is set); without `websockets` it falls back to `--dump-dom` and skips coverage.

---

## 6. Commit Messages

- Short imperative title, then a body explaining what changed, why, and how it was verified.
- `Co-authored-by:` trailers are matched to GitHub accounts by email. Only add one whose address belongs to the co-author (a guessable `username@users.noreply.github.com` previously credited an unrelated GitHub user); otherwise credit them in the commit body.

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
* **CSS Visibility Gating**: In [`src/styles/dev-mode.css`](src/styles/dev-mode.css), `.dev-only` elements have `display: none !important;` by default. When active, `body.dev-mode` is added to the DOM and `.dev-only` elements render with `display: flex !important;`.
* **State Persistence**: The active mode is saved to `safeStorage` under the key `livesplit_dev_mode` (`"true"` / `"false"`), surviving page refreshes.
* **Layout Symmetry**: In production mode (`body:not(.dev-mode)`), the Live Race Telemetry settings grid automatically reflows so the remaining tiles fill the grid evenly.
