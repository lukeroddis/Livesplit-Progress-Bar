/**
 * src/ui/interactions.js - User Interactions, Hotkeys & Scroll Mappings
 * 
 * Handles mouse wheel scroll deltas, keyboard arrow navigation,
 * comparison cycling algorithms, and input guards.
 */

(function () {
  "use strict";

  /**
   * Computes next index when cycling through comparisons list.
   * @param {number} currentIdx - Current index in comparisons array
   * @param {number} length - Total comparisons count
   * @param {boolean} [reverse=false] - Whether cycling backwards
   * @returns {number} Next index
   */
  function getNextComparisonIndex(currentIdx, length, reverse = false) {
    if (length <= 0) return 0;
    if (reverse) {
      return (currentIdx - 1 + length) % length;
    }
    return (currentIdx + 1) % length;
  }

  /**
   * Normalizes keyboard arrow keys to scroll direction deltas.
   * Left / Up: scroll backward (-1)
   * Right / Down: scroll forward (+1)
   */
  function getArrowKeyDelta(key, isVertical = false) {
    if (isVertical) {
      if (key === "ArrowUp") return -1;
      if (key === "ArrowDown") return 1;
    } else {
      if (key === "ArrowLeft") return -1;
      if (key === "ArrowRight") return 1;
    }
    return 0;
  }

  /**
   * Guards against processing hotkeys when user is typing in interactive form elements.
   */
  function isInteractiveInputElement(target) {
    if (!target) return false;
    const tagName = target.tagName;
    return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || target.isContentEditable;
  }

  // Export to namespace
  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.Interactions = {
    getNextComparisonIndex,
    getArrowKeyDelta,
    isInteractiveInputElement
  };
})();
