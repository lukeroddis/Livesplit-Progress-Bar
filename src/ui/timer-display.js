/**
 * src/ui/timer-display.js - Timer Display Hierarchy & Milestone Controller
 * 
 * Manages timer HUD presentation:
 * - Single vs dual timer display hierarchy (GameTime only, RealTime only, or Both)
 * - Primary vs secondary timer prominence based on focused timing method
 * - Timing method badge styling ("Time: Game", "Time: Real", "Time: Both (Game/Real)")
 * - 4-state timing mode cycling (GameTime -> RealTime -> Both/Game -> Both/Real)
 * - Modal segmented control synchronization
 * - Time formatters delegation via LiveSplit.Time
 */

(function () {
  "use strict";

  /**
   * Updates the timing method HUD badge element with text and accent color.
   * @param {string} displayMode - 'gametime' | 'realtime' | 'both'
   * @param {string} timingMethod - 'GameTime' | 'RealTime'
   * @returns {HTMLElement|null} Badge element or null
   */
  function updateTimingMethodBadge(displayMode, timingMethod) {
    const badge = document.getElementById("timing-method-badge");
    if (!badge) return null;

    if (displayMode === "gametime") {
      badge.innerText = "Time: Game";
      badge.style.color = "#38bdf8";
    } else if (displayMode === "realtime") {
      badge.innerText = "Time: Real";
      badge.style.color = "#a78bfa";
    } else {
      // Both timers visible
      if (timingMethod === "GameTime") {
        badge.innerText = "Time: Both (Game)";
        badge.style.color = "#38bdf8";
      } else {
        badge.innerText = "Time: Both (Real)";
        badge.style.color = "#a78bfa";
      }
    }
    return badge;
  }

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

  /**
   * Synchronizes quick settings modal controls to match active timer display state.
   * @param {string} displayMode - 'gametime' | 'realtime' | 'both'
   * @param {string} timingMethod - 'GameTime' | 'RealTime'
   */
  function syncModalControls(displayMode, timingMethod) {
    document.querySelectorAll("#ctrl-timer-display .seg-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-val") === displayMode);
    });
    document.querySelectorAll("#ctrl-timer-focus .seg-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-val") === timingMethod);
    });
    const rowTimerFocus = document.getElementById("row-timer-focus");
    if (rowTimerFocus) {
      rowTimerFocus.style.display = (displayMode === "both") ? "flex" : "none";
    }
  }

  // Export to namespace
  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.TimerDisplay = {
    updateTimingMethodBadge,
    updateTimerDisplayHierarchy,
    calculateNextTimingMode,
    syncModalControls
  };

})();
