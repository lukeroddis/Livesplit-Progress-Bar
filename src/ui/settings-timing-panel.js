/**
 * src/ui/settings-timing-panel.js - Timing & Comparison Settings Panel
 *
 * LiveSplit hotkey sync and discard-golds-on-reset checkboxes. The comparison,
 * visible timers and primary timer are registry settings (settings-dialog-rows.js).
 */

(function () {
  "use strict";

  const STORAGE_KEYS = window.LiveSplit.Storage.KEYS;
  const C = window.LiveSplit.SettingsControls;

  function createTimingPanel() {
    function sync() {
      C.syncStorageCheckbox("cb-discard-golds-reset", STORAGE_KEYS.DISCARD_GOLDS_ON_RESET);
      C.syncStorageCheckbox("cb-sync-livesplit-hotkeys", STORAGE_KEYS.SYNC_HOTKEYS);
    }

    function bind() {
      C.bindStorageCheckbox("cb-discard-golds-reset", STORAGE_KEYS.DISCARD_GOLDS_ON_RESET);
      C.bindStorageCheckbox("cb-sync-livesplit-hotkeys", STORAGE_KEYS.SYNC_HOTKEYS);

    }

    return { sync, bind };
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.SettingsTimingPanel = {
    createTimingPanel
  };
})();
