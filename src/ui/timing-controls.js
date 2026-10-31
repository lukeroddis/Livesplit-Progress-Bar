/**
 * src/ui/timing-controls.js - Timer Display Mode, Timing Method & Gold Toggle Controls
 *
 * - Game / Real / Both timer display mode and primary timing method focus
 * - Timer hierarchy (delegating to LiveSplit.TimerDisplay)
 * - switchto gametime/realtime sync with LiveSplit
 * - Gold split highlighting toggle
 *
 * Installed onto the shared overlay `app` registry: reads/writes `app.state`
 * and calls other controllers through `app.<fn>` at call time.
 */

(function () {
  "use strict";

  const STORAGE_KEYS = window.LiveSplit.Storage.KEYS;

  function installTimingControls(app) {
    const { state } = app;

    function updateTimerDisplayHierarchy() {
      return window.LiveSplit.TimerDisplay.updateTimerDisplayHierarchy(state.timerDisplayMode, state.currentTimingMethod);
    }

    function setGoldSegments(enabled) {
      localStorage.setItem(STORAGE_KEYS.ENABLE_GOLDS, enabled ? "true" : "false");
      state.cachedEnableGolds = !!enabled;
    }

    function toggleGoldSegments() {
      setGoldSegments(localStorage.getItem(STORAGE_KEYS.ENABLE_GOLDS) === "false");
    }

    function setTimerDisplayMode(mode, focusMethod) {
      if (mode !== "gametime" && mode !== "realtime" && mode !== "both") {
        mode = "both";
      }
      state.timerDisplayMode = mode;
      localStorage.setItem(STORAGE_KEYS.TIMER_DISPLAY_MODE, mode);
      localStorage.setItem(STORAGE_KEYS.TIMING_METHOD_MANUAL, "true");

      if (focusMethod === "GameTime" || focusMethod === "RealTime") {
        state.currentTimingMethod = focusMethod;
        localStorage.setItem(STORAGE_KEYS.TIMING_METHOD, focusMethod);
      } else if (mode === "gametime") {
        state.currentTimingMethod = "GameTime";
        localStorage.setItem(STORAGE_KEYS.TIMING_METHOD, "GameTime");
      } else if (mode === "realtime") {
        state.currentTimingMethod = "RealTime";
        localStorage.setItem(STORAGE_KEYS.TIMING_METHOD, "RealTime");
      } else {
        // mode === "both" without explicit focus: preserve active or saved method
        const savedMethod = localStorage.getItem(STORAGE_KEYS.TIMING_METHOD);
        if (savedMethod === "GameTime" || savedMethod === "RealTime") {
          state.currentTimingMethod = savedMethod;
        }
      }

      app.applyActiveTimingMethod(state.currentTimingMethod);
      updateTimerDisplayHierarchy();

      if (state.currentTimingMethod === "GameTime") app.sendRaw("switchto gametime");
      else if (state.currentTimingMethod === "RealTime") app.sendRaw("switchto realtime");
    }

    function setTimingMethodFocus(method) {
      if (method !== "GameTime" && method !== "RealTime") return;
      localStorage.setItem(STORAGE_KEYS.TIMING_METHOD_MANUAL, "true");
      localStorage.setItem(STORAGE_KEYS.TIMING_METHOD, method);
      state.currentTimingMethod = method;

      // If a single timer is active and user chooses opposite method, expand to both
      if (state.timerDisplayMode === "gametime" && method === "RealTime") {
        state.timerDisplayMode = "both";
        localStorage.setItem(STORAGE_KEYS.TIMER_DISPLAY_MODE, "both");
      } else if (state.timerDisplayMode === "realtime" && method === "GameTime") {
        state.timerDisplayMode = "both";
        localStorage.setItem(STORAGE_KEYS.TIMER_DISPLAY_MODE, "both");
      }

      app.applyActiveTimingMethod(state.currentTimingMethod);
      updateTimerDisplayHierarchy();

      if (method === "GameTime") app.sendRaw("switchto gametime");
      else if (method === "RealTime") app.sendRaw("switchto realtime");
    }

    function toggleTimingMethod() {
      // Cycles Game -> Real -> Both (Game) -> Both (Real)
      const next = window.LiveSplit.TimerDisplay.calculateNextTimingMode(state.timerDisplayMode, state.currentTimingMethod);
      setTimerDisplayMode(next.mode, next.focusMethod);
    }

    return Object.assign(app, {
      updateTimerDisplayHierarchy,
      setTimerDisplayMode,
      setTimingMethodFocus,
      toggleTimingMethod,
      setGoldSegments,
      toggleGoldSegments
    });
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.TimingControls = {
    installTimingControls
  };
})();
