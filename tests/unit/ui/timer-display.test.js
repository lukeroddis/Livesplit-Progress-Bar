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
      assertEqual(typeof td.updateTimerDisplayHierarchy, "function", "updateTimerDisplayHierarchy is a function");
      assertEqual(typeof td.calculateNextTimingMode, "function", "calculateNextTimingMode is a function");
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

    it("cycles Game -> Real -> Both (Game) -> Both (Real) -> Game", () => {
      const next = window.LiveSplit.TimerDisplay.calculateNextTimingMode;
      const step = (s) => { const n = next(s[0], s[1]); return [n.mode, n.focusMethod]; };
      const s1 = step(["gametime", "GameTime"]);
      assertEqual(s1, ["realtime", "RealTime"]);
      const s2 = step(s1);
      assertEqual(s2, ["both", "GameTime"]);
      const s3 = step(s2);
      assertEqual(s3, ["both", "RealTime"]);
      assertEqual(step(s3), ["gametime", "GameTime"]);
    });
  });

})();
