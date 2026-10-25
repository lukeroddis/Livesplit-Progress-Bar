/**
 * src/ui/layout-engine.js - Layout Configuration, Profile Schema & Anchor Engine
 * 
 * Defines HUD component coordinate geometry, profile persistence schema,
 * and timer expansion anchor algorithms (Auto, Left, Right).
 */

(function () {
  "use strict";

  // HUD component ids, in layout order (layout.js and profiles read this list)
  const COMPONENTS = Object.freeze(["title", "timers", "track", "leaderboard"]);


  /**
   * Calculates initial layout coordinates scaled to screen viewport dimensions.
   */
  function getDefaultLayout() {
    const w = window.innerWidth || 1920;
    const h = window.innerHeight || 1080;

    return {
      title: {
        x: 42,
        y: 20,
        scale: 1.0,
        visible: true,
        docked: "none"
      },
      timers: {
        x: Math.max(42, w - 460),
        y: 20,
        scale: 1.0,
        visible: true,
        docked: "none",
        anchor: "auto"
      },
      track: {
        x: 0,
        y: Math.max(0, h - 90),
        scale: 1.0,
        visible: true,
        docked: "bottom"
      },
      leaderboard: {
        x: 42,
        y: 110,
        scale: 1.0,
        visible: true,
        docked: "none"
      }
    };
  }

  /**
   * Determines effective anchor direction ('left' or 'right') for timer expansion.
   * @param {string} anchorPref - 'auto' | 'left' | 'right'
   * @param {number} compX - Current X coordinate
   * @param {number} compWidth - Rendered component width
   * @param {number} viewportWidth - Window width
   * @returns {string} 'left' or 'right'
   */
  function resolveTimerAnchor(anchorPref, compX, compWidth, viewportWidth) {
    if (anchorPref === "right") return "right";
    if (anchorPref === "left") return "left";
    // Auto anchor: If center is in right half of screen, anchor right to expand left
    const midPoint = compX + (compWidth / 2);
    return midPoint > (viewportWidth / 2) ? "right" : "left";
  }

  // Export to namespace
  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.LayoutEngine = {
    COMPONENTS,
    getDefaultLayout,
    resolveTimerAnchor
  };
})();
