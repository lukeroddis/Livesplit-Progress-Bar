/**
 * src/ui/timer-display.js - Timer Display Hierarchy & Milestone Controller
 * 
 * Manages timer HUD presentation:
 * - Single vs dual timer display hierarchy (GameTime only, RealTime only, or Both)
 * - Primary vs secondary timer prominence based on focused timing method
 * - 4-state timing mode cycling (GameTime -> RealTime -> Both/Game -> Both/Real)
 * - Time formatters delegation via LiveSplit.Time
 */

(function () {
  "use strict";

  /**
   * Updates CSS display hierarchy for primary and secondary timers.
   * @param {string} displayMode - 'gametime' | 'realtime' | 'both'
   * @param {string} timingMethod - 'GameTime' | 'RealTime'
   * @returns {Object|null} State summary or null if elements not found
   */
  function updateTimerDisplayHierarchy(displayMode, timingMethod) {
    const rtaEl = document.getElementById("timer-rta");
    const igtEl = document.getElementById("timer-igt");
    const rtaBlock = document.getElementById("block-rta");
    const igtBlock = document.getElementById("block-igt");
    if (!rtaEl || !igtEl || !rtaBlock || !igtBlock) return null;

    const mode = displayMode || "both";

    if (mode === "gametime") {
      igtBlock.style.display = "flex";
      rtaBlock.style.display = "none";
      igtEl.className = "timer-primary";
      rtaEl.className = "timer-secondary";
    } else if (mode === "realtime") {
      rtaBlock.style.display = "flex";
      igtBlock.style.display = "none";
      rtaEl.className = "timer-primary";
      igtEl.className = "timer-secondary";
    } else {
      // Both timers visible
      rtaBlock.style.display = "flex";
      igtBlock.style.display = "flex";
      const isRT = timingMethod === "RealTime";
      if (isRT) {
        rtaEl.className = "timer-primary";
        igtEl.className = "timer-secondary";
      } else {
        igtEl.className = "timer-primary";
        rtaEl.className = "timer-secondary";
      }
    }

    return {
      mode,
      rtaDisplay: rtaBlock.style.display,
      igtDisplay: igtBlock.style.display,
      rtaClass: rtaEl.className,
      igtClass: igtEl.className
    };
  }

  /**
   * Calculates the next logical display mode and timing method focus when toggling.
   * Cycles through 4 states:
   * 1. Time: Game (IGT only)
   * 2. Time: Real (RTA only)
   * 3. Time: Both (Game primary)
   * 4. Time: Both (Real primary)
   * 
   * @param {string} currentMode - 'gametime' | 'realtime' | 'both'
   * @param {string} currentMethod - 'GameTime' | 'RealTime'
   * @returns {{ mode: string, focusMethod: string }}
   */
  function calculateNextTimingMode(currentMode, currentMethod) {
    if (currentMode === "gametime") {
      return { mode: "realtime", focusMethod: "RealTime" };
    } else if (currentMode === "realtime") {
      return { mode: "both", focusMethod: "GameTime" };
    } else if (currentMode === "both" && currentMethod === "GameTime") {
      return { mode: "both", focusMethod: "RealTime" };
    } else {
      return { mode: "gametime", focusMethod: "GameTime" };
    }
  }

  // Export to namespace
  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.TimerDisplay = {
    updateTimerDisplayHierarchy,
    calculateNextTimingMode
  };

})();
