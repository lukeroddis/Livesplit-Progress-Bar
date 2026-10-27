/**
 * src/core/split-evaluation.js - Completed Split Classification
 *
 * Pure decision logic applied when a split completes:
 * - Gold (best segment) detection with a 50ms jitter buffer
 * - Delta display + state class (ahead/behind, gaining/losing, gold, uncoloured)
 *   preferring LiveSplit's own delta, falling back to split - target
 * - Leaderboard flash colour for the host's split
 */

(function () {
  "use strict";

  const GOLD_BUFFER_SEC = 0.05;
  const EVEN_EPSILON_SEC = 0.001;
  const DASH_DELTA = Object.freeze({ text: "-", isAhead: false, signedSeconds: 0 });

  function gainLossClass(isAhead, deltaChange) {
    const gainedTime = deltaChange <= EVEN_EPSILON_SEC; // Gained time or stayed even vs comparison segment
    if (isAhead) return gainedTime ? "ahead-gaining" : "ahead-losing";
    return gainedTime ? "behind-gaining" : "behind-losing";
  }

  /**
   * @param {Object} p
   * @param {number} p.splitTimeSec - Cumulative split time just recorded
   * @param {number} p.prevSplitSec - Cumulative time of the last completed split before it (0 at start)
   * @param {number|null} p.targetSec - Comparison cumulative target for this split
   * @param {number|null} p.bestSec - Best segment duration for this split
   * @param {Object|null} p.finalDeltaInfo - Parsed LiveSplit delta ({ text, isAhead, signedSeconds })
   * @param {number} p.previousDeltaSeconds - Signed delta at the previous split
   * @param {boolean} p.goldsEnabled
   * @param {Function} p.formatDeltaSeconds
   * @returns {{ isGold: boolean, segmentDurationSec: number|null, stateClass: string, displayDelta: Object, previousDeltaSeconds: number }}
   */
  function evaluateCompletedSplit(p) {
    const {
      splitTimeSec,
      prevSplitSec,
      targetSec,
      bestSec,
      finalDeltaInfo,
      goldsEnabled,
      formatDeltaSeconds
    } = p;
    let previousDeltaSeconds = p.previousDeltaSeconds;

    const segmentDurationSec = (splitTimeSec >= prevSplitSec) ? (splitTimeSec - prevSplitSec) : null;

    // Only ever mark gold if Golds are enabled, we have a valid positive best segment, and we strictly beat it
    const isGold = !!(goldsEnabled && bestSec !== null && segmentDurationSec !== null && segmentDurationSec > 0 &&
      segmentDurationSec < (bestSec - GOLD_BUFFER_SEC));

    const targetDelta = () => {
      const diff = splitTimeSec - targetSec;
      return { text: formatDeltaSeconds(diff), isAhead: diff <= 0, signedSeconds: diff };
    };

    let stateClass = "uncoloured";
    let displayDelta = { ...DASH_DELTA };

    if (isGold) {
      stateClass = "gold";
      if (finalDeltaInfo) {
        displayDelta = finalDeltaInfo;
        previousDeltaSeconds = finalDeltaInfo.signedSeconds;
      } else if (targetSec) {
        displayDelta = targetDelta();
        previousDeltaSeconds = displayDelta.signedSeconds;
      }
    } else if (finalDeltaInfo) {
      displayDelta = finalDeltaInfo;
      stateClass = gainLossClass(finalDeltaInfo.isAhead, finalDeltaInfo.signedSeconds - previousDeltaSeconds);
      previousDeltaSeconds = finalDeltaInfo.signedSeconds;
    } else if (targetSec) {
      displayDelta = targetDelta();
      stateClass = gainLossClass(displayDelta.signedSeconds <= 0, displayDelta.signedSeconds - previousDeltaSeconds);
      previousDeltaSeconds = displayDelta.signedSeconds;
    }
    // else: incomplete data (fresh splits with nothing to compare against) stays uncoloured with a dash

    return { isGold, segmentDurationSec, stateClass, displayDelta, previousDeltaSeconds };
  }

  /**
   * Leaderboard flash glow colour for the host's completed split.
   * @returns {"gold"|"red"|"green"}
   */
  function getSplitFlashType(stateClass) {
    if (stateClass === "gold") return "gold";
    if (stateClass.includes("losing")) return "red";
    return "green";
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.SplitEvaluation = {
    GOLD_BUFFER_SEC,
    DASH_DELTA,
    evaluateCompletedSplit,
    getSplitFlashType
  };
})();
