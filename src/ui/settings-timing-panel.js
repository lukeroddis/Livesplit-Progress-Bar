/**
 * src/ui/settings-timing-panel.js - Timing & Comparison Settings Panel
 *
 * Active comparison dropdown, LiveSplit hotkey sync, discard-golds-on-reset,
 * visible timers (Game / Real / Both) and the primary timer & splits target.
 */

(function () {
  "use strict";

  const STORAGE_KEYS = window.LiveSplit.Storage.KEYS;
  const C = window.LiveSplit.SettingsControls;

  const COMPARISON_LABELS = {
    "Personal Best": "Personal Best (PB)",
    "Best Segments": "Best Segments (Sum of Best)"
  };

  function syncComparisonDropdown() {
    const selComp = document.getElementById("select-active-comparison");
    if (!selComp || typeof window === "undefined" || !window.getComparisonsList) return;
    const curComp = window.getCurrentComparison ? window.getCurrentComparison() : "Personal Best";
    selComp.innerHTML = "";
    window.getComparisonsList().forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.innerText = COMPARISON_LABELS[c] || c;
      if (c === curComp) opt.selected = true;
      selComp.appendChild(opt);
    });
  }

  function syncTimerControls() {
    const curTimerMode = (typeof window !== "undefined" && window.getTimerDisplayMode)
      ? window.getTimerDisplayMode()
      : (localStorage.getItem(STORAGE_KEYS.TIMER_DISPLAY_MODE) || "both");
    C.syncSegmented("#ctrl-timer-display", curTimerMode);

    const curFocus = (typeof window !== "undefined" && window.getCurrentTimingMethod)
      ? window.getCurrentTimingMethod()
      : (localStorage.getItem(STORAGE_KEYS.TIMING_METHOD) || "GameTime");
    C.syncSegmented("#ctrl-timer-focus", curFocus);

    // Primary timer choice only applies when both timers are shown
    const rowTimerFocus = document.getElementById("row-timer-focus");
    if (rowTimerFocus) {
      rowTimerFocus.style.display = (curTimerMode === "both") ? "flex" : "none";
    }
  }

  function createTimingPanel() {
    function sync() {
      C.syncStorageCheckbox("cb-discard-golds-reset", STORAGE_KEYS.DISCARD_GOLDS_ON_RESET);
      syncComparisonDropdown();
      C.syncStorageCheckbox("cb-sync-livesplit-hotkeys", STORAGE_KEYS.SYNC_HOTKEYS);
      syncTimerControls();
    }

    function bind() {
      C.bindStorageCheckbox("cb-discard-golds-reset", STORAGE_KEYS.DISCARD_GOLDS_ON_RESET);
      C.bindStorageCheckbox("cb-sync-livesplit-hotkeys", STORAGE_KEYS.SYNC_HOTKEYS);

      document.getElementById("select-active-comparison")?.addEventListener("change", (e) => {
        if (typeof window !== "undefined" && window.applyActiveComparison) {
          window.applyActiveComparison(e.target.value, true);
        }
      });

      C.bindSegmented("#ctrl-timer-display", (val) => {
        if (typeof window !== "undefined" && window.setTimerDisplayMode) {
          window.setTimerDisplayMode(val);
        }
      });

      C.bindSegmented("#ctrl-timer-focus", (val) => {
        if (typeof window === "undefined") return;
        if (window.setTimingMethodFocus) {
          window.setTimingMethodFocus(val);
        } else if (window.applyActiveTimingMethod) {
          window.applyActiveTimingMethod(val);
        }
      });
    }

    return { sync, bind };
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.SettingsTimingPanel = {
    createTimingPanel
  };
})();
