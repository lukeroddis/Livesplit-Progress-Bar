# CLAUDE.md

LiveSplit Minimal Overlay: an OBS browser-source HUD (track, timers, ghosts, live race leaderboard) driven by LiveSplit Server's WebSocket. Plain browser JS, no runtime dependencies, released as one self-contained `dist/index.html`.

[DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) is the reference for the module map, LiveSplit protocol, algorithms, storage keys and profile schema. Read the relevant section on demand rather than all of it.

## Commands

```bash
npm test                                   # full suite: pytest + in-browser JS specs (headless Chrome) + ESLint
npm run test:quick                         # skip the browser suite (seconds)
python tests/run_tests.py --spec race/     # only browser specs whose path contains the substring (repeatable)
npm run test:coverage                      # per-file JS coverage table
npm run lint                               # ESLint: no-undef / no-unused-vars
npm run build                              # Vite single-file build + postbuild verify
```

Run `npm test` and `npm run build` before committing; both must be green.

## Hard rules

- **No runtime dependencies, CDNs or remote assets.** The build must stay a single `file://`-runnable HTML file for OBS CEF.
- **Classic scripts only** (no `import`/`export` in app code). Each file is an IIFE exporting to `window.LiveSplit.<Name>`.
- **Cross-module calls use namespaces, never loose `window.*` globals** (enforced by `tests/test_project_rules.py`): layout-side code calls the overlay as `window.LiveSplit.Overlay.fn?.(...)` at call time (API in `src/core/window-api.js`; add new entries there), other modules via `window.LiveSplit.<Module>`, the overlay calls the layout via `window.hudLayout`.
- **`index.html` is the only script/stylesheet list.** The Vite entry and `tests/test_runner.html` are generated from its tags. New module = one `<script>` tag before `layout.js`/`overlay.js`; new stylesheet = one `<link>` placed where its rules should win in the cascade.
- **Never share state through top-level `let` across files**: the build loads every script as its own ES module. Use `app`, `ctx`, `window.LiveSplit.*` or injected getters.
- **Never send `gettimingmethod`** to LiveSplit (hangs legacy servers). Poll only `getcurrentgametime` / `getcurrentrealtime` / `getsplitindex` every 33ms; other queries only on split transitions, start or reset.
- **No DOM allocation or `querySelector` in the render tick**: update `textContent`/`style` on cached elements.
- **Shared constants have one owner** (enforced by `tests/test_project_rules.py`): storage keys `Storage.KEYS` (never raw `"livesplit_*"`), `TrackStyle.DEFAULT_TRACK_STYLE`, `LayoutEngine.COMPONENTS`, `SplitEngine.DEFAULT_COMPARISONS`, `Client.DEFAULT_WS_URL`, `RaceSimulation.SIM_RACE_ID`. They are frozen; copy before mutating.

## Code patterns

- Overlay controllers: `installX(app)` adds functions to `app` and uses `app.state` (fields documented by the `OverlayState` typedef in `src/core/overlay-state.js`; race fields by `RaceState` / `Runner` in `src/core/race-state.js`; keep them updated when adding state); cross-controller calls go through `app.fn(...)` at call time. `overlay.js` is the composition root.
- Race modules: same idea over `ctx` (`ctx.raceState`), composed by `src/core/race-client.js`.
- Self-contained UI pieces: `createX({ getters })` factories.
- A registry contract test fails if anything calls an `app.`/`ctx.` function nobody registers.
- Prefer pure functions (view models, classifiers) split from DOM code so they can be unit tested.
- When adding, renaming or removing a module, update its entry in DEVELOPER_GUIDE.md section 1.

## Tests

- New behaviour tests go in `tests/unit/<core|ui|utils>/<module>.test.js` (cross-module race flows in `tests/unit/race/`). They are discovered automatically and use `describe`/`it`/`assert`/`assertEqual` from `tests/harness/mini-test.js`.
- Drive LiveSplit through `tests/harness/fake-livesplit.js` (`FakeLiveSplit.acceptConnection()`, `.state`, `.sent`), never a real server.
- Don't assert on source text or re-implement JS logic in Python. The Python tests are only for cross-file contracts and project rules.
- Shared spec helpers live in `tests/harness/test-utils.js` (`TestUtils.mountHtml`, `captureWindowListeners`, `withFakeTimers`, `stubOverlay`, `stubWindow`, `waitFor`); real sample `.lss` files in `tests/fixtures/` are available as `window.TestFixtures["<file name>"]`.
- Full runs enforce the JS coverage floors in `pytest.ini` (`js_coverage_floor`, `js_file_coverage_floor`). Raise them after improving coverage, keeping about a point of headroom (coverage varies slightly per run).
- `tests/test_runner.html` is generated; edit `tests/test_runner.template.html`.

## Working in this repo

- **The user's real LiveSplit may be running on `localhost:16834`. Never connect to it.** For a manual browser check, serve a temporary copy of `index.html` with `tests/harness/fake-livesplit.js` injected before the app scripts, then delete the copy.
- Skip reading `dist/`, `node_modules/`, `package-lock.json` and `tests/test_runner.html`. They are generated.
- Text files use LF (`.gitattributes`).
- Other sessions may commit to the same branch: check `git log` before committing.
- Commit messages: short imperative title, a body with what, why and how it was verified, ending with `Co-Authored-By: Claude <model> <noreply@anthropic.com>`.
- **Other tools without a vendor-owned address** (e.g. Antigravity): do not add a trailer; put the attribution in the commit body instead:

  ```text
  🤖 Generated with Antigravity (Google DeepMind)
  Reviewed, tested, and approved by Luke.
  ```
