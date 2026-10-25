/**
 * LiveSplit Progress Bar - URL Parameters & View Router Unit Tests
 */

(function () {
  "use strict";

  describe("URL Query Parameters & View Router (LiveSplit.LayoutParams)", () => {
    it("exposes LiveSplit.LayoutParams namespace and parser", () => {
      assert(window.LiveSplit, "window.LiveSplit namespace should exist");
      assert(window.LiveSplit.LayoutParams, "window.LiveSplit.LayoutParams should exist");
      assertEqual(typeof window.LiveSplit.LayoutParams.parseUrlParameters, "function", "parseUrlParameters is a function");
    });

    it("parses ?view= parameter to isolate specific HUD components", () => {
      const mockState = {
        title: { visible: true },
        timers: { visible: true },
        track: { visible: true }
      };

      // ?view=timers
      window.LiveSplit.LayoutParams.parseUrlParameters({
        getLayoutState: () => mockState,
        search: "?view=timers"
      });

      assertEqual(mockState.title.visible, false, "title hidden when view=timers");
      assertEqual(mockState.timers.visible, true, "timers visible when view=timers");
      assertEqual(mockState.track.visible, false, "track hidden when view=timers");

      // ?view=track
      window.LiveSplit.LayoutParams.parseUrlParameters({
        getLayoutState: () => mockState,
        search: "?view=track"
      });

      assertEqual(mockState.title.visible, false, "title hidden when view=track");
      assertEqual(mockState.timers.visible, false, "timers hidden when view=track");
      assertEqual(mockState.track.visible, true, "track visible when view=track");
    });

    it("parses ?hide= parameter to hide comma-separated components", () => {
      const mockState = {
        title: { visible: true },
        timers: { visible: true },
        track: { visible: true }
      };

      window.LiveSplit.LayoutParams.parseUrlParameters({
        getLayoutState: () => mockState,
        search: "?hide=timers,track"
      });

      assertEqual(mockState.title.visible, true, "title remains visible");
      assertEqual(mockState.timers.visible, false, "timers hidden by hide parameter");
      assertEqual(mockState.track.visible, false, "track hidden by hide parameter");
    });

    it("parses track orientation and opposing split positions", () => {
      const mockStyle = {
        orientation: "horizontal",
        namePos: "top",
        deltaPos: "bottom"
      };

      window.LiveSplit.LayoutParams.parseUrlParameters({
        getCurrentTrackStyle: () => mockStyle,
        search: "?orient=vertical"
      });

      assertEqual(mockStyle.orientation, "vertical", "orientation updated to vertical");
      assertEqual(mockStyle.namePos, "left", "namePos flipped to left opposing side");
      assertEqual(mockStyle.deltaPos, "right", "deltaPos flipped to right opposing side");
    });

    it("parses background opacity and blur presets and numeric values", () => {
      const mockStyle = {
        bgOpacity: 55,
        bgBlur: 8
      };

      // Glass preset
      window.LiveSplit.LayoutParams.parseUrlParameters({
        getCurrentTrackStyle: () => mockStyle,
        search: "?bg=glass&bgblur=15"
      });
      assertEqual(mockStyle.bgOpacity, 55, "glass preset sets bgOpacity to 55");
      assertEqual(mockStyle.bgBlur, 15, "bgBlur parsed to 15");

      // Off preset
      window.LiveSplit.LayoutParams.parseUrlParameters({
        getCurrentTrackStyle: () => mockStyle,
        search: "?bg=off"
      });
      assertEqual(mockStyle.bgOpacity, 0, "off preset sets bgOpacity to 0");

      // Numeric opacity
      window.LiveSplit.LayoutParams.parseUrlParameters({
        getCurrentTrackStyle: () => mockStyle,
        search: "?bg=72"
      });
      assertEqual(mockStyle.bgOpacity, 72, "numeric bg parsed directly to 72");
    });

    it("delegates profile, split count, timer anchor, and logo actions", () => {
      let loadedProfile = null;
      let setSplits = null;
      let setAnchor = null;
      let appliedLogo = null;
      let removedLogo = false;

      window.LiveSplit.LayoutParams.parseUrlParameters({
        loadProfileByName: (p) => { loadedProfile = p; },
        setVisibleSplits: (s) => { setSplits = s; },
        setTimerAnchor: (a) => { setAnchor = a; },
        applyGameLogo: (l) => { appliedLogo = l; },
        removeGameLogo: () => { removedLogo = true; },
        search: "?profile=SpeedrunPro&splits=6&anchor=right&logo=custom-logo.png"
      });

      assertEqual(loadedProfile, "SpeedrunPro", "profile loaded");
      assertEqual(setSplits, "6", "splits parameter passed to setVisibleSplits");
      assertEqual(setAnchor, "right", "anchor parameter passed to setTimerAnchor");
      assertEqual(appliedLogo, "custom-logo.png", "logo applied");

      // Test logo removal
      window.LiveSplit.LayoutParams.parseUrlParameters({
        removeGameLogo: () => { removedLogo = true; },
        search: "?logo=none"
      });
      assert(removedLogo, "removeGameLogo called when ?logo=none");
    });
  });
  describe("LayoutParams: ghost pin length parameter", () => {
    it("parses and clamps ?ghostlen to 0..60, ignoring invalid values", () => {
      const run = (search) => {
        const style = { ghostPinLength: 16 };
        window.LiveSplit.LayoutParams.parseUrlParameters({
          getLayoutState: () => ({}),
          getCurrentTrackStyle: () => style,
          search
        });
        return style.ghostPinLength;
      };
      assertEqual(run("?ghostlen=0"), 0);
      assertEqual(run("?ghostlen=-5"), 0);
      assertEqual(run("?ghostlen=16"), 16);
      assertEqual(run("?ghostlen=70"), 60);
      assertEqual(run("?ghostlen=invalid"), 16, "invalid value leaves the existing length");
    });
  });

})();
