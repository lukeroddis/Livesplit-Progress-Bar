/**
 * src/core/storage.js - Safe Storage & State Persistence Module
 * 
 * Provides resilient LocalStorage access with in-memory fallback for
 * sandboxed OBS Studio Browser Sources and handles run state persistence.
 */

(function () {
  "use strict";

  // Centralized LocalStorage keys
  const STORAGE_KEYS = {
    IN_RUN_STATE: "livesplit_in_run_state",
    HUD_LAYOUT: "livesplit_hud_layout",
    TRACK_STYLE: "livesplit_track_style",
    PROFILES_INDEX: "livesplit_profiles_index",
    ACTIVE_PROFILE: "livesplit_active_profile",
    PROFILE_PREFIX: "livesplit_profile_",
    CUSTOM_LOGO: "livesplit_custom_logo",
    TIMER_ANCHOR: "livesplit_timer_anchor",
    ENABLE_GOLDS: "livesplit_enable_golds",
    VISIBLE_SPLITS: "livesplit_visible_splits",
    ALWAYS_SHOW_LAST: "livesplit_always_show_last_split",
    SPLIT_ANGLE: "livesplit_split_angle",
    GHOST_COMPARISON: "livesplit_ghost_comparison",
    ACTIVE_GHOSTS: "livesplit_active_ghosts",
    GHOST_OPACITY: "livesplit_ghost_opacity",
    BG_OPACITY: "livesplit_bg_opacity",
    BG_BLUR: "livesplit_bg_blur",
    BG_TARGETS: "livesplit_bg_targets",
    SETTINGS_POS: "livesplit_settings_pos",
    TIMER_DISPLAY_MODE: "livesplit_timer_display_mode",
    TIMING_METHOD: "livesplit_timing_method",
    TIMING_METHOD_MANUAL: "livesplit_timing_method_manual",
    DISCARD_GOLD_ON_RESET: "livesplit_discard_gold_on_reset",
    CACHED_SPLITS: "livesplit_cached_splits",
    GAME_NAME: "livesplit_game",
    CATEGORY_NAME: "livesplit_category",
    DEV_MODE: "livesplit_dev_mode"
  };

  // Safe storage wrapper providing in-memory fallback if localStorage is disabled or restricted
  // (e.g. sandboxed OBS Studio CEF Browser Sources, private browsing, or QuotaExceededError)
  const memoryStorage = {};
  const safeStorage = {
    getItem(key) {
      try {
        const val = localStorage.getItem(key);
        return val !== null ? val : (memoryStorage[key] !== undefined ? memoryStorage[key] : null);
      } catch (e) {
        return memoryStorage[key] !== undefined ? memoryStorage[key] : null;
      }
    },
    setItem(key, value) {
      const str = String(value);
      memoryStorage[key] = str;
      try {
        localStorage.setItem(key, str);
      } catch (e) {
        console.warn(`[safeStorage] localStorage unavailable, using in-memory fallback for "${key}"`, e);
      }
    },
    removeItem(key) {
      delete memoryStorage[key];
      try {
        localStorage.removeItem(key);
      } catch (e) {
        // ignore
      }
    }
  };

  const IN_RUN_STATE_KEY = STORAGE_KEYS.IN_RUN_STATE;

  /**
   * Persists active run progress into storage to survive accidental page reloads.
   * @param {Object} state - State snapshot to save
   */
  function saveInRunState(state) {
    try {
      if (!state) return;
      safeStorage.setItem(IN_RUN_STATE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("Failed to persist in-run state:", e);
    }
  }

  /**
   * Clears saved in-run state upon timer reset or new run start.
   */
  function clearInRunState() {
    try {
      safeStorage.removeItem(IN_RUN_STATE_KEY);
      const rtaEl = document.getElementById("timer-rta");
      const igtEl = document.getElementById("timer-igt");
      if (rtaEl) rtaEl.innerText = "0.00";
      if (igtEl) igtEl.innerText = "0.00";
    } catch (e) {
      console.warn("Failed to clear in-run state:", e);
    }
  }

  /**
   * Loads persisted in-run state if valid for current splits setup.
   * @param {Array} splitsList - Current list of splits
   * @returns {Object|null} Parsed state or null
   */
  function loadInRunState(splitsList) {
    try {
      const raw = safeStorage.getItem(IN_RUN_STATE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.splitsCount === "number" && Array.isArray(splitsList) && splitsList.length > 0 && parsed.splitsCount !== splitsList.length) {
          clearInRunState();
          return null;
        }
        const curGame = safeStorage.getItem(STORAGE_KEYS.GAME_NAME) || "";
        const curCat = safeStorage.getItem(STORAGE_KEYS.CATEGORY_NAME) || "";
        if (parsed.game && curGame && parsed.game !== curGame) {
          clearInRunState();
          return null;
        }
        if (parsed.category && curCat && parsed.category !== curCat) {
          clearInRunState();
          return null;
        }
        return parsed;
      }
    } catch (e) {
      console.warn("Failed to load in-run state:", e);
    }
    return null;
  }

  // Export to namespace and window
  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.Storage = {
    KEYS: STORAGE_KEYS,
    safeStorage,
    IN_RUN_STATE_KEY,
    saveInRunState,
    clearInRunState,
    loadInRunState
  };

  // Backward compatibility exports
  window.safeStorage = safeStorage;
  window.saveInRunState = saveInRunState;
  window.clearInRunState = clearInRunState;
  window.loadInRunState = loadInRunState;
})();
