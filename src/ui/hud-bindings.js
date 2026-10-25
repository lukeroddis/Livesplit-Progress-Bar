/**
 * src/ui/hud-bindings.js - HUD Badge, Hotkey & Control Bindings
 *
 * Wires the static HUD controls to the overlay controllers once at startup:
 * - Settings badges (golds, timing method, comparison, ghost, split density, angle)
 * - Latching settings trigger pill, close button and Escape to dismiss
 * - Comparison hotkeys: C / Shift+C, NumPad 6 / 4, ] / [ (ignored in inputs and Edit Mode)
 * - Click a timer block to focus its timing method
 * - "Always Show Last Split" checkbox
 *
 * Installed onto the shared overlay `app` registry: calls controllers through
 * `app.<fn>` when events fire.
 */

(function () {
  "use strict";

  function isTypingTarget(target) {
    return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
  }

  function isEditMode() {
    return document.body.classList.contains("edit-mode") ||
      (window.hudLayout && typeof window.hudLayout.isEditMode === "function" && window.hudLayout.isEditMode());
  }

  function installHudBindings(app) {
    const { state } = app;

    function bindBadges() {
      document.getElementById("gold-toggle-badge")?.addEventListener("click", app.toggleGoldSegments);
      document.getElementById("timing-method-badge")?.addEventListener("click", app.toggleTimingMethod);
      // Wrapped so the click event is not passed as cycleComparison's `reverse` flag
      document.getElementById("comparison-badge")?.addEventListener("click", () => app.cycleComparison());
      document.getElementById("ghost-badge")?.addEventListener("click", app.cycleGhostComparison);
      document.getElementById("split-density-badge")?.addEventListener("click", app.cycleVisibleSplits);
      document.getElementById("split-angle-badge")?.addEventListener("click", app.cycleSplitAngle);
    }

    function bindSettingsPill() {
      // Latching pressed-down trigger pill and close button
      const triggerPill = document.getElementById("settings-trigger-pill");
      const closeBtn = document.getElementById("btn-close-settings");

      if (triggerPill) {
        triggerPill.onclick = (e) => {
          if (e) {
            e.preventDefault();
            e.stopPropagation();
          }
          app.toggleSettingsMenu();
        };
      }

      if (closeBtn) {
        closeBtn.onclick = (e) => {
          if (e) {
            e.preventDefault();
            e.stopPropagation();
          }
          app.toggleSettingsMenu(false);
        };
      }

      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          app.toggleSettingsMenu(false);
        }
      });
    }

    function bindComparisonHotkeys() {
      window.addEventListener("keydown", (e) => {
        if (isTypingTarget(e.target)) return;
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        if (isEditMode()) return;

        if (e.key === "c" || e.key === "C") {
          e.preventDefault();
          app.cycleComparison(e.shiftKey);
        } else if (e.code === "Numpad6" || e.key === "]") {
          e.preventDefault();
          app.cycleComparison(false);
        } else if (e.code === "Numpad4" || e.key === "[") {
          e.preventDefault();
          app.cycleComparison(true);
        }
      });
    }

    function bindTimerControls() {
      // Direct click on timer blocks to focus timing method
      document.getElementById("block-igt")?.addEventListener("click", () => {
        if (window.hudLayout && window.hudLayout.isEditMode && window.hudLayout.isEditMode()) return;
        app.setTimingMethodFocus("GameTime");
      });
      document.getElementById("block-rta")?.addEventListener("click", () => {
        if (window.hudLayout && window.hudLayout.isEditMode && window.hudLayout.isEditMode()) return;
        app.setTimingMethodFocus("RealTime");
      });

      document.getElementById("cb-always-show-last-split")?.addEventListener("change", (e) => {
        localStorage.setItem("livesplit_always_show_last_split", e.target.checked ? "true" : "false");
        app.updateTrackDensityAndAngle();
        app.updateTrackStatus(state.currentIndex);
      });
    }

    function bindHudControls() {
      bindBadges();
      bindSettingsPill();
      bindComparisonHotkeys();
      bindTimerControls();
    }

    return Object.assign(app, { bindHudControls });
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.HudBindings = {
    installHudBindings
  };
})();
