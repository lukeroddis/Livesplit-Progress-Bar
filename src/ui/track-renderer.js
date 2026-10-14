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
   * Computes the visible window range and discontinuity break for sliding track mode.
   * @param {number} idx - Current split index
   * @param {number} N - Total number of splits
   * @param {number} V - Visible splits capacity
   * @param {number} manualOffset - Scroll offset from wheel/arrows
   * @param {boolean} alwaysShowLast - Whether "Always Show Last Split" is enabled
   * @returns {Object} { isWindowed, startNodeVisible, windowStart, windowEnd, hasDiscontinuity }
   */
  function calculateTrackWindow(idx, N, V, manualOffset = 0, alwaysShowLast = true) {
    if (!alwaysShowLast || N + 1 <= V) {
      return {
        isWindowed: false,
        startNodeVisible: true,
        windowStart: 0,
        windowEnd: N - 1,
        hasDiscontinuity: false
      };
    }

    const W = Math.max(2, V - 1);
    const maxK = Math.max(0, N - V + 1);
    
    // Default window position based on runner index
    let defaultK = 0;
    if (idx <= 0) {
      defaultK = 0;
    } else if (idx >= N - 1) {
      defaultK = maxK;
    } else {
      defaultK = Math.max(0, Math.min(maxK, idx - Math.floor(W / 2)));
    }

    const k = Math.max(0, Math.min(maxK, defaultK + manualOffset));

    let startNodeVisible = false;
    let windowStart = 0;
    let windowEnd = 0;
    let hasDiscontinuity = true;

    if (k === 0) {
      startNodeVisible = true;
      windowStart = 0;
      windowEnd = Math.max(0, W - 2);
      hasDiscontinuity = (windowEnd < N - 1);
    } else if (k >= maxK) {
      hasDiscontinuity = false;
      startNodeVisible = false;
      windowStart = Math.max(0, N - V);
      windowEnd = N - 1;
    } else {
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
    calculateTrackWindow,
    calculatePinSizes,
    createLiveElementCache
  };
})();
