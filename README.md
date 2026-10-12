# LiveSplit Minimal Overlay — Project Handoff

## 1. Project Overview & Motivation
A lightweight, widescreen-optimized HUD/overlay designed for speedrunners (1080p, 1440p, 4K) running as a standalone webpage or OBS Browser Source. 

Unlike traditional LiveSplit layouts that occupy substantial vertical screen space over modern 16:9 gameplay, this overlay uses:
- **Bottom-Docked Horizontal Track**: Visual progress bar per segment, node dots, side-by-side delta and target/completed split times, and auto-scrolling to keep the active split centered.
- **Top Bar**: Game title, category, and dynamic dual timers (Game Time and Real Time).
- **Accurate LiveSplit State Parity**: Native 4-state delta coloring, Best Segment (Gold split) detection, and live delta appearing dynamically upon time loss.

---

## 2. Current Implementation Progress

| Feature / Module | Status | Notes |
| :--- | :--- | :--- |
| **LiveSplit WebSocket Integration** | Complete | Connects to `ws://localhost:16834/livesplit`. Auto-reconnects on drop. |
| **Fast Polling Engine** | Optimized | 30 FPS tick strictly queries 3 native commands (`igt`, `rta`, `splitindex`). Zero stalls. |
| **Target Time Sync** | Optimized | `getcomparisonsplittime` queried only once per split transition. |
| **`.lss` XML Parsing** | Complete | Extracts names, Personal Best times, and parses `<SegmentHistory>` attempts. |
| **Gold Split Precision** | Complete & Verified | Compares segment duration against $\min(\text{BestSegment}, \text{SegmentHistory})$ with a 50ms buffer ($t_{\text{seg}} < t_{\text{best}} - 0.05\text{s}$). |
| **Active Split Live Delta** | Complete & Verified | Hidden while on pace for Gold ($t_{\text{elapsed}} \le t_{\text{best}}$); displays dynamically once losing time ($t_{\text{elapsed}} > t_{\text{best}}$). |
| **Side-by-Side Typography** | Complete | Completed splits display both the locked delta and the final cumulative time side by side. |
| **4-State LiveSplit Coloring** | Complete | Ahead Gaining (dark green), Ahead Losing (light green), Behind Gaining (light red), Behind Losing (dark red), and Gold (yellow). |
| **Multi-Game Generalization** | Complete | Auto-queries game/category from LiveSplit; auto-detects console vs PC runs (`RealTime` vs `GameTime`). |
| **Dynamic Timers** | Complete | Primary 54px green timer swaps dynamically between Game Time and Real Time depending on the active method. |
| **Cache & Offline Storage** | Complete | LocalStorage persists `.lss` XML, splits, user toggle preferences, and records new PBs. |

---

## 3. Key Technical Decisions & Protocol Nuances

### LiveSplit Server WebSocket Protocol (`ws://localhost:16834/livesplit`)
- **Blacklisted Commands**: 
  - `gettimingmethod`: **DO NOT USE**. LiveSplit Server does not implement this command and will never reply, inducing 80ms timeouts and queue desynchronization.
- **Continuous Polling Commands (Every 33ms)**:
  - `getcurrentgametime`
  - `getcurrentrealtime`
  - `getsplitindex`
- **Event-Driven Transition Commands (Queried only on split change / start / reset)**:
  - `getlastsplittime`: Fetches exact recorded cumulative split time.
  - `getdelta`: Fetches official LiveSplit delta string (e.g., `-0.4`, `+1:23.2`).
  - `getcomparisonsplittime`: Fetches active comparison target for the upcoming split.
  - `getgamename` & `getcategoryname`: Queries active split metadata when connected.

### Gold Split Calculation & `<SegmentHistory>`
- In LiveSplit `.lss` files, `<BestSegmentTime>` can lag behind actual runs or become stale. The parser scans all valid `GameTime` and `RealTime` nodes within `<SegmentHistory><Time>` across all past attempts:
  $$\text{BestSegment}_{\text{effective}} = \min\left(\text{BestSegmentTime}, \min(\text{SegmentHistory})\right)$$
- To prevent false golds from sub-frame precision differences or timer start jitter, the overlay enforces:
  $$\text{isGold} \iff \text{segmentDuration} < (\text{bestSec} - 0.05)$$

### Live Delta Display Trigger
- While runner is on pace for a Gold split ($t_{\text{seg}} \le t_{\text{best}}$), the delta span `#delta-val-${currentIndex}` remains blank.
- As soon as $t_{\text{seg}} > t_{\text{best}}$, the delta appears and ticks synchronously in memory ($t_{\text{current}} - t_{\text{target}}$) without additional WebSocket round trips.

---

## 4. File Structure & Reference Assets

