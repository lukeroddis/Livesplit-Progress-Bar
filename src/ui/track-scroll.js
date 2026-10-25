/**
 * src/ui/track-scroll.js - Track Wheel & Arrow Key Scrolling
 *
 * Scrolls the split track (or shifts the windowed track) from the mouse wheel
 * and arrow keys, consistent with LiveSplit. Ignored in Edit Mode, over
 * settings/modals/inputs, and while a modal is open.
 */

(function () {
  "use strict";

  function isEditModeActive() {
    return document.body.classList.contains("edit-mode") ||
      (window.hudLayout && typeof window.hudLayout.isEditMode === "function" && window.hudLayout.isEditMode());
  }

  /**
   * @param {Object} options
   * @param {Function} options.isTrackWindowed - True when the track uses the sliding window instead of native scroll
   * @param {Function} options.shiftTrackWindow - Shifts the sliding window by +1 / -1
   */
  function setupTrackScrollInteractions(options = {}) {
    const {
      isTrackWindowed = () => false,
      shiftTrackWindow = () => {}
    } = options;

    const viewport = document.getElementById("track-viewport");
    if (!viewport) return;

    // 1. Mouse Wheel Scrolling (consistent with LiveSplit)
    // When rolling the scroll wheel over the progress track or window background (and not in Edit Mode),
    // scroll the split track horizontally (or vertically if sidebar).
    window.addEventListener("wheel", (e) => {
      if (isEditModeActive()) return;

      // Ignore wheel if cursor is over interactive cards/modals/inputs/dropdowns
      if (e.target && typeof e.target.closest === "function" && e.target.closest("#footer-bar, .modal-backdrop, .layout-toolbar, .settings-profile-dropdown-wrap, input, textarea, select")) {
        return;
      }

      const track = document.getElementById("track");
      if (!track) return;
      const isVertical = track.classList.contains("vertical");

      let delta = 0;
      if (isVertical) {
        delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      } else {
        // In horizontal track, both horizontal scroll (deltaX) and vertical mouse wheel (deltaY) scroll left/right
        delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      }

      if (e.deltaMode === 1) { // DOM_DELTA_LINE
        delta *= 32;
      } else if (e.deltaMode === 2) { // DOM_DELTA_PAGE
        delta *= (isVertical ? viewport.clientHeight : viewport.clientWidth);
      }

      if (delta !== 0) {
        if (isTrackWindowed()) {
          shiftTrackWindow(delta > 0 ? 1 : -1);
        } else if (isVertical) {
          viewport.scrollTop += delta;
        } else {
          viewport.scrollLeft += delta;
        }
        e.preventDefault();
      }
    }, { passive: false });

    // 2. Keyboard Arrow Key Scrolling (Left/Right in horizontal, Up/Down in vertical)
    window.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
      if (isEditModeActive()) return;

      const openModal = document.querySelector(".modal-backdrop.is-open");
      if (openModal) return;

      const track = document.getElementById("track");
      if (!track) return;
      const isVertical = track.classList.contains("vertical");

      let direction = 0;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") direction = 1;
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") direction = -1;
      if (direction === 0) return;

      if (isTrackWindowed()) {
        shiftTrackWindow(direction);
      } else if (isVertical) {
        viewport.scrollTop += direction * 80;
      } else {
        viewport.scrollLeft += direction * 100;
      }
      e.preventDefault();
    });
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.TrackScroll = {
    setupTrackScrollInteractions
  };
})();
