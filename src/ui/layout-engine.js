/**
 * src/ui/layout-engine.js - Layout Configuration, Profile Schema & Anchor Engine
 * 
 * Defines HUD component coordinate geometry, profile persistence schema,
 * and timer expansion anchor algorithms (Auto, Left, Right).
 */

(function () {
  "use strict";

  const COMPONENTS = ["title", "timers", "track"];

  const DEFAULT_TRACK_STYLE = {
    orientation: "horizontal", // 'horizontal' | 'vertical'
    namePos: "top",        // 'top' | 'bottom' | 'left' | 'right'
    deltaPos: "bottom",    // 'top' | 'bottom' | 'left' | 'right'
    nameFontSize: 17,      // px
    deltaFontSize: 15,     // px
    barHeight: 6,          // px
    dotSize: 15,           // px
    ghostPinLength: 16,    // px (0 to 36)
    bgOpacity: 55,         // % (0 to 95)
    bgBlur: 8,             // px (0 to 20)
    bgTitle: true,         // boolean
    bgTimers: true,        // boolean
    bgTrack: true,         // boolean
    logoHeight: 60         // px (25 to 140)
  };

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
    DEFAULT_TRACK_STYLE,
    getDefaultLayout,
    resolveTimerAnchor
  };
})();
