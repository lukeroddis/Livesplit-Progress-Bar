/**
 * src/core/splits-loader.js - Splits Loading (.lss Parse & Cached Restore)
 *
 * - Applies a parsed .lss (LiveSplit.SplitEngine.parseLssXml) to the overlay state:
 *   splits, per-method comparison curves, best segments and gold baselines
 * - Restores the last loaded splits and preferences from storage on startup
 * - Falls back to generic default splits when nothing is cached
 *
 * Installed onto the shared overlay `app` registry: reads/writes `app.state`
 * and calls other controllers through `app.<fn>` at call time.
 */

(function () {
  "use strict";

  const STORAGE_KEYS = window.LiveSplit.Storage.KEYS;
  // safeStorage: a splits file too big for the storage quota must still load (in-memory fallback)
  const { safeStorage } = window.LiveSplit.Storage;

  function installSplitsLoader(app) {
    const { state } = app;

    function parseLSS(xmlText, isNewDrop = false) {
      try {
        if (isNewDrop) {
          app.clearInRunState();
          state.currentIndex = -1;
          state.lockedDeltas = {};
          state.completedSplitTimes = {};
          state.completedSplitTimesRT = {};
          state.lastSplitRecordedSec = 0;
          state.previousDeltaSeconds = 0;
          state.lastElapsedSec = 0;
        }

        const parser = new DOMParser();
        const xml = parser.parseFromString(xmlText, "text/xml");

        const game = xml.querySelector("GameName")?.textContent?.trim();
        const category = xml.querySelector("CategoryName")?.textContent?.trim();
        if (game) {
          app.setGameName(game);
          safeStorage.setItem(STORAGE_KEYS.GAME_NAME, game);
        }
        if (category) {
          app.setCategoryName(category);
          safeStorage.setItem(STORAGE_KEYS.CATEGORY_NAME, category);
        }

        // Pure XML parsing & curve computation is delegated to LiveSplit.SplitEngine
        const parsed = window.LiveSplit.SplitEngine.parseLssXml(xmlText);
        if (parsed) {
          state.splitsList = parsed.splitsList;
          state.comparisonTimesGT = parsed.comparisonTimesGT;
          state.comparisonTimesRT = parsed.comparisonTimesRT;
          state.bestSegmentTimesGT = parsed.bestSegmentTimesGT;
          state.bestSegmentTimesRT = parsed.bestSegmentTimesRT;
          state.comparisonsDataGT = parsed.comparisonsDataGT;
          state.comparisonsDataRT = parsed.comparisonsDataRT;
          state.comparisonsList = parsed.comparisonsList;

          // Auto-detect the timing method the PB was run with (see SplitEngine.detectTimingMethodFromSplits)
          const detectedMethod = parsed.timingMethod;
          const isManualMethod = (safeStorage.getItem(STORAGE_KEYS.TIMING_METHOD_MANUAL) === "true");
          if (!isManualMethod) {
            state.currentTimingMethod = detectedMethod;
            safeStorage.setItem(STORAGE_KEYS.TIMING_METHOD, state.currentTimingMethod);
          } else {
            const savedMethod = safeStorage.getItem(STORAGE_KEYS.TIMING_METHOD);
            if (savedMethod === "RealTime" || savedMethod === "GameTime") {
              state.currentTimingMethod = savedMethod;
            } else {
              state.currentTimingMethod = detectedMethod;
            }
          }

          // Cache raw LSS and parsed data
          state.baselineBestSegmentTimesGT = [...state.bestSegmentTimesGT];
          state.baselineBestSegmentTimesRT = [...state.bestSegmentTimesRT];
          safeStorage.setItem(STORAGE_KEYS.BASELINE_GOLDS_GT, JSON.stringify(state.baselineBestSegmentTimesGT));
          safeStorage.setItem(STORAGE_KEYS.BASELINE_GOLDS_RT, JSON.stringify(state.baselineBestSegmentTimesRT));
          safeStorage.setItem(STORAGE_KEYS.RAW_LSS, xmlText);
          safeStorage.setItem(STORAGE_KEYS.SEGMENTS, JSON.stringify(state.splitsList));
          safeStorage.setItem(STORAGE_KEYS.TARGETS_GT, JSON.stringify(state.comparisonTimesGT));
          safeStorage.setItem(STORAGE_KEYS.TARGETS_RT, JSON.stringify(state.comparisonTimesRT));
          safeStorage.setItem(STORAGE_KEYS.GOLDS_GT, JSON.stringify(state.bestSegmentTimesGT));
          safeStorage.setItem(STORAGE_KEYS.GOLDS_RT, JSON.stringify(state.bestSegmentTimesRT));
          safeStorage.setItem(STORAGE_KEYS.COMPARISONS_LIST, JSON.stringify(state.comparisonsList));
          safeStorage.setItem(STORAGE_KEYS.COMPARISONS_GT, JSON.stringify(state.comparisonsDataGT));
          safeStorage.setItem(STORAGE_KEYS.COMPARISONS_RT, JSON.stringify(state.comparisonsDataRT));

          app.updateGoldBadge();
          app.applyActiveComparison(state.currentComparison, false, false);
          if (!isNewDrop) {
            app.loadInRunState();
          }
          app.renderTrack();
          const dropDesc = document.getElementById("dropzone-desc");
          if (dropDesc) {
            const gName = game || safeStorage.getItem(STORAGE_KEYS.GAME_NAME) || "";
            dropDesc.innerText = `Active: ${gName ? gName + " • " : ""}${state.splitsList.length} splits loaded ✓`;
            dropDesc.style.color = "#38bdf8";
          }
          if (window.hudLayout && window.hudLayout.syncTrackModalUI) {
            window.hudLayout.syncTrackModalUI();
          }
        }
      } catch (e) {
        console.error("Failed to parse .lss XML", e);
      }
    }

    function loadCachedSplits() {
      state.cachedEnableGolds = (safeStorage.getItem(STORAGE_KEYS.ENABLE_GOLDS) !== "false");
      const savedTimerMode = safeStorage.getItem(STORAGE_KEYS.TIMER_DISPLAY_MODE);
      const params = new URLSearchParams(window.location.search);
      const urlTimer = params.get("timer") || params.get("time");
      if (urlTimer && ["gametime", "realtime", "both"].includes(urlTimer.toLowerCase())) {
        state.timerDisplayMode = urlTimer.toLowerCase();
      } else if (savedTimerMode && ["gametime", "realtime", "both"].includes(savedTimerMode)) {
        state.timerDisplayMode = savedTimerMode;
      }

      const isManualMethod = (safeStorage.getItem(STORAGE_KEYS.TIMING_METHOD_MANUAL) === "true");
      const savedMethod = safeStorage.getItem(STORAGE_KEYS.TIMING_METHOD);
      if (isManualMethod && (savedMethod === "RealTime" || savedMethod === "GameTime")) {
        state.currentTimingMethod = savedMethod;
      } else if (state.timerDisplayMode === "gametime") {
        state.currentTimingMethod = "GameTime";
      } else if (state.timerDisplayMode === "realtime") {
        state.currentTimingMethod = "RealTime";
      }

      const savedComp = safeStorage.getItem(STORAGE_KEYS.CURRENT_COMPARISON);
      if (savedComp) {
        state.currentComparison = savedComp;
      }

      const savedGame = safeStorage.getItem(STORAGE_KEYS.GAME_NAME);
      const savedCategory = safeStorage.getItem(STORAGE_KEYS.CATEGORY_NAME);
      if (savedGame) app.setGameName(savedGame);
      if (savedCategory) app.setCategoryName(savedCategory);

      const rawLss = safeStorage.getItem(STORAGE_KEYS.RAW_LSS);
      if (rawLss) {
        parseLSS(rawLss);
        return;
      }

      const cachedSegments = safeStorage.getItem(STORAGE_KEYS.SEGMENTS);
      if (cachedSegments) {
        try {
          state.splitsList = JSON.parse(cachedSegments);
          state.comparisonTimesGT = JSON.parse(safeStorage.getItem(STORAGE_KEYS.TARGETS_GT) || "[]");
          state.comparisonTimesRT = JSON.parse(safeStorage.getItem(STORAGE_KEYS.TARGETS_RT) || "[]");
          state.bestSegmentTimesGT = JSON.parse(safeStorage.getItem(STORAGE_KEYS.GOLDS_GT) || "[]");
          state.bestSegmentTimesRT = JSON.parse(safeStorage.getItem(STORAGE_KEYS.GOLDS_RT) || "[]");

          const cachedBaseGT = safeStorage.getItem(STORAGE_KEYS.BASELINE_GOLDS_GT);
          const cachedBaseRT = safeStorage.getItem(STORAGE_KEYS.BASELINE_GOLDS_RT);
          if (cachedBaseGT && cachedBaseRT) {
            state.baselineBestSegmentTimesGT = JSON.parse(cachedBaseGT);
            state.baselineBestSegmentTimesRT = JSON.parse(cachedBaseRT);
          } else {
            state.baselineBestSegmentTimesGT = [...state.bestSegmentTimesGT];
            state.baselineBestSegmentTimesRT = [...state.bestSegmentTimesRT];
          }

          const cachedCompsList = safeStorage.getItem(STORAGE_KEYS.COMPARISONS_LIST);
          if (cachedCompsList) state.comparisonsList = JSON.parse(cachedCompsList);
          const cachedCompsGT = safeStorage.getItem(STORAGE_KEYS.COMPARISONS_GT);
          if (cachedCompsGT) state.comparisonsDataGT = JSON.parse(cachedCompsGT);
          const cachedCompsRT = safeStorage.getItem(STORAGE_KEYS.COMPARISONS_RT);
          if (cachedCompsRT) state.comparisonsDataRT = JSON.parse(cachedCompsRT);

          if (!state.comparisonsDataGT["Personal Best"]) state.comparisonsDataGT["Personal Best"] = [...state.comparisonTimesGT];
          if (!state.comparisonsDataRT["Personal Best"]) state.comparisonsDataRT["Personal Best"] = [...state.comparisonTimesRT];

          // Cross-fill and sanitize custom comparisons
          const allCachedCustom = new Set([...Object.keys(state.comparisonsDataGT), ...Object.keys(state.comparisonsDataRT)]);
          allCachedCustom.forEach(cName => {
            const cGT = state.comparisonsDataGT[cName];
            const cRT = state.comparisonsDataRT[cName];
            const hasGT = cGT && cGT.some(t => t !== null && t > 0);
            const hasRT = cRT && cRT.some(t => t !== null && t > 0);
            if (hasGT && !hasRT) state.comparisonsDataRT[cName] = app.sanitizeComparisonTimes(cGT, state.comparisonTimesRT);
            if (hasRT && !hasGT) state.comparisonsDataGT[cName] = app.sanitizeComparisonTimes(cRT, state.comparisonTimesGT);
          });

          const detectedMethod = window.LiveSplit.SplitEngine.detectTimingMethodFromSplits(
            state.comparisonTimesGT, state.comparisonTimesRT, state.bestSegmentTimesGT, state.bestSegmentTimesRT);
          const isManualMethod = (safeStorage.getItem(STORAGE_KEYS.TIMING_METHOD_MANUAL) === "true");
          if (!isManualMethod) {
            state.currentTimingMethod = detectedMethod;
            safeStorage.setItem(STORAGE_KEYS.TIMING_METHOD, state.currentTimingMethod);
          }
          app.applyActiveTimingMethod(state.currentTimingMethod);

          app.updateGoldBadge();
          app.applyActiveComparison(state.currentComparison, false, false);
          app.loadInRunState();
          app.renderTrack();
          const dropDesc = document.getElementById("dropzone-desc");
          if (dropDesc && state.splitsList.length > 0) {
            const gName = safeStorage.getItem(STORAGE_KEYS.GAME_NAME) || "";
            dropDesc.innerText = `Active: ${gName ? gName + " • " : ""}${state.splitsList.length} splits loaded ✓`;
            dropDesc.style.color = "#38bdf8";
          }
          if (window.hudLayout && window.hudLayout.syncTrackModalUI) {
            window.hudLayout.syncTrackModalUI();
          }
          return;
        } catch (e) {
          console.warn("Failed loading cached split JSON, falling back to defaults", e);
        }
      }

      // Fallback generic splits template
      state.splitsList = [...app.DEFAULT_SPLITS];
      state.comparisonTimesGT = [...app.DEFAULT_TARGETS];
      state.comparisonTimesRT = [...app.DEFAULT_TARGETS];
      state.bestSegmentTimesGT = [...app.DEFAULT_BESTS];
      state.bestSegmentTimesRT = [...app.DEFAULT_BESTS];
      state.baselineBestSegmentTimesGT = [...app.DEFAULT_BESTS];
      state.baselineBestSegmentTimesRT = [...app.DEFAULT_BESTS];
      app.initDefaultComparisons();

      app.updateGoldBadge();
      app.applyActiveComparison(state.currentComparison, false, false);
      app.loadInRunState();
      app.renderTrack();
      if (window.hudLayout && window.hudLayout.syncTrackModalUI) {
        window.hudLayout.syncTrackModalUI();
      }
    }

    return Object.assign(app, {
      parseLSS,
      loadCachedSplits
    });
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.SplitsLoader = {
    installSplitsLoader
  };
})();
