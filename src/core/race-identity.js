/**
 * src/core/race-identity.js - therun.gg Username & Race Code Validation
 *
 * Strict validators for user-entered therun.gg identities. Both reject URLs,
 * slashes, colons and script characters so pasted links never reach request
 * URLs or overwrite the stored username.
 */

(function () {
  "use strict";

  const STORAGE_KEYS = window.LiveSplit.Storage.KEYS;

  /**
   * Validates that a string is a safe, strict username (alphanumeric, underscore, hyphen; no URLs or path/script chars).
   */
  function isValidUsername(str) {
    if (!str || typeof str !== "string") return false;
    const s = str.trim();
    if (!s || s.length > 50) return false;
    return /^[a-zA-Z0-9_-]+$/.test(s);
  }

  /**
   * Validates that a string is a safe, strict therun.gg race room code (alphanumeric/underscore/hyphen; no URLs, slashes, or colons).
   */
  function isValidRaceCode(str) {
    if (!str || typeof str !== "string") return false;
    const s = str.trim();
    if (s.length < 2 || s.length > 24) return false;
    return /^[a-zA-Z0-9_-]+$/.test(s);
  }

  /**
   * Validates and normalizes a strict race room code (e.g. "tzsm" or "f0ub"). Rejects URLs or unsafe strings.
   * @returns {string|null}
   */
  function parseRaceId(input) {
    if (!input || typeof input !== "string") return null;
    const trimmed = input.trim();
    return isValidRaceCode(trimmed) ? trimmed : null;
  }

  /**
   * Safely loads the stored therun username, discarding (and clearing) an invalid value.
   */
  function loadStoredUsername() {
    try {
      if (typeof localStorage !== "undefined") {
        const val = (localStorage.getItem(STORAGE_KEYS.THERUN_USERNAME) || "").trim();
        if (!isValidUsername(val)) {
          if (val) localStorage.removeItem(STORAGE_KEYS.THERUN_USERNAME);
          return "";
        }
        return val;
      }
    } catch (_) {}
    return "";
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.RaceIdentity = {
    isValidUsername,
    isValidRaceCode,
    parseRaceId,
    loadStoredUsername
  };
})();
