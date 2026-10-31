/**
 * src/core/comparison-controller.js - Active Comparison & Timing Method Controller
 *
 * - Default comparison curves when no splits are loaded
 * - Switching the active comparison (badge, targets, track, LiveSplit setcomparison sync, toast)
 * - Switching the active timing method's curves (GameTime / RealTime)
 * - Detecting the timing method from LiveSplit's comparison split time
 * - Ghost comparison lookup for the current timing method
 *
 * Installed onto the shared overlay `app` registry: reads/writes `app.state`
 * and calls other controllers through `app.<fn>` at call time.
 */

(function () {
  "use strict";

  const STORAGE_KEYS = window.LiveSplit.Storage.KEYS;

  function installComparisonController(app) {
    const { state } = app;

    function normalizeComparisonName(raw) {
      return window.LiveSplit.SplitEngine.normalizeComparisonName(raw, state.comparisonsList);
    }

    function initDefaultComparisons() {
      state.comparisonsList = [...window.LiveSplit.SplitEngine.DEFAULT_COMPARISONS];
      state.comparisonsDataGT["Personal Best"] = [...app.DEFAULT_TARGETS];
      state.comparisonsDataRT["Personal Best"] = [...app.DEFAULT_TARGETS];

      let sumBest = 0;
      state.comparisonsDataGT["Best Segments"] = app.DEFAULT_BESTS.map(b => (sumBest += b));
      state.comparisonsDataRT["Best Segments"] = [...state.comparisonsDataGT["Best Segments"]];

      state.comparisonsDataGT["Average Segments"] = app.DEFAULT_TARGETS.map(t => Math.round(t * 1.08));
      state.comparisonsDataRT["Average Segments"] = [...state.comparisonsDataGT["Average Segments"]];

      state.comparisonsDataGT["Worst Segments"] = app.DEFAULT_TARGETS.map(t => Math.round(t * 1.25));
      state.comparisonsDataRT["Worst Segments"] = [...state.comparisonsDataGT["Worst Segments"]];
    }

    function applyActiveTimingMethod(method) {
      if (method && (method === "GameTime" || method === "RealTime")) {
        state.currentTimingMethod = method;
      }
      app.updateTimerDisplayHierarchy();

      const isRT = state.currentTimingMethod === "RealTime";
      const activeTargets = isRT 
        ? (state.comparisonsDataRT[state.currentComparison] || state.comparisonTimesRT)
        : (state.comparisonsDataGT[state.currentComparison] || state.comparisonTimesGT);
      const fallbackTargets = isRT
        ? (state.comparisonsDataGT[state.currentComparison] || state.comparisonTimesGT)
        : (state.comparisonsDataRT[state.currentComparison] || state.comparisonTimesRT);

      state.comparisonTimes = state.splitsList.map((_, i) => {
        return activeTargets[i] ?? fallbackTargets[i] ?? null;
      });

      state.bestSegmentTimes = state.splitsList.map((_, i) => {
        return isRT
          ? (state.bestSegmentTimesRT[i] ?? state.bestSegmentTimesGT[i] ?? null)
          : (state.bestSegmentTimesGT[i] ?? state.bestSegmentTimesRT[i] ?? null);
      });

      for (let i = 0; i < state.splitsList.length; i++) {
        if (!state.lockedDeltas[i]) {
          const timeSpan = document.getElementById(`time-val-${i}`);
          if (timeSpan) {
            const targetVal = app.formatTargetTime(state.comparisonTimes[i]);
            timeSpan.innerText = targetVal || "-";
          }
        }
      }

      const rc = app.getRaceClient();
      if (rc && typeof rc.setTimingMethod === "function") {
        rc.setTimingMethod(state.currentTimingMethod);
      }
    }

    function applyActiveComparison(compName, updateLiveSplit = false, showToast = true) {
      const norm = normalizeComparisonName(compName) || "Personal Best";
      state.currentComparison = norm;
      localStorage.setItem(STORAGE_KEYS.CURRENT_COMPARISON, state.currentComparison);

      const isRT = state.currentTimingMethod === "RealTime";
      const activeTargets = isRT 
        ? (state.comparisonsDataRT[state.currentComparison] || state.comparisonTimesRT)
        : (state.comparisonsDataGT[state.currentComparison] || state.comparisonTimesGT);
      const fallbackTargets = isRT
        ? (state.comparisonsDataGT[state.currentComparison] || state.comparisonTimesGT)
        : (state.comparisonsDataRT[state.currentComparison] || state.comparisonTimesRT);

      state.comparisonTimes = state.splitsList.map((_, i) => {
        return activeTargets[i] ?? fallbackTargets[i] ?? null;
      });

      const selComp = document.getElementById("select-active-comparison");
      if (selComp && selComp.value !== state.currentComparison) {
        selComp.value = state.currentComparison;
      }

      let prevDiff = 0;
      for (let i = 0; i < state.splitsList.length; i++) {
        const splitTimeSec = state.completedSplitTimes[i] ?? state.lockedDeltas[i]?.splitTimeSec;
        if (splitTimeSec !== null && splitTimeSec !== undefined && !isNaN(splitTimeSec) && splitTimeSec > 0) {
          // Completed split: recalculate delta and segment status against newly active comparison
          const targetSec = (i < state.comparisonTimes.length && state.comparisonTimes[i] !== null && state.comparisonTimes[i] > 0)
            ? state.comparisonTimes[i]
            : null;

          if (targetSec !== null) {
            const diff = splitTimeSec - targetSec;
            const deltaChange = diff - prevDiff;
            const gainedTime = deltaChange <= 0.001;
            const isAhead = diff <= 0;
            const isGold = (state.lockedDeltas[i]?.stateClass === "gold");

            let stateClass = "uncoloured";
            if (isGold) {
              stateClass = "gold";
            } else if (isAhead) {
              stateClass = gainedTime ? "ahead-gaining" : "ahead-losing";
            } else {
              stateClass = gainedTime ? "behind-gaining" : "behind-losing";
            }
            prevDiff = diff;

            const displayDelta = { text: app.formatDeltaSeconds(diff), isAhead, signedSeconds: diff };
            state.lockedDeltas[i] = { deltaInfo: displayDelta, stateClass, splitTimeSec };
            app.setDeltaDisplay(i, displayDelta, stateClass, splitTimeSec);
          } else {
            const displayDelta = { text: "-", isAhead: false, signedSeconds: 0 };
            const stateClass = "uncoloured";
            state.lockedDeltas[i] = { deltaInfo: displayDelta, stateClass, splitTimeSec };
            app.setDeltaDisplay(i, displayDelta, stateClass, splitTimeSec);
          }
        } else if (state.lockedDeltas[i]?.stateClass === "uncoloured" && (state.completedSplitTimes[i] === null || state.completedSplitTimes[i] === undefined)) {
          // Skipped split: retain uncoloured placeholder
          const skipDelta = { text: "-", isAhead: false, signedSeconds: 0 };
          app.setDeltaDisplay(i, skipDelta, "uncoloured", null);
        } else {
          // Upcoming split: update target comparison time
          const timeSpan = document.getElementById(`time-val-${i}`);
          if (timeSpan) {
            const targetVal = app.formatTargetTime(state.comparisonTimes[i]);
            timeSpan.innerText = targetVal || "-";
            timeSpan.className = "split-time-val target-time";
          }
          const deltaSpan = document.getElementById(`delta-val-${i}`);
          if (deltaSpan) {
            deltaSpan.innerText = "";
            deltaSpan.className = "split-delta-val";
          }
        }
      }

      if (state.currentIndex >= 0 && state.currentIndex < state.splitsList.length) {
        state.previousDeltaSeconds = prevDiff;
      }

      if (state.currentIndex >= 0) {
        app.saveInRunState();
      }

      if (updateLiveSplit) {
        app.sendRaw(`setcomparison ${state.currentComparison}`);
      }

      if (showToast) {
        app.showComparisonToast(state.currentComparison);
      }
    }

    function cycleComparison(reverse = false) {
      if (state.comparisonsList.length === 0) return;
      const currentIdx = state.comparisonsList.indexOf(state.currentComparison);
      const nextIdx = reverse
        ? (currentIdx - 1 + state.comparisonsList.length) % state.comparisonsList.length
        : (currentIdx + 1) % state.comparisonsList.length;
      const nextComp = state.comparisonsList[nextIdx];
      applyActiveComparison(nextComp, true);
    }

    function getGhostComparisonInfo(targetGhost = null) {
      return window.LiveSplit.GhostMath.getGhostComparisonInfo(
        targetGhost || app.ghostRunner.getPrimaryGhost(),
        state.currentTimingMethod,
        state.comparisonsDataGT,
        state.comparisonsDataRT,
        state.comparisonTimesGT,
        state.comparisonTimesRT
      );
    }

    function detectTimingMethodFromComp(splitIdx, compSec) {
      const detected = window.LiveSplit.SplitEngine.detectTimingMethodFromComp(
        splitIdx, compSec, state.comparisonTimesGT, state.comparisonTimesRT);
      if (detected) {
        const isManual = (localStorage.getItem(STORAGE_KEYS.TIMING_METHOD_MANUAL) === "true");
        if (!isManual && detected !== state.currentTimingMethod) {
          applyActiveTimingMethod(detected);
          localStorage.setItem(STORAGE_KEYS.TIMING_METHOD, detected);
        }
      }
      return detected;
    }

    return Object.assign(app, {
      normalizeComparisonName,
      initDefaultComparisons,
      applyActiveTimingMethod,
      applyActiveComparison,
      cycleComparison,
      detectTimingMethodFromComp,
      getGhostComparisonInfo
    });
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.ComparisonController = {
    installComparisonController
  };
})();
