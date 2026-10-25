/**
 * src/ui/layout-engine.js - HUD Component Ids
 *
 * Single owner of the HUD component id list. Default coordinates live in
 * layout.js (getDefaultLayout); timer anchor resolution lives in timer-anchor.js.
 */

(function () {
  "use strict";

  // HUD component ids, in layout order (layout.js and profiles read this list)
  const COMPONENTS = Object.freeze(["title", "timers", "track", "leaderboard"]);

  // Export to namespace
  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.LayoutEngine = {
    COMPONENTS
  };
})();
