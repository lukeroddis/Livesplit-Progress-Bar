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

  /**
   * @typedef {"GameTime"|"RealTime"} TimingMethod
   */

  /**
   * A completed split's frozen delta, as shown on the track (keyed by split index).
   * @typedef {Object} LockedDelta
   * @property {{text: string, isAhead: boolean, signedSeconds?: number}} deltaInfo - Display text, colour side and seconds vs the comparison
   * @property {string} stateClass - Split colour class from SplitEvaluation ("ahead-gaining", "gold", "uncoloured", ...)
   * @property {number|null} splitTimeSec - Recorded cumulative split time; null for a skipped split
   */

  /**
   * Leaderboard glow queued for the host's row after a split.
   * @typedef {Object} HostSplitFlash
   * @property {string} type - Flash colour from SplitEvaluation.getSplitFlashType
   * @property {number} timestamp - Date.now() when the split landed
   * @property {string} completedSplitName
   * @property {string} newSplitName - Next split, or "Finished"
   */

  /**
   * The shared overlay state (app.state). Times are seconds; curve arrays are cumulative
   * split times per split index (null where unknown), best segments are durations.
   * @typedef {Object} OverlayState
   * @property {string[]} splitsList - Split names in order
   * @property {Array<number|null>} comparisonTimes - Active comparison curve for the active timing method
   * @property {Array<number|null>} comparisonTimesGT - Personal Best curve, GameTime
   * @property {Array<number|null>} comparisonTimesRT - Personal Best curve, RealTime
   * @property {Array<number|null>} bestSegmentTimes - Gold segment durations for the active timing method
   * @property {Array<number|null>} bestSegmentTimesGT
   * @property {Array<number|null>} bestSegmentTimesRT
   * @property {Array<number|null>} baselineBestSegmentTimesGT - Golds as loaded, before in-run golds (restored on reset)
   * @property {Array<number|null>} baselineBestSegmentTimesRT
   * @property {string[]} comparisonsList - Comparison names offered for cycling (built-ins + custom from the .lss)
   * @property {Object<string, Array<number|null>>} comparisonsDataGT - Curve per comparison name, GameTime
   * @property {Object<string, Array<number|null>>} comparisonsDataRT - Curve per comparison name, RealTime
   * @property {string} currentComparison - Active comparison name
   * @property {TimingMethod} currentTimingMethod
   * @property {"gametime"|"realtime"|"both"} timerDisplayMode
   * @property {boolean} cachedEnableGolds - Gold highlighting enabled (cached from storage)
   * @property {number} currentIndex - Active split index; -1 when no run is in progress
   * @property {Object<number, LockedDelta>} lockedDeltas - Frozen deltas of completed splits
   * @property {Object<number, number>} completedSplitTimes - Recorded split times for the active timing method
   * @property {Object<number, number>} completedSplitTimesRT
   * @property {Object<number, number>} completedSplitTimesGT
   * @property {number} lastSplitRecordedSec - Last recorded cumulative split time (skip detection)
   * @property {number} previousDeltaSeconds - Delta at the last coloured split (live gaining / losing)
   * @property {number} lastElapsedSec - Latest run time from LiveSplit
   * @property {HostSplitFlash|null} pendingHostSplitFlash
   * @property {number} trackManualScrollOffset - User scroll offset of the track window
   * @property {boolean} canQueryComparison - False once getcomparisonname gets no reply (older servers); stops asking
   * @property {number} pollTick - Poll loop counter
   */

  /** @returns {OverlayState} */
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
