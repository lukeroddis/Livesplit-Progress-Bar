/**
 * src/ui/timing-controls.js - Timer Display Mode, Timing Method & Gold Toggle Controls
 *
 * - Game / Real / Both timer display mode and primary timing method focus
 * - Timing badge and timer hierarchy (delegating to LiveSplit.TimerDisplay)
 * - switchto gametime/realtime sync with LiveSplit
 * - Gold split highlighting toggle and badge
 *
 * Installed onto the shared overlay `app` registry: reads/writes `app.state`
 * and calls other controllers through `app.<fn>` at call time.
 */

(function () {
  "use strict";

  function installTimingControls(app) {
    const { state } = app;

    function updateTimingMethodBadge() {
      return window.LiveSplit.TimerDisplay.updateTimingMethodBadge(state.timerDisplayMode, state.currentTimingMethod);
    }

    function updateTimerDisplayHierarchy() {
      return window.LiveSplit.TimerDisplay.updateTimerDisplayHierarchy(state.timerDisplayMode, state.currentTimingMethod);
    }

    function updateGoldBadge() {
      const badge = document.getElementById("gold-toggle-badge");
      if (badge) {
        const isEnabled = state.cachedEnableGolds;
        badge.innerText = isEnabled ? "Golds: ON" : "Golds: OFF";
        badge.style.color = isEnabled ? "#facc15" : "rgba(148, 163, 184, 0.7)";
      }
    }

    function toggleGoldSegments() {
      const current = (localStorage.getItem("livesplit_enable_golds") !== "false");
      const nextVal = (!current) ? "true" : "false";
      localStorage.setItem("livesplit_enable_golds", nextVal);
      state.cachedEnableGolds = (nextVal !== "false");
      updateGoldBadge();
    }

    function setTimerDisplayMode(mode, focusMethod) {
      if (mode !== "gametime" && mode !== "realtime" && mode !== "both") {
        mode = "both";
      }
      state.timerDisplayMode = mode;
      localStorage.setItem("livesplit_timer_display_mode", mode);
      localStorage.setItem("livesplit_timing_method_manual", "true");

      if (focusMethod === "GameTime" || focusMethod === "RealTime") {
        state.currentTimingMethod = focusMethod;
        localStorage.setItem("livesplit_timing_method", focusMethod);
      } else if (mode === "gametime") {
        state.currentTimingMethod = "GameTime";
        localStorage.setItem("livesplit_timing_method", "GameTime");
      } else if (mode === "realtime") {
        state.currentTimingMethod = "RealTime";
        localStorage.setItem("livesplit_timing_method", "RealTime");
      } else {
        // mode === "both" without explicit focus: preserve active or saved method
        const savedMethod = localStorage.getItem("livesplit_timing_method");
        if (savedMethod === "GameTime" || savedMethod === "RealTime") {
          state.currentTimingMethod = savedMethod;
        }
      }

      app.applyActiveTimingMethod(state.currentTimingMethod);
      updateTimerDisplayHierarchy();
      updateTimingMethodBadge();

      // Sync modal segmented controls if open
      window.LiveSplit.TimerDisplay.syncModalControls(mode, state.currentTimingMethod);

      if (state.currentTimingMethod === "GameTime") app.sendRaw("switchto gametime");
      else if (state.currentTimingMethod === "RealTime") app.sendRaw("switchto realtime");
    }

    function setTimingMethodFocus(method) {
      if (method !== "GameTime" && method !== "RealTime") return;
      localStorage.setItem("livesplit_timing_method_manual", "true");
      localStorage.setItem("livesplit_timing_method", method);
      state.currentTimingMethod = method;

      // If a single timer is active and user chooses opposite method, expand to both
      if (state.timerDisplayMode === "gametime" && method === "RealTime") {
        state.timerDisplayMode = "both";
        localStorage.setItem("livesplit_timer_display_mode", "both");
      } else if (state.timerDisplayMode === "realtime" && method === "GameTime") {
        state.timerDisplayMode = "both";
        localStorage.setItem("livesplit_timer_display_mode", "both");
      }

      app.applyActiveTimingMethod(state.currentTimingMethod);
      updateTimerDisplayHierarchy();
      updateTimingMethodBadge();

      // Sync modal controls
      window.LiveSplit.TimerDisplay.syncModalControls(state.timerDisplayMode, state.currentTimingMethod);

      if (method === "GameTime") app.sendRaw("switchto gametime");
      else if (method === "RealTime") app.sendRaw("switchto realtime");
    }

    function toggleTimingMethod() {
      // Cycles Game -> Real -> Both (Game) -> Both (Real)
      const next = window.LiveSplit.TimerDisplay.calculateNextTimingMode(state.timerDisplayMode, state.currentTimingMethod);
      setTimerDisplayMode(next.mode, next.focusMethod);
    }

    return Object.assign(app, {
      updateTimingMethodBadge,
      updateTimerDisplayHierarchy,
      setTimerDisplayMode,
      setTimingMethodFocus,
      toggleTimingMethod,
      updateGoldBadge,
      toggleGoldSegments
    });
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.TimingControls = {
    installTimingControls
  };
})();
