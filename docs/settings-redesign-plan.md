# Settings redesign plan: OBS dock + per-widget settings

Status: in progress. Step 1 (race-code dock) shipped in `22b83ee`; steps 2 (settings registry), 3 (widget cog + close) and 4 (general dock bridge) shipped; step 5 (dock UI) shipped, waiting for a real OBS test. Order revised 2026-10-31: widget cog / close buttons moved earlier.

## Goal

The settings menu and the HUD & Progress Bar Customizer modal have grown too large to use mid-stream. Split them by **when** people change things:

- **Live controls** (changed between runs or mid-stream) move to the **OBS dock** (`dock.html`), so streamers never touch the scene.
- **Setup and appearance** (changed once, while looking at the result) stay **in the overlay**, but move from one big modal to a **cog on each widget** in Layout Mode.
- Every setting stays reachable inside the overlay. The dock is a convenience, not a requirement: plenty of users won't set up a dock, it only works with a `file:///` browser source URL, and the overlay is also used in desktop browsers.

## Where each current setting goes

| Setting (current control) | Dock | Widget cog | Notes |
|---|:-:|:-:|---|
| Race code, Connect / Disconnect | ✅ shipped | (settings menu) | |
| Standings on/off (`btn-toggle-leaderboard`) | ✅ | Leaderboard | |
| Race pins on/off (`btn-toggle-race-pins`) | ✅ | Leaderboard | |
| Test race (dev) | ✅ dev only | | |
| Active comparison (`comparison-badge`, `select-active-comparison`) | ✅ | Timers | Also hotkeys `C` / `Shift+C` |
| Ghost target (`ghost-badge`, ghost pills) | ✅ | Track | |
| Timing method (`timing-method-badge`) | ✅ | Timers | |
| Timer display mode GT/RT/Both | ✅ | Timers | |
| Ghost pins on/off (keeps the chosen ghosts) | ✅ | Track | New: today "off" forgets the ghost selection |
| Golds on/off (`gold-toggle-badge`) | ✅ | Track | |
| Visible splits count / Fit all / Auto | ✅ | Track | Spinbox in dock |
| Scroll through splits ◀ / ▶ / back to live | ✅ | | New. Action buttons plus a "Split view" slider (`trackPosition`) and the mouse wheel over either; covers both the sliding window (`shiftTrackWindow`) and native scroll |
| Show/hide title, timers, track (`cb-toggle-*`) | ✅ | (Layout toolbar) | Handy for scene changes |
| Layout profile switch (`select-layout-profile`) | ✅ | (settings menu) | Dock must refresh its whole state after a switch |
| Load `.lss` splits | | (settings menu) | Needs the file picker / drop |
| Track orientation, split angle, dock track | | Track | |
| Typography, bar & dot geometry | | Track | |
| Ghost pin length / size / opacity | | Track | |
| Background plate opacity / blur / per-widget plates | | each widget | Plate settings belong to their own widget |
| Game title & custom logo, logo height | | Title | |
| Always show last split | | Track | |
| Sync LiveSplit hotkeys | | Timers | |
| Discard golds on reset | | Track | |
| Profile save / save as / delete / export / import | | (settings menu) | Stays a global menu |
| WS telemetry log (dev) | | (settings menu) | |

The "settings menu" left at the end is small: splits file, profiles, import/export, race code, Layout Mode button, dev tools.

## Design

### 1. One settings registry, two renderers

Describe each setting once, in a new pure module `src/core/settings-registry.js`:

```js
{ id: "visibleSplits", label: "Visible splits", group: "track", where: ["dock", "widget"],
  type: "int" | "bool" | "enum" | "range" | "action",
  options / min / max / step,
  get: (app) => ..., set: (app, value) => ... }
```

- The dock and the per-widget panels both build their controls from this list, so a setting is never implemented twice.
- `get` / `set` call the existing controllers (`app.fn(...)`, `hudLayout`, race client), so behaviour stays exactly as it is today. The existing badge and button handlers become thin wrappers over `set`.
- Pure parts (the list itself, value validation, which settings show where) get unit specs.

### 2. The overlay is the only writer

The dock must never write settings straight into storage: the overlay holds them in memory (`app.state`, `hudLayout` state, track style) and would overwrite the dock's change on its next save. Extend the race bridge pattern:

- Dock → overlay: `DOCK_COMMAND` `{ action: "set", setting, value, id }` (`id` being the command id, as today) (plus the existing `connect` / `disconnect`).
- Overlay → dock: `DOCK_STATUS` becomes a full snapshot `{ settings: { id: value, ... }, race: {...}, profile, at }`, published after every change, on profile switches and on the heartbeat.
- The dock renders purely from the snapshot, so it can't drift from the overlay. A change made in the overlay itself shows up in the dock within a heartbeat.
- `race-dock-bridge.js` becomes `dock-bridge.js`; it validates every incoming value against the registry before calling `set`.

### 3. Dock page

- Grows from the race card to a few collapsible sections (Race, Run, Track, Visibility), generated from the registry.
- Must stay one self-contained HTML file. Instead of generating it at build time, the overlay publishes the dock settings' schema (labels, types, groups, option labels) in its status and `dock.html` builds its controls from that, so new registry settings show up without touching the dock. The two storage key names it still needs are checked against `Storage.KEYS` by `tests/test_structure.py`.
- Fits a narrow dock (about 250–350px wide); dark by default to match OBS.

### 4. Per-widget cogs in Layout Mode

