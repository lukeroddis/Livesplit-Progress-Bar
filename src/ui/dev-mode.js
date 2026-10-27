/**
 * src/ui/dev-mode.js - Developer & Diagnostics Mode (Feature Gating)
 *
 * Toggles the body.dev-mode class that reveals the Test Race and WS log tools.
 * - Enabled by ?debug / ?dev query params or the persisted livesplit_dev_mode flag
 * - Ctrl/Cmd + Shift + D hotkey
 * - 5 clicks on the #overlay-version label
 */

(function () {
  "use strict";

  const STORAGE_KEYS = window.LiveSplit.Storage.KEYS;

  const DEV_MODE_KEY = STORAGE_KEYS.DEV_MODE;
  let isDevMode = false;

  function isDevModeActive() {
    return isDevMode;
  }

  function setDevMode(enabled, save = true) {
    isDevMode = !!enabled;
    if (isDevMode) {
      document.body.classList.add("dev-mode");
    } else {
      document.body.classList.remove("dev-mode");
    }
    if (save) {
      try {
        window.LiveSplit.Storage.safeStorage.setItem(DEV_MODE_KEY, isDevMode ? "true" : "false");
      } catch (e) {
        // ignore
      }
    }
  }

  function toggleDevMode() {
    setDevMode(!isDevMode, true);
    window.LiveSplit.ToastManager.showDevModeToast(isDevMode);
    return isDevMode;
  }

  function initDevMode() {
    let queryDev = false;
    try {
      const urlParams = new URLSearchParams(window.location.search);
      queryDev = urlParams.has("debug") || urlParams.has("dev");
    } catch (e) {
      queryDev = false;
    }

    let storedDev = false;
    try {
      storedDev = (window.LiveSplit.Storage.safeStorage.getItem(DEV_MODE_KEY) === "true");
    } catch (e) {
      storedDev = false;
    }

    setDevMode(queryDev || storedDev, false);

    // Keyboard hotkey: Ctrl + Shift + D (or Cmd + Shift + D on macOS)
    window.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        toggleDevMode();
      }
    });

    // Settings footer version label 5-click easter egg
    const verEl = document.getElementById("overlay-version");
    if (verEl) {
      verEl.style.cursor = "pointer";
      let verClicks = 0;
      let verTimer = null;
      verEl.addEventListener("click", () => {
        verClicks++;
        if (verTimer) clearTimeout(verTimer);
        verTimer = setTimeout(() => { verClicks = 0; }, 2500);
        if (verClicks >= 5) {
          verClicks = 0;
          toggleDevMode();
        }
      });
    }
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.DevMode = {
    isDevModeActive,
    setDevMode,
    toggleDevMode,
    initDevMode
  };
})();
