/**
 * src/ui/toast-manager.js - HUD Toast Notification Controller
 * 
 * Manages transient HUD toast notifications:
 * - Active comparison change toasts (e.g. "⚖️ Comparison: PB")
 * - Developer mode toggle alerts (e.g. "🛠️ Developer Mode: Enabled")
 * - Safe HTML sanitization via LiveSplit.DOMUtils
 * - Automatic timeout clearing and smooth CSS animations
 */

(function () {
  "use strict";

  let toastTimer = null;

  /**
   * Retrieves or dynamically creates the #hud-toast DOM element.
   * @returns {HTMLElement} Toast DOM element
   */
  function getToastElement() {
    let toast = document.getElementById("hud-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "hud-toast";
      toast.className = "hud-toast";
      document.body.appendChild(toast);
    }
    return toast;
  }

  /**
   * Displays formatted HTML markup in the HUD toast banner for a set duration.
   * @param {string} htmlMarkup - HTML content string
   * @param {number} [durationMs=2200] - Duration in ms before dismissing toast
   * @returns {HTMLElement} Toast element
   */
  function showToast(htmlMarkup, durationMs = 2200) {
    const toast = getToastElement();
    toast.style.display = "";
    toast.innerHTML = htmlMarkup;
    toast.classList.add("show");

    if (toastTimer) {
      clearTimeout(toastTimer);
    }
    toastTimer = setTimeout(() => {
      toast.classList.remove("show");
      toastTimer = null;
    }, durationMs);

    return toast;
  }

  /**
   * Hides the active toast immediately and cancels any pending dismiss timer.
   */
  function hideToast() {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    const toast = document.getElementById("hud-toast");
    if (toast) {
      toast.classList.remove("show");
    }
  }

  /**
   * Displays comparison change toast notification.
   * @param {string} compName - Active comparison name
   * @param {number} [durationMs=1800] - Display duration in ms
   * @returns {HTMLElement|null} Toast element or null if no compName
   */
  function showComparisonToast(compName, durationMs = 1800) {
    if (!compName) return null;
    const markup = `<span style="color: #38bdf8;">⚖️ Comparison:</span> <span>${window.LiveSplit.DOMUtils.escapeHtml(compName)}</span>`;
    return showToast(markup, durationMs);
  }

  /**
   * Displays developer mode toggle toast notification.
   * @param {boolean} enabled - Whether developer mode was enabled or disabled
   * @param {number} [durationMs=2200] - Display duration in ms
   * @returns {HTMLElement} Toast element
   */
  function showDevModeToast(enabled, durationMs = 2200) {
    const markup = enabled
      ? `<span style="color: #f59e0b;">🛠️ Developer Mode:</span> <span>Enabled (Test Race &amp; WS Logs visible)</span>`
      : `<span style="color: #94a3b8;">🛠️ Developer Mode:</span> <span>Disabled (Production view)</span>`;
    return showToast(markup, durationMs);
  }

  // Export to namespace
  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.ToastManager = {
    getToastElement,
    showToast,
    hideToast,
    showComparisonToast,
    showDevModeToast
  };

})();
