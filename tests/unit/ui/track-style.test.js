/**
 * Speedrun Overlay - Track Style & Orientation Unit Tests
 */

(function () {
  "use strict";

  function withCleanTrackStyleEnv(fn) {
    const origStyle = localStorage.getItem("livesplit_track_style");
    const origDensity = localStorage.getItem("livesplit_visible_splits");
    try {
      fn();
    } finally {
      if (origStyle) localStorage.setItem("livesplit_track_style", origStyle);
      else localStorage.removeItem("livesplit_track_style");

      if (origDensity) localStorage.setItem("livesplit_visible_splits", origDensity);
      else localStorage.removeItem("livesplit_visible_splits");

      if (window.LiveSplit && window.LiveSplit.TrackStyle) {
        const engine = window.LiveSplit.TrackStyle.createTrackStyle();
        engine.applyStyle();
      }
    }
  }

  describe("Track Style & Orientation Controller (LiveSplit.TrackStyle)", () => {
    it("exposes LiveSplit.TrackStyle namespace, DEFAULT_TRACK_STYLE, and factory", () => {
      assert(window.LiveSplit, "window.LiveSplit namespace should exist");
      assert(window.LiveSplit.TrackStyle, "window.LiveSplit.TrackStyle should exist");
      assertEqual(typeof window.LiveSplit.TrackStyle.createTrackStyle, "function", "createTrackStyle should be a function");
      assertEqual(typeof window.LiveSplit.TrackStyle.mapOrientationSwitch, "function", "mapOrientationSwitch should be a function");
      assert(window.LiveSplit.TrackStyle.DEFAULT_TRACK_STYLE, "DEFAULT_TRACK_STYLE exists");
      assertEqual(window.LiveSplit.TrackStyle.DEFAULT_TRACK_STYLE.nameFontSize, 17, "default nameFontSize is 17");
      assertEqual(window.LiveSplit.TrackStyle.DEFAULT_TRACK_STYLE.deltaPos, "bottom", "default deltaPos is bottom");
    });

    it("correctly maps orientation position transitions", () => {
      const map = window.LiveSplit.TrackStyle.mapOrientationSwitch;

      // 1. Horizontal (top/bottom) -> Vertical (left/right)
      const res1 = map("horizontal", "vertical", "top", "bottom");
      assertEqual(res1.orientation, "vertical", "target is vertical");
      assertEqual(res1.namePos, "left", "top name maps to left");
      assertEqual(res1.deltaPos, "right", "bottom delta maps to right");

      // 2. Horizontal (bottom/top) -> Vertical (right/right)
      const res2 = map("horizontal", "vertical", "bottom", "top");
      assertEqual(res2.namePos, "right", "bottom name maps to right");
      assertEqual(res2.deltaPos, "right", "top delta maps to right");

      // 3. Vertical (left/right) -> Horizontal (top/top)
      const res3 = map("vertical", "horizontal", "left", "right");
      assertEqual(res3.orientation, "horizontal", "target is horizontal");
      assertEqual(res3.namePos, "top", "left name maps to top");
      assertEqual(res3.deltaPos, "top", "right delta maps to top");

      // 4. Vertical (right/right) -> Horizontal (bottom/top)
      const res4 = map("vertical", "horizontal", "right", "right");
      assertEqual(res4.namePos, "bottom", "right name maps to bottom");
      assertEqual(res4.deltaPos, "top", "right delta maps to top");
    });

    it("loads and saves track style to localStorage", () => {
      withCleanTrackStyleEnv(() => {
        let current = null;
        const engine = window.LiveSplit.TrackStyle.createTrackStyle({
          getCurrentStyle: () => current,
          setCurrentStyle: (s) => { current = s; }
        });

        localStorage.removeItem("livesplit_track_style");
        const loaded = engine.loadSavedStyle();
        assertEqual(loaded.barHeight, 6, "loaded default barHeight is 6");

        loaded.barHeight = 12;
        engine.saveStyle(loaded);
        const reloaded = engine.loadSavedStyle();
        assertEqual(reloaded.barHeight, 12, "reloaded custom barHeight is 12");
      });
    });

    it("resets style to DEFAULT_TRACK_STYLE and calls removeGameLogo", () => {
      withCleanTrackStyleEnv(() => {
        let current = { barHeight: 20 };
        let logoRemoved = false;
        const engine = window.LiveSplit.TrackStyle.createTrackStyle({
          getCurrentStyle: () => current,
          setCurrentStyle: (s) => { current = s; },
          removeGameLogo: () => { logoRemoved = true; }
        });

        const reset = engine.resetStyle();
        assertEqual(reset.barHeight, 6, "reset barHeight is 6");
        assertEqual(current.barHeight, 6, "current barHeight reset");
        assertEqual(logoRemoved, true, "removeGameLogo was called");
      });
    });

    it("handles setVisibleSplits with auto, all, and clamped integers (2..60)", () => {
      withCleanTrackStyleEnv(() => {
        const engine = window.LiveSplit.TrackStyle.createTrackStyle();

        engine.setVisibleSplits("all");
        assertEqual(localStorage.getItem("livesplit_visible_splits"), "all", "saved 'all'");

        engine.setVisibleSplits("auto");
        assertEqual(localStorage.getItem("livesplit_visible_splits"), "auto", "saved 'auto'");

        engine.setVisibleSplits("1");
        assertEqual(localStorage.getItem("livesplit_visible_splits"), "2", "clamped min to 2");

        engine.setVisibleSplits("100");
        assertEqual(localStorage.getItem("livesplit_visible_splits"), "60", "clamped max to 60");

        engine.setVisibleSplits("8");
        assertEqual(localStorage.getItem("livesplit_visible_splits"), "8", "saved integer 8");
      });
    });

    it("switches orientation, docking and resetting scroll positions", () => {
      withCleanTrackStyleEnv(() => {
        let style = { orientation: "horizontal", namePos: "top", deltaPos: "bottom" };
        const layoutState = {
          track: { docked: "bottom", x: 0, y: 990 }
        };
        let fits = 0;

        const engine = window.LiveSplit.TrackStyle.createTrackStyle({
          getCurrentStyle: () => style,
          setCurrentStyle: (s) => { style = s; },
          getLayoutState: () => layoutState,
          fitTrackOnScreen: () => { fits++; }
        });

        engine.setOrientation("vertical");
        assertEqual(style.orientation, "vertical", "style orientation is vertical");
        assertEqual(layoutState.track.docked, "left", "track docked to left");

        const viewport = document.getElementById("track-viewport");
        if (viewport) {
          assertEqual(viewport.scrollLeft, 0, "viewport scrollLeft is 0");
          assertEqual(viewport.scrollTop, 0, "viewport scrollTop is 0");
        }

        engine.setOrientation("horizontal");
        assertEqual(style.orientation, "horizontal", "style orientation is horizontal");
        assertEqual(layoutState.track.docked, "bottom", "track docked to bottom");
        assertEqual(fits, 2, "the track is fitted back on screen after each switch");

        layoutState.track.docked = "top";
        engine.setOrientation("vertical");
        assertEqual(layoutState.track.docked, "left", "a top dock becomes a left dock");
      });
    });
  });
    describe("Track Style: orientation position mapping cases", () => {
      const map = window.LiveSplit.TrackStyle.mapOrientationSwitch;
      const pos = (r) => [r.orientation, r.namePos, r.deltaPos];

      it("maps name/delta positions when switching orientation", () => {
        assertEqual(pos(map("horizontal", "vertical", "top", "top")), ["vertical", "left", "right"]);
        assertEqual(pos(map("horizontal", "vertical", "bottom", "top")), ["vertical", "right", "right"]);
        assertEqual(pos(map("vertical", "horizontal", "left", "right")), ["horizontal", "top", "top"]);
        assertEqual(pos(map("vertical", "horizontal", "right", "right")), ["horizontal", "bottom", "top"]);
        assertEqual(pos(map("vertical", "vertical", "left", "right")), ["vertical", "left", "right"]);
      });
    });

})();
