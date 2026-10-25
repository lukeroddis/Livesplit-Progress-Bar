/**
 * src/core/run-persistence.js - In-Run State Persistence
 *
 * Saves live run progress (index, locked deltas, split times, delta baseline,
 * elapsed time) so an accidental page reload mid-run restores the HUD.
 * Snapshots are rejected when the split count, game or category changed.
 *
 * Installed onto the shared overlay `app` registry: reads/writes `app.state`
 * and calls other controllers through `app.<fn>` at call time.
 */

(function () {
  "use strict";

  function installRunPersistence(app) {
    const { state } = app;

    const IN_RUN_STATE_KEY = "livesplit_in_run_state";

    function saveInRunState() {
      try {
        const snapshot = {
          currentIndex: state.currentIndex,
          lockedDeltas: state.lockedDeltas,
          completedSplitTimes: state.completedSplitTimes,
          completedSplitTimesRT: state.completedSplitTimesRT,
          completedSplitTimesGT: state.completedSplitTimesGT,
          lastSplitRecordedSec: state.lastSplitRecordedSec,
          previousDeltaSeconds: state.previousDeltaSeconds,
          lastElapsedSec: state.lastElapsedSec,
          splitsCount: state.splitsList.length,
          game: localStorage.getItem("livesplit_game") || "",
          category: localStorage.getItem("livesplit_category") || ""
        };
        localStorage.setItem(IN_RUN_STATE_KEY, JSON.stringify(snapshot));
      } catch (e) {
        console.warn("Failed to persist in-run state to localStorage:", e);
      }
    }

    function clearInRunState() {
      try {
        state.trackManualScrollOffset = 0;
        localStorage.removeItem(IN_RUN_STATE_KEY);
        const rtaEl = document.getElementById("timer-rta");
        const igtEl = document.getElementById("timer-igt");
        if (rtaEl) rtaEl.innerText = "0.00";
        if (igtEl) igtEl.innerText = "0.00";
      } catch (e) {
        console.warn("Failed to clear in-run state from localStorage:", e);
      }
    }

    function loadInRunState() {
      try {
        const raw = localStorage.getItem(IN_RUN_STATE_KEY);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          if (typeof parsed.splitsCount === "number" && state.splitsList.length > 0 && parsed.splitsCount !== state.splitsList.length) {
            clearInRunState();
            return false;
          }
          const curGame = localStorage.getItem("livesplit_game") || "";
          const curCat = localStorage.getItem("livesplit_category") || "";
          if (parsed.game && curGame && parsed.game !== curGame) {
            clearInRunState();
            return false;
          }
          if (parsed.category && curCat && parsed.category !== curCat) {
            clearInRunState();
            return false;
          }
          state.lockedDeltas = parsed.lockedDeltas || {};
          state.completedSplitTimes = parsed.completedSplitTimes || {};
          state.completedSplitTimesRT = parsed.completedSplitTimesRT || {};
          state.completedSplitTimesGT = parsed.completedSplitTimesGT || {};
          state.lastSplitRecordedSec = Number(parsed.lastSplitRecordedSec) || 0;
          state.previousDeltaSeconds = Number(parsed.previousDeltaSeconds) || 0;
          if (typeof parsed.lastElapsedSec === "number") {
            state.lastElapsedSec = parsed.lastElapsedSec;
            if (state.lastElapsedSec > 0) {
              const rtaEl = document.getElementById("timer-rta");
              const igtEl = document.getElementById("timer-igt");
              const disp = app.formatTimerDisplay(state.lastElapsedSec);
              if (rtaEl) rtaEl.innerText = disp;
              if (igtEl) igtEl.innerText = disp;
            }
          }
          if (typeof parsed.currentIndex === "number") {
            state.currentIndex = parsed.currentIndex;
          }
          return true;
        }
      } catch (e) {
        console.warn("Failed to load in-run state from localStorage:", e);
      }
      return false;
    }

    return Object.assign(app, {
      saveInRunState,
      clearInRunState,
      loadInRunState
    });
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.RunPersistence = {
    installRunPersistence
  };
})();
