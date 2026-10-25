/**
 * src/core/overlay-state.js - Shared Overlay Run & Comparison State
 *
 * One mutable object holding everything the overlay controllers read and write
 * during a session: loaded splits, comparison curves per timing method, active
 * comparison / timing method, and live run progress. Controllers receive this
 * object instead of sharing top-level variables, so they can live in separate
 * files (each script is its own module scope in the Vite build).
 */

(function () {
  "use strict";

  const STORAGE_KEYS = window.LiveSplit.Storage.KEYS;

  function createOverlayState() {
    return {
      // Loaded splits and comparison curves (cumulative seconds; best segments are durations)
      splitsList: [],
      comparisonTimes: [],
      comparisonTimesGT: [],
      comparisonTimesRT: [],
      bestSegmentTimes: [],
      bestSegmentTimesGT: [],
      bestSegmentTimesRT: [],
      baselineBestSegmentTimesGT: [],
      baselineBestSegmentTimesRT: [],
      comparisonsList: [...window.LiveSplit.SplitEngine.DEFAULT_COMPARISONS],
      comparisonsDataGT: {},
      comparisonsDataRT: {},
      currentComparison: "Personal Best",

      // Timing method & display preferences
      currentTimingMethod: "GameTime",
      timerDisplayMode: "both", // 'gametime' | 'realtime' | 'both'
      cachedEnableGolds: (localStorage.getItem(STORAGE_KEYS.ENABLE_GOLDS) !== "false"),

      // Live run progress
      currentIndex: -1,
      lockedDeltas: {},
      completedSplitTimes: {},
      completedSplitTimesRT: {},
      completedSplitTimesGT: {},
      lastSplitRecordedSec: 0,
      previousDeltaSeconds: 0,
      lastElapsedSec: 0,
      pendingHostSplitFlash: null,

      // UI / protocol flags
      trackManualScrollOffset: 0,
      canQueryComparison: true,
      pollTick: 0
    };
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.OverlayState = {
    createOverlayState
  };
})();
