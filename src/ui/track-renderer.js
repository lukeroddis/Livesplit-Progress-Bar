/**
 * src/ui/track-renderer.js - Track Geometry, Viewport Windowing & DOM Renderer
 * 
 * Manages the split progress track visualization:
 * - Start node & split item DOM rendering
 * - Pinned final split with schematic engineering discontinuity break
 * - High-performance element caching for zero-allocation 60 FPS animation
 * - Dynamic pin sizing proximity calculations
 */

(function () {
  "use strict";

  const STORAGE_KEYS = window.LiveSplit.Storage.KEYS;

  const ALL_DELTA_CLASSES = [
    "delta-ahead-gaining", "delta-ahead-losing", 
    "delta-behind-gaining", "delta-behind-losing", 
    "delta-gold", "delta-uncoloured"
  ];

  const ALL_SPLIT_STATE_CLASSES = [
    "completed", "current", "target-time", 
    "ahead-gaining", "ahead-losing", 
    "behind-gaining", "behind-losing", 
    "gold", "uncoloured", "overdue",
    ...ALL_DELTA_CLASSES
  ];

  /**
   * Default sliding-window position k for the runner's split, centring the active split
   * in the W sliding slots and snapping to the start / finale views at either end.
   */
  function getDefaultTrackWindowPosition(idx, N, V, W) {
    const half = Math.floor((W - 1) / 2);
    const idealStart = idx - half;
    const maxK = Math.max(0, N - V + 1);

    if (idealStart + (W - 1) >= N - 1) {
      return maxK;
    }
    if (idealStart <= -1) {
      return 0;
    }
    return Math.max(0, Math.min(maxK, idealStart + 1));
  }

  /**
   * Clamped window position k (default position plus manual wheel/arrow offset).
   * @returns {{ k: number, defaultK: number, maxK: number }}
   */
  function getTrackWindowPosition(idx, N, V, manualOffset = 0) {
    const W = Math.max(2, V - 1);
    const maxK = Math.max(0, N - V + 1);
    const defaultK = getDefaultTrackWindowPosition(idx, N, V, W);
    const k = Math.max(0, Math.min(maxK, defaultK + manualOffset));
    return { k, defaultK, maxK };
  }

  /**
   * Computes the visible window range and discontinuity break for sliding track mode.
   * When N + 1 > V the final split is pinned in the last slot and W = V - 1 slots slide.
   * @param {number} idx - Current split index
   * @param {number} N - Total number of splits
   * @param {number} V - Visible splits capacity
   * @param {number} manualOffset - Scroll offset from wheel/arrows
   * @param {boolean} alwaysShowLast - Whether windowing is enabled ("Always Show Last Split" and not "Fit All")
   * @returns {Object} { isWindowed, startNodeVisible, windowStart, windowEnd, hasDiscontinuity }
   */
  function calculateTrackWindow(idx, N, V, manualOffset = 0, alwaysShowLast = true) {
    if (N <= 1 || !alwaysShowLast || N + 1 <= V) {
      return {
        isWindowed: false,
        startNodeVisible: true,
        windowStart: 0,
        windowEnd: N - 1,
        hasDiscontinuity: false
      };
    }

    const W = Math.max(2, V - 1);
    const { k, maxK } = getTrackWindowPosition(idx, N, V, manualOffset);

    let startNodeVisible = false;
    let windowStart = 0;
    let windowEnd = 0;
    let hasDiscontinuity = true;

    if (k === 0) {
      // Earliest view: Start node is visible in slot 0, W - 1 splits fill slots 1..(W - 1)
      startNodeVisible = true;
      windowStart = 0;
      windowEnd = Math.max(0, W - 2);
      hasDiscontinuity = (windowEnd < N - 1);
    } else if (k >= maxK) {
      // Finale view: display the last V splits continuously with no discontinuity break
      hasDiscontinuity = false;
      startNodeVisible = false;
      windowStart = Math.max(0, N - V);
      windowEnd = N - 1;
    } else {
      // Mid-run: Start node is omitted
      startNodeVisible = false;
      windowStart = k - 1;
      windowEnd = windowStart + (W - 1);
      hasDiscontinuity = (windowEnd < N - 1);
    }

    return {
      isWindowed: true,
      startNodeVisible,
      windowStart,
      windowEnd,
      hasDiscontinuity
    };
  }

  /**
   * Applies a calculateTrackWindow() result to #node-start and the split items.
   */
  function applyTrackWindow(N, win) {
    const nodeStart = document.getElementById("node-start");
    if (!win.isWindowed) {
      if (nodeStart) nodeStart.classList.remove("is-omitted", "first-visible-node");
      for (let i = 0; i < Math.max(N, 1); i++) {
        const el = document.getElementById(`item-${i}`);
        if (el) el.classList.remove("is-omitted", "has-discontinuity", "first-visible-node");
      }
      return;
    }

    if (nodeStart) nodeStart.classList.toggle("is-omitted", !win.startNodeVisible);

    for (let i = 0; i < N; i++) {
      const el = document.getElementById(`item-${i}`);
      if (!el) continue;

      if (i >= win.windowStart && i <= win.windowEnd) {
        el.classList.remove("is-omitted", "has-discontinuity");
        el.classList.toggle("first-visible-node", !win.startNodeVisible && i === win.windowStart);
      } else if (i === N - 1) {
        el.classList.remove("is-omitted", "first-visible-node");
        el.classList.toggle("has-discontinuity", win.hasDiscontinuity);
      } else {
        el.classList.add("is-omitted");
        el.classList.remove("has-discontinuity", "first-visible-node");
      }
    }
  }

  /**
   * How many nodes fit on the track: the numeric visible-splits preference, else
   * derived from the viewport (64px rows vertical, 125px columns horizontal).
   */
  function getVisibleSplitsCapacity() {
    const splitPref = localStorage.getItem(STORAGE_KEYS.VISIBLE_SPLITS) || "auto";
    if (splitPref !== "auto" && splitPref !== "all") {
      const num = parseInt(splitPref, 10);
      if (!isNaN(num) && num > 0) return num;
    }
    const viewport = document.getElementById("track-viewport");
    const track = document.getElementById("track");
    const trackComp = document.getElementById("hud-comp-track");
    const isVertical = track?.classList.contains("vertical");
    const isDockedVertical = isVertical && (trackComp?.classList.contains("docked-left") || trackComp?.classList.contains("docked-right"));
    const isDockedHorizontal = !isVertical && trackComp?.classList.contains("docked-bottom");

    const viewportW = (isDockedHorizontal && (!viewport || viewport.clientWidth < 500))
      ? (window.innerWidth || 1920)
      : (viewport?.clientWidth || window.innerWidth || 1920);

    const viewportH = (isDockedVertical && (!viewport || viewport.clientHeight < 300))
      ? (window.innerHeight || 1080)
      : (viewport?.clientHeight || window.innerHeight || 800);

    const pLeft = 24;
    const pRight = 24;
    const availW = Math.max(300, viewportW - (pLeft + pRight));
    return isVertical
      ? Math.max(4, Math.floor((viewportH - 40) / 64))
      : Math.max(4, Math.floor(availW / 125));
  }

  /**
   * Rebuilds the Start node, every split item, and the static ghost template marker in #track.
   * @param {HTMLElement} track
   * @param {string[]} splitsList
   * @param {string[]} targetLabels - Formatted target time per split ("" when unknown)
   * @param {boolean} isRunActive - Marks the Start node active
   */
  function buildTrackDom(track, splitsList, targetLabels, isRunActive) {
    track.innerHTML = "";

    // 1. Initial Start Node
    const startItem = document.createElement("div");
    startItem.className = "split-item origin-node completed";
    if (isRunActive) {
      startItem.classList.add("active");
    }
    startItem.id = "node-start";

    const startDelta = document.createElement("div");
    startDelta.className = "split-delta";
    startDelta.innerHTML = `<span class="split-time-val target-time">0:00</span>`;

    const startName = document.createElement("div");
    startName.className = "split-name";
    startName.innerText = "Start";

    const startDot = document.createElement("div");
    startDot.className = "dot";

    startItem.appendChild(startDelta);
    startItem.appendChild(startName);
    startItem.appendChild(startDot);
    track.appendChild(startItem);

    // 2. All Splits
    splitsList.forEach((name, i) => {
      const item = document.createElement("div");
      item.className = "split-item";
      item.id = `item-${i}`;

      const segBg = document.createElement("div");
      segBg.className = "segment-bar-bg";

      const segFill = document.createElement("div");
      segFill.className = "segment-bar-fill";
      segFill.id = `fill-${i}`;
      segBg.appendChild(segFill);

      const discEl = document.createElement("div");
      discEl.className = "discontinuity-break";
      discEl.title = "Hidden intermediate splits";
      discEl.innerHTML = `<span class="disc-slash"></span><span class="disc-slash"></span>`;
      segBg.appendChild(discEl);

      const deltaEl = document.createElement("div");
      deltaEl.className = "split-delta";
      deltaEl.id = `delta-${i}`;
      deltaEl.innerHTML = `<span class="split-delta-val" id="delta-val-${i}"></span><span class="split-time-val target-time" id="time-val-${i}">${targetLabels[i] || "-"}</span>`;

      const nameEl = document.createElement("div");
      nameEl.className = "split-name";
      nameEl.innerText = name;

      const dot = document.createElement("div");
      dot.className = "dot";

      item.appendChild(segBg);
      item.appendChild(deltaEl);
      item.appendChild(nameEl);
      item.appendChild(dot);
      track.appendChild(item);
    });

    // Inject or preserve live ghost marker inside #track
    let ghostMarker = document.getElementById("ghost-marker");
    if (!ghostMarker) {
      ghostMarker = document.createElement("div");
      ghostMarker.className = "ghost-marker";
      ghostMarker.id = "ghost-marker";
    }
    ghostMarker.style.display = "none";
    ghostMarker.innerHTML = `
      <div class="ghost-icon-wrap"><span id="ghost-icon">🏆</span></div>
      <div class="ghost-needle"></div>
    `;
    track.appendChild(ghostMarker);
  }

  /**
   * Resets a segment fill to empty (full cross-axis, zero along the track) and clears overdue.
   */
  function resetSegmentFill(fill, isVertical) {
    fill.style.width = isVertical ? "100%" : "0%";
    fill.style.height = isVertical ? "0%" : "100%";
    fill.className = "segment-bar-fill";
    if (fill.parentElement) fill.parentElement.classList.remove("overdue");
  }

  /**
   * Smooth-scrolls the viewport: to the origin when windowed or before the run, else centres the active split.
   */
  function scrollTrackToIndex(idx, isWindowed, isVertical) {
    const viewport = document.getElementById("track-viewport");
    const canScroll = viewport && typeof viewport.scrollTo === "function";
    if (!canScroll) return;
    if (isWindowed) {
      viewport.scrollTo({ left: 0, top: 0, behavior: "smooth" });
    } else if (idx < 0) {
      if (isVertical) {
        viewport.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        viewport.scrollTo({ left: 0, behavior: "smooth" });
      }
    } else {
      const activeItem = document.getElementById(`item-${idx}`);
      if (!activeItem) return;
      if (isVertical) {
        const scrollTarget = activeItem.offsetTop + (activeItem.offsetHeight / 2) - (viewport.clientHeight / 2);
        viewport.scrollTo({ top: Math.max(0, scrollTarget), behavior: "smooth" });
      } else {
        const scrollTarget = activeItem.offsetLeft + (activeItem.offsetWidth / 2) - (viewport.clientWidth / 2);
        viewport.scrollTo({ left: Math.max(0, scrollTarget), behavior: "smooth" });
      }
    }
  }

  /**
   * Calculates proximity-based dynamic pin sizes for ghost runners near split nodes.
   */
  function calculatePinSizes(ghostPos, nodePositions, basePinLen = 16) {
    if (basePinLen <= 0) return 0;
    if (!nodePositions || nodePositions.length === 0) return basePinLen;

    let minDistance = Infinity;
    for (const nodePos of nodePositions) {
      const dist = Math.abs(ghostPos - nodePos);
      if (dist < minDistance) minDistance = dist;
    }

    // Shrink pin height smoothly as ghost nears split nodes to prevent text collision
    if (minDistance < 25) {
      const ratio = minDistance / 25;
      return Math.max(4, Math.round(basePinLen * ratio));
    }
    return basePinLen;
  }

  /**
   * Element cache factory to eliminate DOM lookups during 60 FPS animation ticks.
   */
  function createLiveElementCache() {
    let cachedIndex = -1;
    let cachedFillEl = null;
    let cachedDeltaSpanEl = null;
    let cachedTrackEl = null;
    let cachedIsVertical = false;

    function getElements(index) {
      if (index !== cachedIndex || !cachedFillEl) {
        cachedIndex = index;
        cachedFillEl = document.getElementById(`fill-${index}`);
        cachedDeltaSpanEl = document.getElementById(`delta-val-${index}`);
        cachedTrackEl = document.getElementById("track");
        cachedIsVertical = cachedTrackEl ? cachedTrackEl.classList.contains("vertical") : false;
      }
      return {
        fill: cachedFillEl,
        deltaSpan: cachedDeltaSpanEl,
        isVertical: cachedIsVertical
      };
    }

    function invalidate() {
      cachedIndex = -1;
      cachedFillEl = null;
      cachedDeltaSpanEl = null;
      cachedTrackEl = null;
      cachedIsVertical = false;
    }

    return {
      getElements,
      invalidate
    };
  }

  // Export to namespace
  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.TrackRenderer = {
    ALL_DELTA_CLASSES,
    ALL_SPLIT_STATE_CLASSES,
    getDefaultTrackWindowPosition,
    getTrackWindowPosition,
    calculateTrackWindow,
    applyTrackWindow,
    getVisibleSplitsCapacity,
    buildTrackDom,
    resetSegmentFill,
    scrollTrackToIndex,
    calculatePinSizes,
    createLiveElementCache
  };
})();
