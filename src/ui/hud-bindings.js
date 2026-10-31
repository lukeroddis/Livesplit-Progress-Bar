/**
 * src/ui/hud-bindings.js - HUD Hotkey & Control Bindings
 *
 * Wires the static HUD controls to the overlay controllers once at startup:
 * - Latching settings trigger pill, close button and Escape to dismiss
 * - Comparison hotkeys: C / Shift+C, NumPad 6 / 4, ] / [ through the settings registry
 *   (ignored in inputs and Edit Mode)
 * - Click a timer block to focus its timing method
 * - "Always Show Last Split" checkbox
 *
 * Installed onto the shared overlay `app` registry: calls controllers through
 * `app.<fn>` when events fire.
 */

(function () {
  "use strict";

  const STORAGE_KEYS = window.LiveSplit.Storage.KEYS;

  function isTypingTarget(target) {
    return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
  }

  function isEditMode() {
    return document.body.classList.contains("edit-mode") ||
      (window.hudLayout && typeof window.hudLayout.isEditMode === "function" && window.hudLayout.isEditMode());
  }

  function installHudBindings(app) {
    const { state } = app;

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
          app.settings.cycle("comparison", e.shiftKey ? -1 : 1);
        } else if (e.code === "Numpad6" || e.key === "]") {
          e.preventDefault();
          app.settings.cycle("comparison", 1);
        } else if (e.code === "Numpad4" || e.key === "[") {
          e.preventDefault();
          app.settings.cycle("comparison", -1);
        }
      });
    }

    function bindTimerControls() {
      // Direct click on timer blocks to focus timing method
      document.getElementById("block-igt")?.addEventListener("click", () => {
        if (window.hudLayout && window.hudLayout.isEditMode && window.hudLayout.isEditMode()) return;
        app.settings.set("timingMethod", "GameTime");
      });
      document.getElementById("block-rta")?.addEventListener("click", () => {
        if (window.hudLayout && window.hudLayout.isEditMode && window.hudLayout.isEditMode()) return;
        app.settings.set("timingMethod", "RealTime");
      });

      document.getElementById("cb-always-show-last-split")?.addEventListener("change", (e) => {
        localStorage.setItem(STORAGE_KEYS.ALWAYS_SHOW_LAST, e.target.checked ? "true" : "false");
        app.updateTrackDensityAndAngle();
        app.updateTrackStatus(state.currentIndex);
      });
    }

    function bindHudControls() {
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
