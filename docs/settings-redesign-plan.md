# Settings redesign plan: OBS dock + per-widget settings

Status: proposal (2026-10-28). Step 1 (race-code dock) shipped in `22b83ee`.

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
| Golds on/off (`gold-toggle-badge`) | ✅ | Track | |
| Visible splits count / Fit all / Auto | ✅ | Track | Spinbox in dock |
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
- Must stay one self-contained HTML file. The build should **generate** it from a template plus the registry, not hand-copy constants. That also fixes today's duplicated storage key names in `dock.html`.
- Fits a narrow dock (about 250–350px wide); dark by default to match OBS.

### 4. Per-widget cogs in Layout Mode

- In Layout Mode each widget (title, timers, track, leaderboard) shows a cog and a close (hide) button.
- The cog opens a small popover anchored to that widget, listing only that widget's registry entries.
- Keep the Customizer's **Save / Reset** draft model for appearance settings (live preview, then save or revert). Live controls apply instantly as they do now. The registry marks each setting as `instant` or `draft`.
- Once every Customizer section has a home, remove the big modal.

## Steps

Each step ships on its own, with `npm test` and `npm run build` green.

1. ✅ **Race-code dock** (done).
2. **Settings registry.** Add `settings-registry.js` with the live controls from the table above. Route the existing badge and button handlers through `set`. No visible change; specs for the registry.
3. **General dock bridge.** `set` commands and state snapshots, replacing the race-only bridge. Keep `connect` / `disconnect` working so old dock files still work.
4. **Dock UI.** Generated sections for the live controls; build generates `dock.html`. Test in real OBS (Luke).
5. **Widget cogs.** Layout Mode cog + close on each widget, popover from the registry, starting with the Track widget, the largest part of the Customizer.
6. **Move the rest of the Customizer** onto the cogs (timers, title/logo, leaderboard, backgrounds). Remove the modal.
7. **Slim the settings menu** down to the global items. Update README screenshots and the developer guide.

## Open questions

- **Old saved data after switching to a `file:///` URL.** Users who move off *Local file* lose access to their saved data (different origin). Could the overlay offer a one-click "copy settings to clipboard / paste" migration, or is export/import enough?
- **Dock without a URL source.** If many users keep *Local file*, consider obs-websocket as a second transport (dock connects to OBS, which forwards to browser sources). This needs the WebSocket server enabled and possibly a password.
- **Multiple overlays.** If someone has two browser sources (e.g. two scenes), both hear dock commands. Probably fine (they share settings anyway), but status snapshots could flip between them. Add a source id if it causes trouble.
- **Hotkeys in the dock.** OBS docks get keyboard focus; decide whether `C` / `Shift+C` should work there too.
