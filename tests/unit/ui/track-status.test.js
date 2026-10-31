/**
 * tests/unit/ui/track-status.test.js
 * LiveSplit.TrackStatus scrollTrack (dock split scrolling) over a minimal app:
 * native viewport scrolling, sliding-window shifts and "back to the current split".
 * Storage and the live track are restored afterwards.
 */

(function () {
  "use strict";

  const { stubProps } = window.TestUtils;
  const KEYS = window.LiveSplit.Storage.KEYS;

  function makeApp(stateOverrides = {}) {
    const ghostUpdates = [];
    const app = {
      state: Object.assign({ splitsList: [], currentIndex: -1, trackManualScrollOffset: 0, lastElapsedSec: 0 }, stateOverrides),
      getVisibleSplitsCapacity: () => 5,
      updateGhostRunner: (sec) => ghostUpdates.push(sec)
    };
    window.LiveSplit.TrackStatus.installTrackStatus(app);
    return { app, ghostUpdates };
  }

  // Runs fn with the windowing storage keys set, restoring them and the live track afterwards
  function withWindowing(alwaysShowLast, splits, fn) {
    const saved = [KEYS.ALWAYS_SHOW_LAST, KEYS.VISIBLE_SPLITS].map((k) => [k, localStorage.getItem(k)]);
    localStorage.setItem(KEYS.ALWAYS_SHOW_LAST, alwaysShowLast);
    localStorage.setItem(KEYS.VISIBLE_SPLITS, splits);
    try {
      return fn();
    } finally {
      saved.forEach(([k, v]) => (v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v)));
      window.LiveSplit.Overlay.refreshTrack?.();
    }
  }

  // Fakes the viewport's scroll geometry (getters on the prototype) for the duration of fn
  function withViewportGeometry(geometry, fn) {
    const viewport = document.getElementById("track-viewport");
    const scrolled = [];
    Object.entries(geometry).forEach(([k, v]) => Object.defineProperty(viewport, k, { configurable: true, value: v, writable: true }));
    viewport.scrollTo = (opts) => scrolled.push(opts);
    try {
      return fn(scrolled);
    } finally {
      Object.keys(geometry).concat("scrollTo").forEach((k) => delete viewport[k]);
    }
  }

  describe("Track Status: split view position (dock slider)", () => {
    it("windowed: the window's first slot, 0..last start, clamped when set", () => withWindowing("true", "4", () => {
      const splitsList = Array.from({ length: 12 }, (_, i) => `S${i}`);
      const { app } = makeApp({ splitsList, currentIndex: 0 });
      assertEqual(app.getTrackScrollPosition(), { pos: 0, max: 8 }, "12 splits, 5 slots");
      app.setTrackScrollPosition(3);
      assertEqual(app.getTrackScrollPosition().pos, 3);
      app.setTrackScrollPosition(99);
      assertEqual(app.getTrackScrollPosition().pos, 8, "clamped to the last window");
      app.scrollTrack(0);
      assertEqual(app.getTrackScrollPosition().pos, 0, "Current goes back");
    }));

    it("native scroll: the scroll offset in node spacings", () => withWindowing("false", "auto", () => {
      const { app } = makeApp();
      const spacing = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--node-spacing")) || 100;
      const extent = spacing * 6;
      withViewportGeometry({
        scrollWidth: 400 + extent, clientWidth: 400, scrollLeft: spacing * 2,
        scrollHeight: 300 + extent, clientHeight: 300, scrollTop: spacing * 2
      }, (scrolled) => {
        assertEqual(app.getTrackScrollPosition(), { pos: 2, max: 6 });
        app.setTrackScrollPosition(4);
        app.setTrackScrollPosition(-3);
        const axis = document.getElementById("track").classList.contains("vertical") ? "top" : "left";
        assertEqual(scrolled.map((o) => o[axis]), [spacing * 4, 0], "jumps (no smooth scroll while dragging), clamped at 0");
      });
    }));
  });

  describe("Track Status: scrollTrack", () => {
    it("scrolls the viewport natively by one split spacing when not windowed", () => withWindowing("false", "auto", () => {
      const { app } = makeApp();
      const viewport = document.getElementById("track-viewport");
      const isVertical = document.getElementById("track").classList.contains("vertical");
      const calls = [];
      stubProps(viewport, { scrollBy: (opts) => calls.push(opts) }, () => {
        app.scrollTrack(1);
        app.scrollTrack(-1);
      });
      const axis = isVertical ? "top" : "left";
      assertEqual(calls.length, 2);
      assert(calls[0][axis] > 0 && calls[1][axis] < 0, "forward then back along the track");
      assertEqual(calls[0][axis], -calls[1][axis]);
    }));

    it("shifts the sliding window when windowed, and 0 goes back to the current split", () => withWindowing("true", "4", () => {
      const splitsList = Array.from({ length: 12 }, (_, i) => `S${i}`);
      const { app, ghostUpdates } = makeApp({ splitsList, currentIndex: 0, lastElapsedSec: 12 });
      assert(app.isTrackWindowed(), "12 splits in a 5-split window");
      app.scrollTrack(1);
      assert(app.state.trackManualScrollOffset > 0, "window moved forward");
      app.scrollTrack(0);
      assertEqual(app.state.trackManualScrollOffset, 0, "back to the current split");
      assert(ghostUpdates.includes(12), "ghosts re-rendered at the last elapsed time");
    }));
  });
})();
