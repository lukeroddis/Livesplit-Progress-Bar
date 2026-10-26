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
    const overlay = window.LiveSplit.Overlay;
    if (!selComp || !overlay.getComparisonsList) return;
    const curComp = overlay.getCurrentComparison?.() ?? "Personal Best";
    selComp.innerHTML = "";
    overlay.getComparisonsList().forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.innerText = COMPARISON_LABELS[c] || c;
      if (c === curComp) opt.selected = true;
      selComp.appendChild(opt);
    });
  }

  function syncTimerControls() {
    const curTimerMode = window.LiveSplit.Overlay.getTimerDisplayMode?.()
      ?? (localStorage.getItem(STORAGE_KEYS.TIMER_DISPLAY_MODE) || "both");
    C.syncSegmented("#ctrl-timer-display", curTimerMode);

    const curFocus = window.LiveSplit.Overlay.getCurrentTimingMethod?.()
      ?? (localStorage.getItem(STORAGE_KEYS.TIMING_METHOD) || "GameTime");
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
        window.LiveSplit.Overlay.applyActiveComparison?.(e.target.value, true);
      });

      C.bindSegmented("#ctrl-timer-display", (val) => {
        window.LiveSplit.Overlay.setTimerDisplayMode?.(val);
      });

      C.bindSegmented("#ctrl-timer-focus", (val) => {
        if (typeof window === "undefined") return;
        const overlay = window.LiveSplit.Overlay;
        if (overlay.setTimingMethodFocus) {
          overlay.setTimingMethodFocus(val);
        } else {
          overlay.applyActiveTimingMethod?.(val);
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