- In Layout Mode each widget (title, timers, track, leaderboard) shows a cog and a close (hide) button.
- The cog opens a small popover anchored to that widget, listing only that widget's registry entries.
- Keep the Customizer's **Save / Reset** draft model for appearance settings (live preview, then save or revert). Live controls apply instantly as they do now. The registry marks each setting as `instant` or `draft`.
- Once every Customizer section has a home, remove the big modal.

## Steps

Each step ships on its own, with `npm test` and `npm run build` green.

1. ✅ **Race-code dock** (done).
2. ✅ **Settings registry.** `src/core/settings-registry.js` holds the live controls (comparison, timers shown, timing method, golds, visible splits, ghosts, race pins, component visibility) and `app.settings` routes the HUD badges, comparison hotkeys, timer blocks, Standings / Pins buttons and toolbar visibility checkboxes through it. Not yet in it: layout profile switch, ghost pins on/off, split scrolling (action type), test race.
3. ✅ **Widget cog + close.** In Layout Mode each widget gets a cog and a close (hide) button. Close sets `visible.<widget>` (the Layout toolbar keeps the checkboxes to bring a widget back). The cog first opens the existing Customizer scrolled to that widget's section, so it is useful straight away. Done: the old 👁 header button became ✕ (hide) / 👁 (show again on a dimmed hidden widget); the leaderboard's cog opens the settings menu's race section, as the Customizer has nothing for it yet.
4. ✅ **General dock bridge.** `set` commands and state snapshots, replacing the race-only bridge. Keep `connect` / `disconnect` working so old dock files still work. Done as `src/ui/dock-bridge.js`; status v2 is `{ v, state, raceId, race, settings: { values, options }, profile, lastCommandId, lastResult, at }`.
5. ✅ **Dock UI.** Generated sections for the live controls, plus split scrolling and ghost pins on/off. Done: sections built from the status schema (see Design 3); new `ghostsOn` (remembers the selection in `LAST_GHOSTS`) and the `trackScroll` action (◀ / Current / ▶, sliding window or native scroll). **Still to do: test in real OBS (Luke).**
6. ✅ **Popovers replace the Customizer**, one widget per commit: Track first (the largest part), then Timers, Title / logo, Leaderboard, Backgrounds. Popovers open on the side of the widget with more free space so they don't cover it. Remove the modal at the end.
   - ✅ Track: `src/ui/widget-popover.js` + `#widget-popover-track` hold orientation, positions, visible splits / angle, typography, bar & dot, ghost pins and discard-golds. Changes apply live as before; Done saves, Reset Track restores only the track's style keys. The Customizer keeps a button that opens it. Resetting back to the default orientation now re-docks the track (also fixes the Customizer's Reset Styles).
   - ✅ Timers: `#widget-popover-timers` holds comparisons, hotkey info, LiveSplit sync, visible timers, primary timer and timer expansion (no reset: timers have no style keys).
   - ✅ Title: `#widget-popover-title` holds the logo upload / text title switch and logo height; Reset Title restores the logo height and keeps the logo.
   - ✅ Backgrounds: each popover has its own plate toggle (and its reset restores it); the shared opacity / blur are "Plates" / "Blur" sliders in the Layout toolbar.
   - ✅ Customizer removed. The toolbar's Bar Styles button is gone (the toolbar fits a 1280 canvas again); the settings menu's button is now ⚙ Widget Settings (Layout Mode + Track popover). Popovers keep clear of the toolbar. The leaderboard cog still opens the settings menu's race section (a Leaderboard popover can come with step 7).
7. **Slim the settings menu** down to the global items. Update README screenshots and the developer guide.
   - ✅ Menu: the Pace & Comparisons and Track & Display badge sections are gone (each setting lives in a popover, the toolbar or the dock; Gold Splits joined the Track popover as a registry-bound `data-setting` checkbox) along with their badge code. Left: splits file, race, Widget Settings / Layout Mode, profiles, import / export. Loading a profile now applies its ghosts straight away.
   - ✅ README text and developer guide.
   - ✅ Follow-up after OBS testing: the menu is just "Settings" (no hint line); Widget Settings is now Track Settings; the race section moved into a Live Race Settings popover (the leaderboard's popover: its cog opens it too, the menu button opens it without Layout Mode, centred when the standings are hidden).
   - ✅ Settings popovers can be dragged by their header and resized from a corner grip; they keep that box until reload (double-click the header to put one back).
   - ✅ The menu has a button per settings dialog (Title, Timer, Track, Ghost Pins, Live Race). Ghost pins moved out of the Track dialog into their own Ghost Pins dialog (beside the track, linked from the Track dialog; its reset covers the pin style, which race pins share).
   - **Still to do (Luke): new README screenshots** of a widget popover and the dock; `assets/HUDCustomiser.png` is no longer referenced.

## Open questions

- **Old saved data after switching to a `file:///` URL.** Users who move off *Local file* lose access to their saved data (different origin). Could the overlay offer a one-click "copy settings to clipboard / paste" migration, or is export/import enough?
- **Dock without a URL source.** If many users keep *Local file*, consider obs-websocket as a second transport (dock connects to OBS, which forwards to browser sources). This needs the WebSocket server enabled and possibly a password.
- **Multiple overlays.** If someone has two browser sources (e.g. two scenes), both hear dock commands. Probably fine (they share settings anyway), but status snapshots could flip between them. Add a source id if it causes trouble.
- **Hotkeys in the dock.** OBS docks get keyboard focus; decide whether `C` / `Shift+C` should work there too.
