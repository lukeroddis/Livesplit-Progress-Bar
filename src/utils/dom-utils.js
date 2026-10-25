/**
 * src/utils/dom-utils.js - Shared DOM Sanitization & Security Utilities
 * 
 * Centralizes HTML entity escaping, safe URL scheme validation, and
 * standardized racer avatar HTML construction across the LiveSplit overlay HUD.
 */

(function () {
  "use strict";

  /**
   * Safely escapes HTML special characters to prevent Cross-Site Scripting (XSS).
   * @param {*} str - Input value to escape
   * @returns {string} Sanitized HTML-safe string
   */
  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/[\x22]/g, "&quot;")
      .replace(/[\x27]/g, "&#039;");
  }

  /**
   * Validates whether a URL or image URI uses a safe protocol scheme.
   * Allows: https://, http://, data:image/
   * Rejects: javascript:, data:text/html, vbscript:, file:, etc.
   * @param {string} url - Candidate URL string
   * @returns {boolean} True if protocol is safe
   */
  function isSafeUrl(url) {
    if (typeof url !== "string") return false;
    const trimmed = url.trim().toLowerCase();
    return (
      trimmed.startsWith("https://") ||
      trimmed.startsWith("http://") ||
      trimmed.startsWith("data:image/")
    );
  }

  /**
   * Alias for avatar URL validation.
   * @param {string} rawAvatar
   * @returns {boolean}
   */
  function isSafeAvatarUrl(rawAvatar) {
    return isSafeUrl(rawAvatar);
  }

  /**
   * Builds standardized, sanitized avatar HTML markup.
   * If raw is a safe remote or data URL, renders an <img> element with escaped src.
   * Otherwise, renders an emoji badge with fallback icon.
   * 
   * @param {string} raw - Avatar URL or emoji
   * @param {string} [fallback="🏎️"] - Fallback emoji icon
   * @param {Object} [options={}] - Custom class names or wrapper options
   * @param {string} [options.imgClass="racer-avatar-img"] - CSS class for img tag
   * @param {string} [options.emojiClass="racer-avatar-emoji"] - CSS class for emoji badge
   * @returns {string} Sanitized HTML string
   */
  function buildAvatarMarkup(raw, fallback, options) {
    const opts = options || {};
    const imgClass = opts.imgClass || "racer-avatar-img";
    const emojiClass = opts.emojiClass || "racer-avatar-emoji";
    const fallbackIcon = fallback || "🏎️";

    if (isSafeUrl(raw)) {
      return `<img class="${escapeHtml(imgClass)}" src="${escapeHtml(raw)}" alt="" />`;
    }

    const isLikelyUrl = typeof raw === "string" && (raw.includes(":") || raw.includes("/"));
    const displayEmoji = (raw && !isLikelyUrl) ? raw : fallbackIcon;
    return `<span class="${escapeHtml(emojiClass)}">${escapeHtml(displayEmoji)}</span>`;
  }

  // Export on window.LiveSplit namespace
  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.DOMUtils = {
    escapeHtml,
    isSafeUrl,
    isSafeAvatarUrl,
    buildAvatarMarkup
  };

  // Global backward-compatibility alias
  if (typeof window.escapeHtml !== "function") {
    window.escapeHtml = escapeHtml;
  }
})();
