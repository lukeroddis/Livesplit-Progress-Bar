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
  describe("Timer Anchor: badge, bound controls and edge cases", () => {
    const { mountHtml } = window.TestUtils;
    const KEY = window.LiveSplit.Storage.KEYS.TIMER_ANCHOR;

    const HTML = `
      <div id="ctrl-timer-expansion">
        <button class="seg-btn" data-val="auto"></button><button class="seg-btn" data-val="right"></button>
        <button class="seg-btn" data-val="left"></button><button class="seg-btn"></button>
      </div>
      <button id="badge-anchor-timers"></button>
      <div id="hud-comp-timers" style="position: absolute; width: 300px;"></div>`;

    function withAnchor(fn, layoutState = { timers: { x: 100, y: 0, scale: 1 } }) {
      const dom = mountHtml(HTML);
      const saved = localStorage.getItem(KEY);
      localStorage.removeItem(KEY);
      const log = { applied: [], saves: 0 };
      const engine = window.LiveSplit.TimerAnchor.createTimerAnchor({
        getLayoutState: () => layoutState,
        getDefaultLayout: () => ({ timers: { x: 10, y: 20, scale: 1 } }),
        saveLayout: () => { log.saves++; },
        applyComponentLayout: (id) => log.applied.push(id)
      });
      try {
        return fn({ el: dom.el, dom, engine, log, layoutState });
      } finally {
        dom.remove();
        if (saved === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, saved);
      }
    }

    const activeSeg = (dom) => dom.root.querySelector("#ctrl-timer-expansion .seg-btn.active")?.getAttribute("data-val");

    it("the badge describes forced and auto expansion", () => withAnchor(({ el, dom, engine, layoutState }) => {
      engine.setAnchor("right");
      assertEqual(el("badge-anchor-timers").innerText, "⇤ Exp Left");
      assertEqual(activeSeg(dom), "right");
      engine.setAnchor("left");
      assertEqual(el("badge-anchor-timers").innerText, "⇥ Exp Right");

      engine.setAnchor("auto");
      layoutState.timers.x = 0;
      engine.syncUI();
      assertEqual(el("badge-anchor-timers").innerText, "⇥ Auto (R)", "left half expands right");
      layoutState.timers.x = window.innerWidth;
      engine.syncUI();
      assertEqual(el("badge-anchor-timers").innerText, "⇤ Auto (L)", "right half expands left");
      assert(el("badge-anchor-timers").title.includes("expanding left"));
    }));

    it("right anchoring records the right offset; left anchoring drops it", () => withAnchor(({ engine, log, layoutState }) => {
      engine.setAnchor("right");
      assertEqual(layoutState.timers.right, Math.max(0, window.innerWidth - (100 + 300)));
      assertEqual(localStorage.getItem(KEY), "right");
      assertEqual(log.applied, ["timers"]);
      assertEqual(log.saves, 1);
      engine.setAnchor("left");
      assert(!("right" in layoutState.timers), "right offset removed");
    }));

    it("ignores invalid anchors and creates missing timer state from the defaults", () => withAnchor(({ engine, log, layoutState }) => {
      engine.setAnchor("diagonal");
      assertEqual(log.saves, 0, "invalid anchor ignored");
      engine.setAnchor("left");
      assertEqual([layoutState.timers.x, layoutState.timers.anchor], [10, "left"], "timers created from the defaults");
    }, {}));

    it("falls back to the stored anchor when there is no layout state", () => withAnchor(({ engine }) => {
      localStorage.setItem(KEY, "right");
      assertEqual(engine.getAnchor(), "right");
      assertEqual(engine.resolveIsRight(0, 300, 1000), true, "forced right");
      localStorage.setItem(KEY, "left");
      assertEqual(engine.resolveIsRight(900, 300, 1000), false, "forced left");
      engine.setAnchor("auto");
      assertEqual(localStorage.getItem(KEY), "auto", "saved without layout state");
    }, null));

    it("segment buttons set the anchor and the badge cycles it", () => withAnchor(({ el, dom, engine, layoutState }) => {
      engine.bindEvents();
      dom.root.querySelector('#ctrl-timer-expansion [data-val="left"]').click();
      assertEqual(layoutState.timers.anchor, "left");
      dom.root.querySelector("#ctrl-timer-expansion .seg-btn:not([data-val])").click();
      assertEqual(layoutState.timers.anchor, "left", "a button without a value does nothing");

      const seen = [];
      for (let i = 0; i < 3; i++) { el("badge-anchor-timers").click(); seen.push(layoutState.timers.anchor); }
      assertEqual(seen, ["auto", "right", "left"]);
    }));

    it("survives storage being unavailable", () => withAnchor(({ engine, layoutState }) => {
      const realSet = Storage.prototype.setItem;
      const realWarn = console.warn;
      Storage.prototype.setItem = () => { throw new DOMException("denied", "SecurityError"); };
      console.warn = () => {};
      try {
        engine.setAnchor("right");
      } finally {
        Storage.prototype.setItem = realSet;
        console.warn = realWarn;
      }
      assertEqual(layoutState.timers.anchor, "right", "layout still updated");
    }));
  });
})();
