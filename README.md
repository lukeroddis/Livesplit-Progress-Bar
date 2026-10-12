# LiveSplit Minimal Overlay

A modern, widescreen-optimized HUD and progress bar overlay for speedrunners, designed for standalone web browsers and OBS Studio Browser Sources (1080p, 1440p, 4K).

Traditional LiveSplit layouts take up substantial vertical screen space over modern 16:9 gameplay. This overlay delivers a minimal, bottom-docked or floating horizontal progress track, dynamic dual timers, and full LiveSplit state parity—freeing up screen real estate for the game.

---

## ⚡ Quick Start Guide (60 Seconds)

### 1. Enable LiveSplit Server
1. In LiveSplit, right-click $\rightarrow$ **Edit Layout** $\rightarrow$ add **Control $\rightarrow$ LiveSplit Server**.
2. Right-click $\rightarrow$ **Control $\rightarrow$ Start Server** (defaults to `ws://localhost:16834`).

### 2. Open the Overlay
* **In Desktop Browser**: Open [index.html](file:///c:/Users/Luke/Livesplit-Progress-Bar/index.html) in Chrome, Edge, or Firefox.
* **In OBS Studio**:
  1. Add a **Browser Source** pointing to the local path of `index.html` (or your local web server).
  2. Set Width to `1920` and Height to `1080` (or your native canvas resolution).
  3. Enable **Shutdown source when not visible** and **Refresh browser when scene becomes active**.

### 3. Load Your Splits
* Simply **drag and drop** your LiveSplit `.lss` splits file directly onto the browser window.
* Your splits, PB targets, best segment histories, and metadata are automatically parsed and saved to local browser storage.

---

## 🎮 Key Features & Capabilities

### 1. Minimal Horizontal Split Track
* **Visual Progress Nodes**: Interactive node dots and connecting lines indicate completed, current, and upcoming splits.
* **Auto-Centering Track**: Smoothly scrolls the active split to keep it centered on screen regardless of how many splits your run has.
* **Side-by-Side Typography**: Displays both the locked split delta and the final cumulative time side by side.
* **Accurate 4-State LiveSplit Coloring**:
  - Ahead & Gaining Time: Dark Green
  - Ahead & Losing Time: Light Green
  - Behind & Gaining Time: Light Red
  - Behind & Losing Time: Dark Red
  - Gold Split (Personal Best Segment): Vivid Gold / Yellow
* **Intelligent Live Delta Reveal**: Hides the active delta while on pace for a Gold split; dynamically reveals the ticking delta the moment time is lost.

### 2. Dynamic Dual Timers
* **Primary Timer (54px)**: Auto-detects and prioritizes the active timing method (Game Time vs Real Time), swapping primary display dynamically.
* **Secondary Timer (24px)**: Keeps the alternate time format visible with low visual intrusion.

### 3. Interactive HUD Layout Editor
Edit and customize your layout in real time directly inside the browser or OBS Interact window:
* **Toggle Edit Mode**: Press **`E`** or **`F2`**, or click **`⚙ Edit Layout`** in the bottom utility bar.
* **Freeform Drag & Drop**: Click and drag any component header (`:::`) or container to move it anywhere on screen.
* **Proportional Scaling**: Drag the bottom-right resize grip (**`⤡`**) to scale any element smoothly from `40%` to `250%`. Typography and geometries scale proportionally.
* **Component Toggles**: Hide or show the **Game Title**, **Dual Timers**, or **Progress Track** independently.
* **Bottom Dock Snapping**: Drag the Progress Track near the bottom to snap to a full-width dock, or click **`⚓ Dock / ⛵ Float`**.
* **Lock & Save**: Press **`Esc`** or click **`🔒 Lock Layout`**. Layout settings are remembered across browser sessions and OBS reboots.

### 4. High-Density Split Controls & 40° Angle Tilt
* **Spin Box Split Density**: Control exactly how many splits fit on screen with an integer spin box (`2` to `60` splits), or choose one-click **`All`** (fit all without scrolling) or **`Auto`** (standard 220px spacing).
* **Anti-Collision 40° Angle Tilt**:
  - Automatically rotates split titles at a 40° angle when split density increases.
  - **Opposing-Side Rule**: Deltas and times remain strictly flat (0°) and are forced to the opposite side of the connector bar (e.g. Titles on Top $\implies$ Timers on Bottom), eliminating text overlap.
  - Generous bounding box clearance prevents text clipping or truncation.

### 5. High-Contrast Glassmorphic Background Plates
* Solves washed-out text and illegibility on bright game scenes (skyboxes, bright pavement, snow):
  - Dark semi-transparent plate (`rgba(15, 23, 42, opacity)`) with frosted glass backdrop blur.
  - **Live Opacity Slider**: Adjustable from `0%` (fully transparent) to `95%` (dark contrast).
  - **Presets**: `0% (Off)`, `35% Subtle`, `55% Glass`, `80% Dark`.
  - **Frosted Blur Slider**: Configurable from `0px` to `20px`.
  - **Component Control**: Toggle background plates independently on Game Title, Timers, or Track.

### 6. Multiple Comparison Targets
Seamlessly switch target benchmarks:
* **Personal Best (PB)**
* **Best Segments (Sum of Best)**
* **Average Segments** (calculated dynamically from `<SegmentHistory>`)
* **Worst Segments** (calculated dynamically from `<SegmentHistory>`)
* **Custom Comparisons** (any comparison tracks declared in your `.lss` file)
* *Quick Cycle*: Click the **`Comp: PB`** badge in the bottom utility bar to cycle comparisons on the fly.

---

## 🎛️ Standalone OBS URL Parameters

For multi-monitor or multi-source OBS setups, load specific isolated components using URL parameters:

| URL Parameter | Function | Example |
| :--- | :--- | :--- |
| `?view=track` | Display only the Progress Track | `index.html?view=track` |
| `?view=timers` | Display only the Dual Timers | `index.html?view=timers` |
| `?view=title` | Display only the Game Title & Category | `index.html?view=title` |
| `?splits=all` | Fit all splits on screen without scrolling | `index.html?splits=all` |
| `?splits=12` | Force exactly 12 splits on screen | `index.html?splits=12` |
| `?angle=40` | Force 40° angled split titles | `index.html?angle=40` |
| `?bg=55` | Set background plate opacity to 55% | `index.html?bg=55` |
| `?bgblur=8` | Set frosted glass blur in pixels | `index.html?bgblur=8` |
| `?namepos=top\|bottom` | Set split title position | `index.html?namepos=top` |
| `?deltapos=top\|bottom` | Set delta and time position | `index.html?deltapos=bottom` |
| `?edit=1` | Launch directly into Layout Edit Mode | `index.html?edit=1` |
| `?hide=title,timers` | Hide specific components via query | `index.html?hide=title,timers` |

---

## 🧪 Testing & Code Stability

The repository includes a zero-dependency automated test suite and static analysis engine:

```bash
# Run automated tests and static checks
python tests/run_tests.py
```

* **Visual In-Browser Test Runner**: Open [tests/test_runner.html](file:///c:/Users/Luke/Livesplit-Progress-Bar/tests/test_runner.html) in any browser to inspect assertions visually with live status badges.
* **Pre-Push Git Hook**: Automated checks run before every `git push` via `.githooks/pre-push`.
* **GitHub Actions CI**: Automated test runs on every push and PR via `.github/workflows/ci.yml`.

---

## 🗺️ Roadmap & Upcoming Ideas

- [ ] **Custom Color Palette Overrides**: Custom chroma key presets, neon/retro themes, and custom accent colors.
- [ ] **Custom Resolution Presets**: Instant one-click sizing for ultrawide (21:9), vertical (9:16 for TikTok/Shorts), and 4K setups.
- [ ] **Global Hotkey Integration**: Additional remote hotkey hooks for comparison switching.

---

## 🛠️ For Developers & AI Agents

Technical documentation, LiveSplit Server WebSocket nuances, XML parsing architecture, and coding rules are maintained in:

👉 **[Agent & Developer Architecture Guide (AGENT_GUIDE.md)](file:///c:/Users/Luke/Livesplit-Progress-Bar/AGENT_GUIDE.md)**

---

## 🤖 Attribution & AI Pair Programming

This project is developed with AI pair programming using **Google DeepMind Antigravity**.  
All features, tests, and architectural changes are proposed, implemented with AI assistance, and reviewed and approved by [@lukeroddis](https://github.com/lukeroddis).
