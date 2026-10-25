/**
 * tests/unit/ui/timer-display.test.js
 * Unit tests for LiveSplit.TimerDisplay hierarchy and milestone controller
 */

(function () {
  "use strict";

  describe("Timer Display Controller: LiveSplit.TimerDisplay", () => {
    it("exports complete public API on window.LiveSplit.TimerDisplay", () => {
      const td = window.LiveSplit && window.LiveSplit.TimerDisplay;
      assert(td !== undefined && td !== null, "TimerDisplay is exposed on window.LiveSplit");
      assertEqual(typeof td.updateTimingMethodBadge, "function", "updateTimingMethodBadge is a function");
      assertEqual(typeof td.updateTimerDisplayHierarchy, "function", "updateTimerDisplayHierarchy is a function");
      assertEqual(typeof td.calculateNextTimingMode, "function", "calculateNextTimingMode is a function");
      assertEqual(typeof td.syncModalControls, "function", "syncModalControls is a function");
    });

    it("updateTimingMethodBadge updates text and accent color for each mode", () => {
      const td = window.LiveSplit.TimerDisplay;

      // GameTime only
      td.updateTimingMethodBadge("gametime", "GameTime");
      const badge = document.getElementById("timing-method-badge");
      assertEqual(badge.innerText, "Time: Game");

      // RealTime only
      td.updateTimingMethodBadge("realtime", "RealTime");
      assertEqual(badge.innerText, "Time: Real");

      // Both timers: GameTime focused
      td.updateTimingMethodBadge("both", "GameTime");
      assertEqual(badge.innerText, "Time: Both (Game)");

      // Both timers: RealTime focused
      td.updateTimingMethodBadge("both", "RealTime");
      assertEqual(badge.innerText, "Time: Both (Real)");
    });

    it("updateTimerDisplayHierarchy toggles block visibility and primary/secondary classes", () => {
      const td = window.LiveSplit.TimerDisplay;
      const rtaBlock = document.getElementById("block-rta");
      const igtBlock = document.getElementById("block-igt");
      const rtaEl = document.getElementById("timer-rta");
      const igtEl = document.getElementById("timer-igt");

      // 1. gametime mode: IGT flex, RTA none
      td.updateTimerDisplayHierarchy("gametime", "GameTime");
      assertEqual(igtBlock.style.display, "flex");
      assertEqual(rtaBlock.style.display, "none");
      assertEqual(igtEl.className, "timer-primary");
      assertEqual(rtaEl.className, "timer-secondary");

      // 2. realtime mode: RTA flex, IGT none
      td.updateTimerDisplayHierarchy("realtime", "RealTime");
      assertEqual(rtaBlock.style.display, "flex");
      assertEqual(igtBlock.style.display, "none");
      assertEqual(rtaEl.className, "timer-primary");
      assertEqual(igtEl.className, "timer-secondary");

      // 3. both mode: GameTime focus
      td.updateTimerDisplayHierarchy("both", "GameTime");
      assertEqual(rtaBlock.style.display, "flex");
      assertEqual(igtBlock.style.display, "flex");
      assertEqual(igtEl.className, "timer-primary");
      assertEqual(rtaEl.className, "timer-secondary");

      // 4. both mode: RealTime focus
      td.updateTimerDisplayHierarchy("both", "RealTime");
      assertEqual(rtaBlock.style.display, "flex");
      assertEqual(igtBlock.style.display, "flex");
      assertEqual(rtaEl.className, "timer-primary");
      assertEqual(igtEl.className, "timer-secondary");
    });

    it("calculateNextTimingMode cycles through all 4 timing display states deterministically", () => {
      const td = window.LiveSplit.TimerDisplay;

      // State 1 -> State 2: gametime -> realtime
      const step1 = td.calculateNextTimingMode("gametime", "GameTime");
      assertEqual(step1.mode, "realtime");
      assertEqual(step1.focusMethod, "RealTime");

      // State 2 -> State 3: realtime -> both (GameTime primary)
      const step2 = td.calculateNextTimingMode("realtime", "RealTime");
      assertEqual(step2.mode, "both");
      assertEqual(step2.focusMethod, "GameTime");

      // State 3 -> State 4: both (GameTime) -> both (RealTime primary)
      const step3 = td.calculateNextTimingMode("both", "GameTime");
      assertEqual(step3.mode, "both");
      assertEqual(step3.focusMethod, "RealTime");

      // State 4 -> State 1: both (RealTime) -> gametime
      const step4 = td.calculateNextTimingMode("both", "RealTime");
      assertEqual(step4.mode, "gametime");
      assertEqual(step4.focusMethod, "GameTime");
    });

    it("syncModalControls updates segmented buttons and toggles focus row visibility", () => {
      const td = window.LiveSplit.TimerDisplay;

      // Mock segmented control buttons in the DOM for test runner
      const ctrlDisplay = document.getElementById("ctrl-timer-display");
      const ctrlFocus = document.getElementById("ctrl-timer-focus");
      ctrlDisplay.innerHTML = '<button class="seg-btn" data-val="gametime">Game</button><button class="seg-btn" data-val="both">Both</button>';
      ctrlFocus.innerHTML = '<button class="seg-btn" data-val="GameTime">Game</button><button class="seg-btn" data-val="RealTime">Real</button>';

      // Ensure row-timer-focus exists
      let rowFocus = document.getElementById("row-timer-focus");
      if (!rowFocus) {
        rowFocus = document.createElement("div");
        rowFocus.id = "row-timer-focus";
        document.body.appendChild(rowFocus);
      }

      td.syncModalControls("both", "RealTime");
      assertEqual(rowFocus.style.display, "flex", "Row focus visible for both mode");
      const activeDisplay = ctrlDisplay.querySelector(".seg-btn.active");
      assertEqual(activeDisplay.getAttribute("data-val"), "both");
      const activeFocus = ctrlFocus.querySelector(".seg-btn.active");
      assertEqual(activeFocus.getAttribute("data-val"), "RealTime");

      td.syncModalControls("gametime", "GameTime");
      assertEqual(rowFocus.style.display, "none", "Row focus hidden for gametime mode");
      assertEqual(ctrlDisplay.querySelector(".seg-btn.active").getAttribute("data-val"), "gametime");
    });
  });
})();
