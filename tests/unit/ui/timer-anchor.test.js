/**
 * LiveSplit Progress Bar - Timer Anchor & Auto-Expansion Unit Tests
 */

(function () {
  "use strict";

  function withCleanAnchorEnv(fn) {
    const origStorage = localStorage.getItem("livesplit_timer_anchor");
    try {
      fn();
    } finally {
      if (origStorage) {
        localStorage.setItem("livesplit_timer_anchor", origStorage);
      } else {
        localStorage.removeItem("livesplit_timer_anchor");
      }
      if (window.LiveSplit && window.LiveSplit.TimerAnchor) {
        const engine = window.LiveSplit.TimerAnchor.createTimerAnchor();
        engine.syncUI();
      }
    }
  }

  describe("Timer Anchor & Auto-Expansion (LiveSplit.TimerAnchor)", () => {
    it("exposes LiveSplit.TimerAnchor namespace and createTimerAnchor factory", () => {
      assert(window.LiveSplit, "window.LiveSplit namespace should exist");
      assert(window.LiveSplit.TimerAnchor, "window.LiveSplit.TimerAnchor should exist");
      assertEqual(typeof window.LiveSplit.TimerAnchor.createTimerAnchor, "function", "createTimerAnchor should be a function");
      assertEqual(window.LiveSplit.TimerAnchor.DEFAULT_STORAGE_KEY, "livesplit_timer_anchor", "default storage key matches");
    });

    it("reads default anchor as auto when storage is empty", () => {
      withCleanAnchorEnv(() => {
        localStorage.removeItem("livesplit_timer_anchor");
        const dummyState = { timers: { anchor: "auto" } };
        const engine = window.LiveSplit.TimerAnchor.createTimerAnchor({
          getLayoutState: () => dummyState
        });

        assertEqual(engine.getAnchor(), "auto", "default anchor is auto");
      });
    });

    it("sets anchor to right and left, updating state and localStorage", () => {
      withCleanAnchorEnv(() => {
        let appliedId = null;
        let savedCount = 0;
        const mockState = { timers: { x: 100, y: 50, scale: 1, anchor: "auto" } };
        const engine = window.LiveSplit.TimerAnchor.createTimerAnchor({
          getLayoutState: () => mockState,
          applyComponentLayout: (id) => { appliedId = id; },
          saveLayout: () => { savedCount++; }
        });

        engine.setAnchor("right");
        assertEqual(mockState.timers.anchor, "right", "state anchor updated to right");
        assertEqual(localStorage.getItem("livesplit_timer_anchor"), "right", "localStorage updated to right");
        assertEqual(appliedId, "timers", "applyComponentLayout called with timers");
        assert(savedCount > 0, "saveLayout called");
        assert(typeof mockState.timers.right === "number", "timers.right offset calculated");

        engine.setAnchor("left");
        assertEqual(mockState.timers.anchor, "left", "state anchor updated to left");
        assertEqual(localStorage.getItem("livesplit_timer_anchor"), "left", "localStorage updated to left");
        assert(mockState.timers.right === undefined, "timers.right removed for left anchor");
      });
    });

    it("cycles anchor sequentially through auto -> right -> left -> auto", () => {
      withCleanAnchorEnv(() => {
        const mockState = { timers: { x: 50, y: 50, anchor: "auto" } };
        const engine = window.LiveSplit.TimerAnchor.createTimerAnchor({
          getLayoutState: () => mockState
        });

        assertEqual(engine.cycleAnchor(), "right", "auto cycles to right");
        assertEqual(engine.cycleAnchor(), "left", "right cycles to left");
        assertEqual(engine.cycleAnchor(), "auto", "left cycles to auto");
      });
    });

    it("intelligently resolves right-expansion in auto mode based on viewport center", () => {
      withCleanAnchorEnv(() => {
        const mockState = { timers: { x: 100, anchor: "auto" } };
        const engine = window.LiveSplit.TimerAnchor.createTimerAnchor({
          getLayoutState: () => mockState
        });

        // Viewport width = 1000. Center = 500.
        // Timer compWidth = 200.
        // If x = 100, midpoint = 200 (< 500) -> isRight = false
        const isRightLeftHalf = engine.resolveIsRight(100, 200, 1000);
        assertEqual(isRightLeftHalf, false, "left half of screen resolves to left anchor");

        // If x = 700, midpoint = 800 (> 500) -> isRight = true
        const isRightRightHalf = engine.resolveIsRight(700, 200, 1000);
        assertEqual(isRightRightHalf, true, "right half of screen resolves to right anchor");

        // Explicit right and left override auto
        mockState.timers.anchor = "right";
        assertEqual(engine.resolveIsRight(100, 200, 1000), true, "explicit right overrides position");

        mockState.timers.anchor = "left";
        assertEqual(engine.resolveIsRight(700, 200, 1000), false, "explicit left overrides position");
      });
    });

    it("synchronizes modal segmented control and edit mode badge", () => {
      withCleanAnchorEnv(() => {
        const mockState = { timers: { x: 800, anchor: "right" } };
        const engine = window.LiveSplit.TimerAnchor.createTimerAnchor({
          getLayoutState: () => mockState
        });

        engine.syncUI();

        const badge = document.getElementById("badge-anchor-timers");
        if (badge) {
          assertEqual(badge.innerText, "⇤ Exp Left", "badge displays '⇤ Exp Left' for right anchor");
        }

        mockState.timers.anchor = "left";
        engine.syncUI();
        if (badge) {
          assertEqual(badge.innerText, "⇥ Exp Right", "badge displays '⇥ Exp Right' for left anchor");
        }
      });
    });
  });
})();
