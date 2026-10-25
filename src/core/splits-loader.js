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
          localStorage.setItem("livesplit_game", game);
        }
        if (category) {
          app.setCategoryName(category);
          localStorage.setItem("livesplit_category", category);
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

          // Auto-detect timing method from the splits file:
          // If splits have GameTime recorded (e.g. PC speedruns with load remover), default to GameTime.
          // If no GameTime at all (e.g. console speedruns), default to RealTime.
          const hasAnyGameTime = state.comparisonTimesGT.some(t => t !== null && t > 0) || 
                                 state.bestSegmentTimesGT.some(t => t !== null && t > 0);
          const isManualMethod = (localStorage.getItem("livesplit_timing_method_manual") === "true");
          if (!isManualMethod) {
            state.currentTimingMethod = hasAnyGameTime ? "GameTime" : "RealTime";
            localStorage.setItem("livesplit_timing_method", state.currentTimingMethod);
          } else {
            const savedMethod = localStorage.getItem("livesplit_timing_method");
            if (savedMethod === "RealTime" || savedMethod === "GameTime") {
              state.currentTimingMethod = savedMethod;
            } else {
              state.currentTimingMethod = hasAnyGameTime ? "GameTime" : "RealTime";
            }
          }

          // Cache raw LSS and parsed data
          state.baselineBestSegmentTimesGT = [...state.bestSegmentTimesGT];
          state.baselineBestSegmentTimesRT = [...state.bestSegmentTimesRT];
          localStorage.setItem("livesplit_baseline_golds_gt", JSON.stringify(state.baselineBestSegmentTimesGT));
          localStorage.setItem("livesplit_baseline_golds_rt", JSON.stringify(state.baselineBestSegmentTimesRT));
          localStorage.setItem("livesplit_raw_lss", xmlText);
          localStorage.setItem("livesplit_segments", JSON.stringify(state.splitsList));
          localStorage.setItem("livesplit_targets_gt", JSON.stringify(state.comparisonTimesGT));
          localStorage.setItem("livesplit_targets_rt", JSON.stringify(state.comparisonTimesRT));
          localStorage.setItem("livesplit_golds_gt", JSON.stringify(state.bestSegmentTimesGT));
          localStorage.setItem("livesplit_golds_rt", JSON.stringify(state.bestSegmentTimesRT));
          localStorage.setItem("livesplit_comparisons_list", JSON.stringify(state.comparisonsList));
          localStorage.setItem("livesplit_comparisons_gt", JSON.stringify(state.comparisonsDataGT));
          localStorage.setItem("livesplit_comparisons_rt", JSON.stringify(state.comparisonsDataRT));

          app.updateGoldBadge();
          app.applyActiveComparison(state.currentComparison, false, false);
          if (!isNewDrop) {
            app.loadInRunState();
          }
          app.renderTrack();
          const dropDesc = document.getElementById("dropzone-desc");
          if (dropDesc) {
            const gName = game || localStorage.getItem("livesplit_game") || "";
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
      state.cachedEnableGolds = (localStorage.getItem("livesplit_enable_golds") !== "false");
      const savedTimerMode = localStorage.getItem("livesplit_timer_display_mode");
      const params = new URLSearchParams(window.location.search);
      const urlTimer = params.get("timer") || params.get("time");
      if (urlTimer && ["gametime", "realtime", "both"].includes(urlTimer.toLowerCase())) {
        state.timerDisplayMode = urlTimer.toLowerCase();
      } else if (savedTimerMode && ["gametime", "realtime", "both"].includes(savedTimerMode)) {
        state.timerDisplayMode = savedTimerMode;
      }

      const isManualMethod = (localStorage.getItem("livesplit_timing_method_manual") === "true");
      const savedMethod = localStorage.getItem("livesplit_timing_method");
      if (isManualMethod && (savedMethod === "RealTime" || savedMethod === "GameTime")) {
        state.currentTimingMethod = savedMethod;
      } else if (state.timerDisplayMode === "gametime") {
        state.currentTimingMethod = "GameTime";
      } else if (state.timerDisplayMode === "realtime") {
        state.currentTimingMethod = "RealTime";
      }

      const savedComp = localStorage.getItem("livesplit_current_comparison");
      if (savedComp) {
        state.currentComparison = savedComp;
      }

      const savedGame = localStorage.getItem("livesplit_game");
      const savedCategory = localStorage.getItem("livesplit_category");
      if (savedGame) app.setGameName(savedGame);
      if (savedCategory) app.setCategoryName(savedCategory);

      const rawLss = localStorage.getItem("livesplit_raw_lss");
      if (rawLss) {
        parseLSS(rawLss);
        return;
      }

      const cachedSegments = localStorage.getItem("livesplit_segments");
      if (cachedSegments) {
        try {
          state.splitsList = JSON.parse(cachedSegments);
          state.comparisonTimesGT = JSON.parse(localStorage.getItem("livesplit_targets_gt") || "[]");
          state.comparisonTimesRT = JSON.parse(localStorage.getItem("livesplit_targets_rt") || "[]");
          state.bestSegmentTimesGT = JSON.parse(localStorage.getItem("livesplit_golds_gt") || "[]");
          state.bestSegmentTimesRT = JSON.parse(localStorage.getItem("livesplit_golds_rt") || "[]");

          const cachedBaseGT = localStorage.getItem("livesplit_baseline_golds_gt");
          const cachedBaseRT = localStorage.getItem("livesplit_baseline_golds_rt");
          if (cachedBaseGT && cachedBaseRT) {
            state.baselineBestSegmentTimesGT = JSON.parse(cachedBaseGT);
            state.baselineBestSegmentTimesRT = JSON.parse(cachedBaseRT);
          } else {
            state.baselineBestSegmentTimesGT = [...state.bestSegmentTimesGT];
            state.baselineBestSegmentTimesRT = [...state.bestSegmentTimesRT];
          }

          const cachedCompsList = localStorage.getItem("livesplit_comparisons_list");
          if (cachedCompsList) state.comparisonsList = JSON.parse(cachedCompsList);
          const cachedCompsGT = localStorage.getItem("livesplit_comparisons_gt");
          if (cachedCompsGT) state.comparisonsDataGT = JSON.parse(cachedCompsGT);
          const cachedCompsRT = localStorage.getItem("livesplit_comparisons_rt");
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

          const hasAnyGameTime = state.comparisonTimesGT.some(t => t !== null && t > 0) || 
                                 state.bestSegmentTimesGT.some(t => t !== null && t > 0);
          const isManualMethod = (localStorage.getItem("livesplit_timing_method_manual") === "true");
          if (!isManualMethod) {
            state.currentTimingMethod = hasAnyGameTime ? "GameTime" : "RealTime";
            localStorage.setItem("livesplit_timing_method", state.currentTimingMethod);
          }
          app.applyActiveTimingMethod(state.currentTimingMethod);

          app.updateGoldBadge();
          app.applyActiveComparison(state.currentComparison, false, false);
          app.loadInRunState();
          app.renderTrack();
          const dropDesc = document.getElementById("dropzone-desc");
          if (dropDesc && state.splitsList.length > 0) {
            const gName = localStorage.getItem("livesplit_game") || "";
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
