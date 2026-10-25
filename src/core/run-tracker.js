/**
 * src/core/run-tracker.js - LiveSplit Poll Loop & Split Transition Handlers
 *
 * - 33ms poll of game time, real time and split index (plus periodic comparison sync)
 * - Reset, run start, split advance (skips, golds, PB commit) and undo transitions
 * - Host progress reporting to the race client
 *
 * Protocol rules (DEVELOPER_GUIDE section 2): only getcurrentgametime / getcurrentrealtime /
 * getsplitindex are polled; transition queries run once per split change.
 *
 * Installed onto the shared overlay `app` registry: reads/writes `app.state`
 * and calls other controllers through `app.<fn>` at call time.
 */

(function () {
  "use strict";

  const STORAGE_KEYS = window.LiveSplit.Storage.KEYS;

  function installRunTracker(app) {
    const { state } = app;

    function handleUndoSplit(newIdx, oldIdx) {
      const isVertical = document.getElementById("track")?.classList.contains("vertical");

      for (let i = newIdx; i < state.splitsList.length; i++) {
        delete state.lockedDeltas[i];
        delete state.completedSplitTimes[i];
        delete state.completedSplitTimesRT[i];
        delete state.completedSplitTimesGT[i];

        const deltaSpan = document.getElementById(`delta-val-${i}`);
        const timeSpan = document.getElementById(`time-val-${i}`);
        const fill = document.getElementById(`fill-${i}`);
        const item = document.getElementById(`item-${i}`);
        const deltaEl = document.getElementById(`delta-${i}`);

        if (deltaEl) {
          deltaEl.classList.remove(...app.ALL_SPLIT_STATE_CLASSES);
        }
        if (deltaSpan) {
          deltaSpan.innerText = "";
          deltaSpan.className = "split-delta-val";
        }
        if (timeSpan) {
          const targetVal = app.formatTargetTime(state.comparisonTimes[i]);
          timeSpan.innerText = targetVal || "-";
          timeSpan.className = "split-time-val target-time";
        }
        if (fill) {
          fill.style.width = isVertical ? "100%" : "0%";
          fill.style.height = isVertical ? "0%" : "100%";
          fill.className = "segment-bar-fill";
          if (fill.parentElement) fill.parentElement.classList.remove("overdue");
        }
        if (item) {
          item.classList.remove(...app.ALL_SPLIT_STATE_CLASSES);
        }

        // Revert temporary in-run gold segment improvements back to baseline
        if (state.baselineBestSegmentTimesGT.length > 0 && state.baselineBestSegmentTimesRT.length > 0) {
          state.bestSegmentTimesGT[i] = state.baselineBestSegmentTimesGT[i];
          state.bestSegmentTimesRT[i] = state.baselineBestSegmentTimesRT[i];
          const isRT = state.currentTimingMethod === "RealTime";
          state.bestSegmentTimes[i] = isRT
            ? (state.bestSegmentTimesRT[i] ?? state.bestSegmentTimesGT[i] ?? null)
            : (state.bestSegmentTimesGT[i] ?? state.bestSegmentTimesRT[i] ?? null);
        }
      }

      // Roll back lastSplitRecordedSec to the last actual completed split
      state.lastSplitRecordedSec = 0;
      for (let k = newIdx - 1; k >= 0; k--) {
        if (state.completedSplitTimes[k] != null) {
          state.lastSplitRecordedSec = state.completedSplitTimes[k];
          break;
        }
      }

      // Roll back previousDeltaSeconds to the last completed split with comparison data
      state.previousDeltaSeconds = 0;
      for (let k = newIdx - 1; k >= 0; k--) {
        if (state.lockedDeltas[k] && state.lockedDeltas[k].deltaInfo && state.lockedDeltas[k].stateClass !== "uncoloured") {
          state.previousDeltaSeconds = state.lockedDeltas[k].deltaInfo.signedSeconds || 0;
          break;
        }
      }

      const rc = app.getRaceClient();
      if (rc && typeof rc.handleUndoSplit === "function") {
        rc.handleUndoSplit(newIdx, oldIdx);
      }

      app.saveInRunState();
    }

    // Clears per-run progress (deltas, split times, delta baseline) and the persisted in-run snapshot.
    // Resets also drop the elapsed time and any queued host split flash; a fresh start keeps them.
    function resetRunProgress({ isReset = true } = {}) {
      app.clearInRunState();
      state.lockedDeltas = {};
      state.completedSplitTimes = {};
      state.completedSplitTimesRT = {};
      state.completedSplitTimesGT = {};
      state.lastSplitRecordedSec = 0;
      state.previousDeltaSeconds = 0;
      if (isReset) {
        state.lastElapsedSec = 0;
        state.pendingHostSplitFlash = null;
      }
    }

    // Follows LiveSplit's active comparison when hotkey sync is enabled (disables itself if unsupported)
    async function syncComparisonFromLiveSplit(timeoutMs, isProbe = false) {
      const isSyncEnabled = (localStorage.getItem(STORAGE_KEYS.SYNC_HOTKEYS) !== "false");
      if (!isSyncEnabled || !state.canQueryComparison) return;
      const lsComp = await app.sendCommand("getcomparisonname", timeoutMs, isProbe);
      if (lsComp && lsComp !== "-" && lsComp.trim()) {
        const norm = app.normalizeComparisonName(lsComp.trim());
        if (norm && norm !== state.currentComparison) {
          app.applyActiveComparison(norm, false);
        }
      } else if (lsComp === null) {
        state.canQueryComparison = false;
      }
    }

    // Queries LiveSplit's comparison target for the now-active split and stores it on the active curve
    async function fetchComparisonTimeFor(idx) {
      const compSec = app.timeStringToSeconds(await app.sendCommand("getcomparisonsplittime"));
      if (compSec === null || compSec <= 0) return null;
      app.detectTimingMethodFromComp(idx, compSec);
      state.comparisonTimes[idx] = compSec;
      if (state.currentTimingMethod === "RealTime") state.comparisonTimesRT[idx] = compSec;
      else state.comparisonTimesGT[idx] = compSec;
      return compSec;
    }

    // Discard uncommitted in-run gold split segments by default upon reset
    function restoreBaselineGoldsOnReset() {
      const discardOnReset = (localStorage.getItem(STORAGE_KEYS.DISCARD_GOLDS_ON_RESET) !== "false");
      if (!discardOnReset || state.baselineBestSegmentTimesGT.length === 0) return;
      state.bestSegmentTimesGT = [...state.baselineBestSegmentTimesGT];
      state.bestSegmentTimesRT = [...state.baselineBestSegmentTimesRT];
      const isRT = state.currentTimingMethod === "RealTime";
      state.bestSegmentTimes = state.splitsList.map((_, i) => {
        return isRT
          ? (state.bestSegmentTimesRT[i] ?? state.bestSegmentTimesGT[i] ?? null)
          : (state.bestSegmentTimesGT[i] ?? state.bestSegmentTimesRT[i] ?? null);
      });
      localStorage.setItem(STORAGE_KEYS.GOLDS_GT, JSON.stringify(state.bestSegmentTimesGT));
      localStorage.setItem(STORAGE_KEYS.GOLDS_RT, JSON.stringify(state.bestSegmentTimesRT));
    }

    // Returns every split node to its pre-run look (empty delta, target time, empty fill)
    function resetTrackSplitDisplays() {
      const isVert = document.getElementById("track")?.classList.contains("vertical");
      for (let i = 0; i < state.splitsList.length; i++) {
        const deltaSpan = document.getElementById(`delta-val-${i}`);
        const timeSpan = document.getElementById(`time-val-${i}`);
        const fill = document.getElementById(`fill-${i}`);
        const item = document.getElementById(`item-${i}`);
        if (deltaSpan) {
          deltaSpan.innerText = "";
          deltaSpan.className = "split-delta-val";
        }
        if (timeSpan) {
          const targetVal = app.formatTargetTime(state.comparisonTimes[i]);
          timeSpan.innerText = targetVal || "-";
          timeSpan.className = "split-time-val target-time";
        }
        if (fill) {
          fill.style.width = isVert ? "100%" : "0%";
          fill.style.height = isVert ? "0%" : "100%";
          fill.className = "segment-bar-fill";
          if (fill.parentElement) fill.parentElement.classList.remove("overdue");
        }
        if (item) {
          item.classList.remove(...app.ALL_SPLIT_STATE_CLASSES);
        }
      }
    }

    // Reset transition: active run reset, restart from a later split, or a repeated reset to clear DNF
    async function handleRunReset(idx, rc, { isSecondResetWithDNF, isSimHostForfeit }) {
      if (isSecondResetWithDNF) {
        // Second reset while DNF'd: cleanly clear DNF and completely reset the race client
        resetRunProgress();
        if (typeof rc.setHostDNF === "function") rc.setHostDNF(false);
        if (typeof rc.reset === "function") rc.reset();
      } else if (isSimHostForfeit) {
        // Reset during active simulation: Host forfeits / cancels their run (DNF)
        // The rest of the simulated competitors continue racing so you can see DNF behavior on the leaderboard!
        rc.setHostDNF(true);
        resetRunProgress();
      } else {
        resetRunProgress();
        if (rc && typeof rc.reset === "function") rc.reset();
      }

      restoreBaselineGoldsOnReset();
      resetTrackSplitDisplays();
      app.updateTrackStatus(idx);
      app.updateGhostRunner(0);
      await app.syncLiveSplitMetadata();
      await syncComparisonFromLiveSplit(40);
    }

    // Timer just started a fresh run: ensure any prior DNF is cleared and the race starts cleanly
    async function handleRunStarted() {
      resetRunProgress({ isReset: false });

      const rcStart = app.getRaceClient();
      if (rcStart) {
        if (typeof rcStart.setHostDNF === "function" && rcStart.isHostDNF()) {
          rcStart.setHostDNF(false);
        }
        if (typeof rcStart.handleHostRunStarted === "function") {
          rcStart.handleHostRunStarted();
        }
      }

      // Fetch target time for the first split from LiveSplit
      if (state.splitsList.length > 0) {
        await fetchComparisonTimeFor(0);
      }
    }

    // If the runner skipped multiple splits in one leap, mark skipped intermediate splits as uncoloured
    function markSkippedSplits(fromIdx, toIdxExclusive) {
      for (let s = fromIdx; s < toIdxExclusive; s++) {
        delete state.completedSplitTimes[s];
        delete state.completedSplitTimesRT[s];
        const skipDelta = { ...window.LiveSplit.SplitEvaluation.DASH_DELTA };
        state.lockedDeltas[s] = { deltaInfo: skipDelta, stateClass: "uncoloured", splitTimeSec: null };
        app.setDeltaDisplay(s, skipDelta, "uncoloured", null);
      }
    }

    // Stores the split's cumulative time on the active curve and mirrors it onto the other timing method
    function recordCompletedSplitTimes(prevIdx, splitTimeSec, igtSec, rtaSec) {
      if (state.currentTimingMethod === "RealTime") {
        state.completedSplitTimesRT[prevIdx] = splitTimeSec;
        if (igtSec !== null && igtSec > 0) {
          state.completedSplitTimesGT[prevIdx] = igtSec;
        } else if (state.completedSplitTimesGT[prevIdx] != null) {
          // retain existing GT
        } else if (state.completedSplitTimes[prevIdx] != null) {
          state.completedSplitTimesGT[prevIdx] = state.completedSplitTimes[prevIdx];
        } else {
          state.completedSplitTimesGT[prevIdx] = splitTimeSec;
        }
      } else {
        state.completedSplitTimesGT[prevIdx] = splitTimeSec;
        state.completedSplitTimesRT[prevIdx] = (rtaSec !== null && rtaSec > 0) ? rtaSec : splitTimeSec;
      }
      state.completedSplitTimes[prevIdx] = (state.currentTimingMethod === "RealTime")
        ? state.completedSplitTimesRT[prevIdx]
        : state.completedSplitTimesGT[prevIdx];
    }

    function previousCompletedSplitSec(prevIdx) {
      for (let k = prevIdx - 1; k >= 0; k--) {
        if (state.completedSplitTimes[k] != null) return state.completedSplitTimes[k];
      }
      return 0;
    }

    function recordGoldSegment(prevIdx, segmentDurationSec) {
      state.bestSegmentTimes[prevIdx] = segmentDurationSec;
      if (state.currentTimingMethod === "RealTime") {
        state.bestSegmentTimesRT[prevIdx] = segmentDurationSec;
      } else {
        state.bestSegmentTimesGT[prevIdx] = segmentDurationSec;
      }

      // Only write to persistent storage immediately if the user opted out of discarding on reset
      const discardOnReset = (localStorage.getItem(STORAGE_KEYS.DISCARD_GOLDS_ON_RESET) !== "false");
      if (!discardOnReset) {
        if (state.currentTimingMethod === "RealTime") {
          localStorage.setItem(STORAGE_KEYS.GOLDS_RT, JSON.stringify(state.bestSegmentTimesRT));
        } else {
          localStorage.setItem(STORAGE_KEYS.GOLDS_GT, JSON.stringify(state.bestSegmentTimesGT));
        }
      }
    }

    // Final split beat the overall PB: adopt this run's splits as targets and commit earned golds to baseline
    function commitPersonalBestIfBeaten(splitTimeSec) {
      const overallPbSec = state.comparisonTimes[state.splitsList.length - 1];
      if (!(overallPbSec === null || overallPbSec === undefined || splitTimeSec < overallPbSec)) return;

      for (let i = 0; i < state.splitsList.length; i++) {
        if (state.completedSplitTimes[i] != null) {
          state.comparisonTimes[i] = state.completedSplitTimes[i];
          if (state.currentTimingMethod === "RealTime") {
            state.comparisonTimesRT[i] = state.completedSplitTimes[i];
          } else {
            state.comparisonTimesGT[i] = state.completedSplitTimes[i];
          }
        }
      }

      state.baselineBestSegmentTimesGT = [...state.bestSegmentTimesGT];
      state.baselineBestSegmentTimesRT = [...state.bestSegmentTimesRT];
      localStorage.setItem(STORAGE_KEYS.BASELINE_GOLDS_GT, JSON.stringify(state.baselineBestSegmentTimesGT));
      localStorage.setItem(STORAGE_KEYS.BASELINE_GOLDS_RT, JSON.stringify(state.baselineBestSegmentTimesRT));
      localStorage.setItem(STORAGE_KEYS.GOLDS_GT, JSON.stringify(state.bestSegmentTimesGT));
      localStorage.setItem(STORAGE_KEYS.GOLDS_RT, JSON.stringify(state.bestSegmentTimesRT));

      if (state.currentTimingMethod === "RealTime") {
        localStorage.setItem(STORAGE_KEYS.TARGETS_RT, JSON.stringify(state.comparisonTimesRT));
      } else {
        localStorage.setItem(STORAGE_KEYS.TARGETS_GT, JSON.stringify(state.comparisonTimesGT));
      }
    }

    // Split index advanced: evaluate the split(s) just left and arm the next split's target
    async function handleSplitAdvanced(idx, igtSec, rtaSec) {
      markSkippedSplits(state.currentIndex, idx - 1);

      const prevIdx = idx - 1;

      // A split was completed IF AND ONLY IF LiveSplit recorded a new positive split time
      // that is strictly greater than the last recorded split time of this run!
      const parsedLastSplit = app.timeStringToSeconds(await app.sendCommand("getlastsplittime"));
      const isSplitCompleted = (parsedLastSplit !== null && parsedLastSplit > 0 && parsedLastSplit > (state.lastSplitRecordedSec + 0.001));

      let splitTimeSec = null;
      let stateClass = "uncoloured";
      let displayDelta = { ...window.LiveSplit.SplitEvaluation.DASH_DELTA };

      if (isSplitCompleted) {
        splitTimeSec = parsedLastSplit;
        state.lastSplitRecordedSec = splitTimeSec;
        recordCompletedSplitTimes(prevIdx, splitTimeSec, igtSec, rtaSec);

        const finalDeltaInfo = app.formatDeltaLive(await app.sendCommand("getdelta"));
        const targetSec = (prevIdx < state.comparisonTimes.length && state.comparisonTimes[prevIdx] !== null && state.comparisonTimes[prevIdx] > 0)
          ? state.comparisonTimes[prevIdx]
          : null;
        const bestSec = (prevIdx < state.bestSegmentTimes.length && state.bestSegmentTimes[prevIdx] !== null && state.bestSegmentTimes[prevIdx] > 0)
          ? state.bestSegmentTimes[prevIdx]
          : null;

        const result = window.LiveSplit.SplitEvaluation.evaluateCompletedSplit({
          splitTimeSec,
          prevSplitSec: previousCompletedSplitSec(prevIdx),
          targetSec,
          bestSec,
          finalDeltaInfo,
          previousDeltaSeconds: state.previousDeltaSeconds,
          goldsEnabled: state.cachedEnableGolds,
          formatDeltaSeconds: app.formatDeltaSeconds
        });
        if (result.isGold) recordGoldSegment(prevIdx, result.segmentDurationSec);
        stateClass = result.stateClass;
        displayDelta = result.displayDelta;
        state.previousDeltaSeconds = result.previousDeltaSeconds;

        if (prevIdx === state.splitsList.length - 1 && splitTimeSec > 0) {
          commitPersonalBestIfBeaten(splitTimeSec);
        }
      } else {
        delete state.completedSplitTimes[prevIdx];
        delete state.completedSplitTimesRT[prevIdx];
        delete state.completedSplitTimesGT[prevIdx];
      }

      state.lockedDeltas[prevIdx] = { deltaInfo: displayDelta, stateClass, splitTimeSec };
      app.setDeltaDisplay(prevIdx, displayDelta, stateClass, splitTimeSec);
      app.saveInRunState();

      // Trigger leaderboard split flash glow for host
      state.pendingHostSplitFlash = {
        type: window.LiveSplit.SplitEvaluation.getSplitFlashType(stateClass),
        timestamp: Date.now(),
        completedSplitName: (prevIdx >= 0 && prevIdx < state.splitsList.length) ? state.splitsList[prevIdx] : `Split ${prevIdx + 1}`,
        newSplitName: (idx < state.splitsList.length) ? state.splitsList[idx] : "Finished"
      };

      // Query target comparison time once for the next newly active split
      if (idx < state.splitsList.length) {
        const nextCompSec = await fetchComparisonTimeFor(idx);
        const nextTimeSpan = nextCompSec !== null ? document.getElementById(`time-val-${idx}`) : null;
        if (nextTimeSpan) {
          nextTimeSpan.innerText = app.formatTargetTime(nextCompSec) || "-";
        }
      }
    }

    // Push the host's live progress to the race client (leaderboard, gaps, split flashes)
    function reportHostProgress(currentTotalSec, rtaSec) {
      const rc = app.getRaceClient();
      if (!rc || typeof rc.updateHostProgress !== "function") return;
      const hostSplitName = (state.currentIndex < 0)
        ? "Start"
        : (state.currentIndex < state.splitsList.length ? state.splitsList[state.currentIndex] : "Finished");
      const realTimeSec = (rtaSec !== null && rtaSec > 0) ? rtaSec : currentTotalSec;
      const rtComparisons = (state.comparisonTimesRT && state.comparisonTimesRT.length > 0) ? state.comparisonTimesRT : state.comparisonTimes;
      const rtCompletedSplits = (Object.keys(state.completedSplitTimesRT).length > 0) ? state.completedSplitTimesRT : state.completedSplitTimes;
      const gtCompletedSplits = (Object.keys(state.completedSplitTimesGT).length > 0) ? state.completedSplitTimesGT : state.completedSplitTimes;
      rc.updateHostProgress(
        currentTotalSec,
        state.currentIndex,
        gtCompletedSplits,
        state.comparisonTimes,
        hostSplitName,
        state.splitsList,
        state.pendingHostSplitFlash,
        true,
        realTimeSec,
        rtComparisons,
        rtCompletedSplits,
        state.currentTimingMethod
      );
      state.pendingHostSplitFlash = null;
    }

    // Reads one LiveSplit timer, mirrors it into its HUD element, and returns seconds (or null)
    async function pollTimer(command, elementId) {
      const raw = await app.sendCommand(command);
      if (!raw || raw === "-") return null;
      const el = document.getElementById(elementId);
      if (el) el.innerText = app.formatTimerDisplay(raw);
      return app.timeStringToSeconds(raw);
    }

    async function handleSplitIndex(idx, igtSec, rtaSec, currentTotalSec) {
      const rc = app.getRaceClient();
      if (rc && typeof rc.setExternalHostConnected === "function") {
        rc.setExternalHostConnected(true);
      }
      const isSim = rc && typeof rc.isSimulating === "function" && rc.isSimulating();
      const wasRunning = (state.currentIndex > 0) || (state.currentIndex === 0 && state.lastElapsedSec > 1.0);
      const isSecondResetWithDNF = (idx === -1 && state.currentIndex === -1 && rc && typeof rc.isHostDNF === "function" && rc.isHostDNF());

      if ((idx === -1 && state.currentIndex !== -1) || (idx === 0 && state.currentIndex > 0) || isSecondResetWithDNF) {
        const isSimHostForfeit = !isSecondResetWithDNF && isSim && wasRunning && typeof rc.setHostDNF === "function" && !rc.isHostDNF();
        await handleRunReset(idx, rc, { isSecondResetWithDNF, isSimHostForfeit });
      } else if (idx !== state.currentIndex) {
        if (state.currentIndex === -1 && idx === 0) {
          await handleRunStarted();
        } else if (state.currentIndex >= 0 && idx > state.currentIndex) {
          await handleSplitAdvanced(idx, igtSec, rtaSec);
        } else if (state.currentIndex >= 0 && idx < state.currentIndex) {
          // LiveSplit Undo Split triggered
          handleUndoSplit(idx, state.currentIndex);
        }
        app.updateTrackStatus(idx);
        if (idx >= 0) {
          app.saveInRunState();
        }
      }

      if (idx >= 0 && currentTotalSec !== null) {
        reportHostProgress(currentTotalSec, rtaSec);
        app.updateLiveSegmentProgress(currentTotalSec);
        app.updateGhostRunner(currentTotalSec);
      }
    }

    async function pollLoop() {
      while (app.connection.isOpen()) {
        try {
          // 0. Periodic Auto-Sync with LiveSplit hotkeys (every ~500ms)
          state.pollTick = (state.pollTick + 1) % 15;
          if (state.pollTick === 0) {
            await syncComparisonFromLiveSplit(120, true);
          }

          // 1-2. Game Time & Real Time
          const igtSec = await pollTimer("getcurrentgametime", "timer-igt");
          const rtaSec = await pollTimer("getcurrentrealtime", "timer-rta");

          // Total elapsed seconds for the active timing method (with fallback)
          const currentTotalSec = (state.currentTimingMethod === "RealTime")
            ? (rtaSec ?? igtSec)
            : (igtSec ?? rtaSec);
          if (currentTotalSec !== null) {
            state.lastElapsedSec = currentTotalSec;
          }

          // 3. Split Index (strict integer check to avoid corrupting run if non-integer text is received)
          const splitIdxStr = await app.sendCommand("getsplitindex");
          const isStrictInt = typeof splitIdxStr === "string" && /^-?\d+$/.test(splitIdxStr.trim());
          if (isStrictInt) {
            await handleSplitIndex(parseInt(splitIdxStr.trim(), 10), igtSec, rtaSec, currentTotalSec);
          }
        } catch (loopErr) {
          console.error("[LiveSplit] Error in pollLoop tick:", loopErr);
        }
        await new Promise((r) => setTimeout(r, 33));
      }
    }

    return Object.assign(app, {
      resetRunProgress,
      syncComparisonFromLiveSplit,
      fetchComparisonTimeFor,
      restoreBaselineGoldsOnReset,
      resetTrackSplitDisplays,
      handleRunReset,
      handleRunStarted,
      markSkippedSplits,
      recordCompletedSplitTimes,
      previousCompletedSplitSec,
      recordGoldSegment,
      commitPersonalBestIfBeaten,
      handleSplitAdvanced,
      handleUndoSplit,
      reportHostProgress,
      pollTimer,
      handleSplitIndex,
      pollLoop
    });
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.RunTracker = {
    installRunTracker
  };
})();
