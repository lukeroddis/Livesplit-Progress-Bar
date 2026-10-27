/**
 * Speedrun Overlay - Timer Anchor & Auto-Expansion Controller
 *
 * Encapsulates:
 * - Intelligent timer anchor modes ("auto", "right", "left")
 * - Dynamic expansion orientation based on viewport positioning (expanding right vs left)
 * - HUD timer header badge toggle & tooltip synchronization
 * - Settings modal segmented control synchronization
 * - LocalStorage persistence and layout component coordinate recalculation
 */

(function () {
  "use strict";

  const STORAGE_KEYS = window.LiveSplit.Storage.KEYS;

  const DEFAULT_STORAGE_KEY = STORAGE_KEYS.TIMER_ANCHOR;

  function createTimerAnchor(options = {}) {
    const {
      getLayoutState = () => null,
      getDefaultLayout = () => ({ timers: { x: 0, y: 0, scale: 1, anchor: "auto" } }),
      saveLayout = () => {},
      applyComponentLayout = () => {},
      storageKey = DEFAULT_STORAGE_KEY
    } = options;

    function getAnchor() {
      const state = getLayoutState();
      return (state && state.timers && state.timers.anchor) ||
        localStorage.getItem(storageKey) ||
        "auto";
    }

    function resolveIsRight(stateX, compWidth, viewportWidth) {
      const anchorPref = getAnchor();
      if (anchorPref === "right") return true;
      if (anchorPref === "left") return false;
      const w = viewportWidth || (typeof window !== "undefined" ? window.innerWidth : 1920);
      const midPoint = (stateX || 0) + ((compWidth || 300) / 2);
      return midPoint > (w / 2);
    }

    function setAnchor(anchor) {
      if (anchor !== "auto" && anchor !== "right" && anchor !== "left") return;

      const layoutState = getLayoutState();
      if (layoutState) {
        if (!layoutState.timers) layoutState.timers = getDefaultLayout().timers;
        layoutState.timers.anchor = anchor;

        const w = (typeof window !== "undefined" && window.innerWidth) || 1920;
        const el = document.getElementById("hud-comp-timers");
        const compWidth = el ? el.offsetWidth : 300;

        if (anchor === "right") {
          layoutState.timers.right = Math.max(0, w - (layoutState.timers.x + compWidth));
        } else if (anchor === "left") {
          delete layoutState.timers.right;
        }
      }

      try {
        localStorage.setItem(storageKey, anchor);
      } catch (e) {
        console.warn("Failed to save timer anchor to localStorage", e);
      }

      applyComponentLayout("timers");
      saveLayout();
      syncUI();
    }

    function cycleAnchor() {
      const cur = getAnchor();
      const next = (cur === "auto") ? "right" : (cur === "right" ? "left" : "auto");
      setAnchor(next);
      return next;
    }

    function syncUI() {
      const cur = getAnchor();

      const segBtns = document.querySelectorAll("#ctrl-timer-expansion .seg-btn");
      segBtns.forEach((btn) => {
        btn.classList.toggle("active", btn.getAttribute("data-val") === cur);
      });

      const badge = document.getElementById("badge-anchor-timers");
      if (badge) {
        if (cur === "right") {
          badge.innerText = "⇤ Exp Left";
          badge.title = "Timer Expansion: Forced Expand Left (anchored to right edge). Click to cycle.";
        } else if (cur === "left") {
          badge.innerText = "⇥ Exp Right";
          badge.title = "Timer Expansion: Forced Expand Right (anchored to left edge). Click to cycle.";
        } else {
          const w = (typeof window !== "undefined" && window.innerWidth) || 1920;
          const layoutState = getLayoutState();
          const x = (layoutState && layoutState.timers && layoutState.timers.x) || 0;
          const el = document.getElementById("hud-comp-timers");
          const compWidth = el ? el.offsetWidth : 300;
          const isRight = (x + compWidth / 2) > (w / 2);
          badge.innerText = isRight ? "⇤ Auto (L)" : "⇥ Auto (R)";
          badge.title = `Timer Expansion: Auto (${isRight ? "expanding left" : "expanding right"}). Click to cycle.`;
        }
      }
    }

    function bindEvents() {
      const segBtns = document.querySelectorAll("#ctrl-timer-expansion .seg-btn");
      segBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
          const val = btn.getAttribute("data-val");
          if (val) setAnchor(val);
        });
      });

      const badge = document.getElementById("badge-anchor-timers");
      if (badge) {
        badge.addEventListener("click", (e) => {
          e.stopPropagation();
          cycleAnchor();
        });
      }
    }

    return {
      STORAGE_KEY: storageKey,
      getAnchor,
      setAnchor,
      cycleAnchor,
      resolveIsRight,
      syncUI,
      bindEvents
    };
  }

  // Global namespace export
  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.TimerAnchor = {
    DEFAULT_STORAGE_KEY,
    createTimerAnchor
  };
})();
