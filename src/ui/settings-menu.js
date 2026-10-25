/**
 * src/ui/settings-menu.js - Draggable Quick Settings Menu Controller
 *
 * Manages the floating LiveSplit settings panel (#footer-bar):
 * - Pointer drag via the header with viewport clamping
 * - Position persistence (livesplit_settings_pos) and double-click reset
 * - Re-clamping on window resize
 * - Open / close toggling of #quick-settings-wrap and its trigger pill
 */

(function () {
  "use strict";

  const STORAGE_KEYS = window.LiveSplit.Storage.KEYS;

  const SETTINGS_POS_KEY = STORAGE_KEYS.SETTINGS_POS;

  function resetSettingsMenuPosition() {
    const panel = document.getElementById("footer-bar");
    if (!panel) return;
    panel.style.left = "";
    panel.style.top = "";
    panel.style.right = "";
    panel.style.bottom = "";
    panel.classList.remove("is-custom-pos");
    panel.classList.remove("is-dragging");
    localStorage.removeItem(SETTINGS_POS_KEY);
  }

  function restoreSettingsMenuPosition() {
    const panel = document.getElementById("footer-bar");
    const saved = localStorage.getItem(SETTINGS_POS_KEY);
    if (saved && panel) {
      try {
        const pos = JSON.parse(saved);
        if (typeof pos.left === "number" && typeof pos.top === "number") {
          const maxLeft = Math.max(10, window.innerWidth - 480);
          const maxTop = Math.max(10, window.innerHeight - 300);
          const left = Math.max(10, Math.min(maxLeft, pos.left));
          const top = Math.max(10, Math.min(maxTop, pos.top));
          panel.style.left = `${left}px`;
          panel.style.top = `${top}px`;
          panel.style.right = "auto";
          panel.style.bottom = "auto";
          panel.classList.add("is-custom-pos");
        }
      } catch (e) {
        console.warn("Failed to parse saved settings position", e);
      }
    }
  }

  function initSettingsMenuDraggable() {
    const panel = document.getElementById("footer-bar");
    const header = document.querySelector(".settings-menu-header");
    if (!panel || !header) return;

    header.addEventListener("dblclick", (e) => {
      if (e.target.closest("button") || e.target.closest(".connection-status-pill")) return;
      resetSettingsMenuPosition();
    });

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let origLeft = 0;
    let origTop = 0;

    header.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button") || e.target.closest(".connection-status-pill")) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      isDragging = true;
      header.setPointerCapture(e.pointerId);
      header.classList.add("is-dragging");
      panel.classList.add("is-dragging");

      const rect = panel.getBoundingClientRect();
      origLeft = rect.left;
      origTop = rect.top;
      startX = e.clientX;
      startY = e.clientY;

      panel.style.left = `${origLeft}px`;
      panel.style.top = `${origTop}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panel.classList.add("is-custom-pos");
    });

    header.addEventListener("pointermove", (e) => {
      if (!isDragging) return;
      e.preventDefault();
      e.stopPropagation();

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      const panelRect = panel.getBoundingClientRect();
      const maxLeft = Math.max(10, window.innerWidth - panelRect.width - 10);
      const maxTop = Math.max(10, window.innerHeight - panelRect.height - 10);

      const newLeft = Math.round(Math.max(10, Math.min(maxLeft, origLeft + dx)));
      const newTop = Math.round(Math.max(10, Math.min(maxTop, origTop + dy)));

      panel.style.left = `${newLeft}px`;
      panel.style.top = `${newTop}px`;
    });

    const onPointerUp = (e) => {
      if (!isDragging) return;
      isDragging = false;
      header.releasePointerCapture(e.pointerId);
      header.classList.remove("is-dragging");
      panel.classList.remove("is-dragging");

      const rect = panel.getBoundingClientRect();
      localStorage.setItem(SETTINGS_POS_KEY, JSON.stringify({
        left: Math.round(rect.left),
        top: Math.round(rect.top)
      }));
    };

    header.addEventListener("pointerup", onPointerUp);
    header.addEventListener("pointercancel", onPointerUp);

    window.addEventListener("resize", () => {
      if (panel.classList.contains("is-custom-pos")) {
        const rect = panel.getBoundingClientRect();
        const maxLeft = Math.max(10, window.innerWidth - rect.width - 10);
        const maxTop = Math.max(10, window.innerHeight - rect.height - 10);
        const clampedL = Math.max(10, Math.min(maxLeft, rect.left));
        const clampedT = Math.max(10, Math.min(maxTop, rect.top));
        panel.style.left = `${clampedL}px`;
        panel.style.top = `${clampedT}px`;
      }
    });

    restoreSettingsMenuPosition();
  }

  function toggleSettingsMenu(forceOpen) {
    const quickWrap = document.getElementById("quick-settings-wrap");
    const triggerPill = document.getElementById("settings-trigger-pill");
    if (!quickWrap || !triggerPill) return;

    const isOpen = (typeof forceOpen === "boolean")
      ? forceOpen
      : !quickWrap.classList.contains("menu-open");

    if (isOpen) {
      quickWrap.classList.add("menu-open");
      triggerPill.classList.add("is-pressed");
      triggerPill.setAttribute("aria-pressed", "true");
      triggerPill.setAttribute("title", "Click to close LiveSplit Settings");
    } else {
      quickWrap.classList.remove("menu-open");
      triggerPill.classList.remove("is-pressed");
      triggerPill.setAttribute("aria-pressed", "false");
      triggerPill.setAttribute("title", "Click to open LiveSplit Settings");
    }
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.SettingsMenu = {
    resetSettingsMenuPosition,
    restoreSettingsMenuPosition,
    initSettingsMenuDraggable,
    toggleSettingsMenu
  };
})();