### Core Files
- **Modular Entry Point**: [index.html](file:///c:/Users/Luke/Livesplit-Progress-Bar/index.html) (Modular HTML structure)
- **Styles**: [style.css](file:///c:/Users/Luke/Livesplit-Progress-Bar/style.css) (HUD styling & animations, responsive canvas, layout editor UI)
- **Layout Engine**: [layout.js](file:///c:/Users/Luke/Livesplit-Progress-Bar/layout.js) (Interactive drag & drop, proportional scaling, visibility toggles, localStorage persistence, and URL views)
- **Overlay Engine**: [overlay.js](file:///c:/Users/Luke/Livesplit-Progress-Bar/overlay.js) (WebSocket communication, .lss XML parser, 4-state delta engine)
- **Standalone Build**: [gemini-code-1791738130877.html](file:///c:/Users/Luke/Livesplit-Progress-Bar/gemini-code-1791738130877.html) (Single-file standalone fallback)
- **Latest Backup**: [gemini-code-1791738130877.html.bak3](file:///c:/Users/Luke/Livesplit-Progress-Bar/gemini-code-1791738130877.html.bak3)
- **Reference Splits File**: `d:\Streaming\Speedrunning\Splits\Final Fantasy X - PC - CSS%.lss`

### Verification Media
- **Live Delta Loss Comparison**: `media_1791747607620_63d3f6f8.png` (LiveSplit UI vs. overlay matching time loss)
- **4-State Delta Colors**: `media_1791743715096_412581f8.png` (Dark green vs. gold segments)
- **Side-by-Side Metrics**: `media_1791742814572_a5876dc3.png` (Delta alongside split time)
- **Gold Split Progress Bar**: `media_1791742705834_7b1a28af.jpg` (Golden progress bar rendering)

---

## 5. Interactive HUD Layout Editor & Controls

The overlay supports in-browser visual editing via pointer drag-and-drop and scaling:

### How to Edit in OBS or Browser
1. **In OBS**: Right-click your Browser Source $\rightarrow$ **Interact**.
2. **In Browser**: Open [index.html](file:///c:/Users/Luke/Livesplit-Progress-Bar/index.html).
3. **Toggle Edit Mode**:
   - Press hotkey **`E`** or **`F2`**, or click **`⚙ Edit Layout`** in the bottom utility bar.
   - Bounding outlines, move headers, and the floating editor toolbar will appear.

### Layout Controls
* **Move**: Click and drag any component header (`:::`) or body to position it anywhere on screen.
* **Proportional Resize**: Click and drag the bottom-right resize grip (**`⤡`**) to scale smoothly (40% to 250%). All typography and split geometries scale with 100% geometric parity.
* **Toggle Visibility**: Click the **`👁`** icon on any component header, or use the checkboxes (**`Title`**, **`Timers`**, **`Track`**) in the top toolbar.
* **Bottom Dock Snapping**: Drag the Progress Track near the bottom to snap to a full-width bottom dock, or click the **`⚓ Dock / ⛵ Float`** button.
* **Visible Splits Control**:
  - Adjust how many splits fit on the screen (**`Auto`**, **`5`**, **`8`**, **`10`**, **`12`**, **`16`**, **`20`**, or **`Fit All`**).
  - Configurable via dropdown in the Layout Editor or click the **`Splits: Auto`** badge in the bottom utility bar to cycle on the fly.
* **Intelligent Overlap Tracking & 40° Angle Tilt**:
  - In high-density split layouts (or long split titles), names can collide horizontally.
  - The overlay actively measures node spacing and text widths; if overlap is detected (or spacing $< 175\text{px}$), it automatically rotates labels and deltas to a **40° angle** (`rotate(-40deg)`).
  - Can be set to **`Auto (Smart)`**, forced **`40° Tilt`**, or forced **`Flat`** via toolbar dropdown or the **`Angle: Auto`** footer badge.
* **Lock & Save**: Press **`Esc`**, **`E`**, or click **`🔒 Lock Layout`**. Coordinates, scales, splits count, and angle preferences are saved to `localStorage` and remembered across OBS launches.
* **Reset**: Click **`↺ Reset`** in the editor toolbar to restore defaults for the current screen resolution.

### Standalone URL Parameter Views
For multi-source OBS setups or targeted browser sources:
* `index.html` — Full overlay with custom saved layout.
* `index.html?view=title` — Shows only the Game Title and Category.
* `index.html?view=timers` — Shows only the Dual Timers (IGT & RTA).
* `index.html?view=track` — Shows only the Horizontal Split Track.
* `index.html?splits=all` — Forces all splits to fit on screen without scrolling (or `?splits=10`, `?splits=12`).
* `index.html?angle=40` — Forces 40° angled text mode (or `?angle=flat`).
* `index.html?edit=1` — Automatically launches into Edit Mode on load.
* `index.html?hide=title,timers` — Hides specific components directly via URL query.

---

## 6. Future Feature Ideas & Roadmap

1. **Custom Styling Modal**:
   - In-overlay configuration panel for node spacing, font sizing, color palette overrides, and OBS chroma/transparency presets.
2. **Hotkey & Comparison Switching**:
   - Hotkey controls for manual reset or live comparison toggling (PB vs. Average vs. Best Segments).
