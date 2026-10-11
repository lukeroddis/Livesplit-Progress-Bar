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
- **Styles**: [style.css](file:///c:/Users/Luke/Livesplit-Progress-Bar/style.css) (HUD styling & animations)
- **Overlay Engine**: [overlay.js](file:///c:/Users/Luke/Livesplit-Progress-Bar/overlay.js) (WebSocket communication, .lss XML parser, 4-state delta engine)

### Verification Media
- **Live Delta Loss Comparison**: `media_1791747607620_63d3f6f8.png` (LiveSplit UI vs. overlay matching time loss)
- **4-State Delta Colors**: `media_1791743715096_412581f8.png` (Dark green vs. gold segments)
- **Side-by-Side Metrics**: `media_1791742814572_a5876dc3.png` (Delta alongside split time)
- **Gold Split Progress Bar**: `media_1791742705834_7b1a28af.jpg` (Golden progress bar rendering)

---

## 5. Recommended Project Setup & Next Steps

1. **Future Feature Ideas**:
   - Customizable styling modal (node width, color palette picker, OBS transparent background presets).
   - Hotkey support for manual reset or comparison switching (PB vs Average vs Best Segments).
