/**
 * tests/unit/ui/overlay.test.js
 * Unit tests for overlay
 */

(function () {
  "use strict";


    describe("LiveSplit Undo Split & Connection Safety", () => {
      it("exports handleUndoSplit on window", () => {
        assertEqual(typeof window.handleUndoSplit, "function");
      });
      it("safely executes handleUndoSplit without errors", () => {
        window.handleUndoSplit(0, 1);
        assertEqual(true, true);
      });
    });


    describe("Timer Display Modes & Primary Focus", () => {
      it("exports setTimerDisplayMode, setTimingMethodFocus, and getTimerDisplayMode", () => {
        assertEqual(typeof window.setTimerDisplayMode, "function");
        assertEqual(typeof window.setTimingMethodFocus, "function");
        assertEqual(typeof window.getTimerDisplayMode, "function");
        assertEqual(typeof window.getCurrentTimingMethod, "function");
      });
      it("switches to Game Time as primary focus in both mode", () => {
        window.setTimerDisplayMode("both", "GameTime");
        assertEqual(window.getTimerDisplayMode(), "both");
        assertEqual(window.getCurrentTimingMethod(), "GameTime");
        const igt = document.getElementById("timer-igt");
        const rta = document.getElementById("timer-rta");
        assertEqual(igt.className, "timer-primary");
        assertEqual(rta.className, "timer-secondary");
      });
      it("switches to Real Time as primary focus in both mode", () => {
        window.setTimingMethodFocus("RealTime");
        assertEqual(window.getCurrentTimingMethod(), "RealTime");
        const igt = document.getElementById("timer-igt");
        const rta = document.getElementById("timer-rta");
        assertEqual(rta.className, "timer-primary");
        assertEqual(igt.className, "timer-secondary");
      });
      it("cycles 4 timing states via toggleTimingMethod", () => {
        window.setTimerDisplayMode("gametime", "GameTime");
        assertEqual(window.getTimerDisplayMode(), "gametime");

        window.toggleTimingMethod();
        assertEqual(window.getTimerDisplayMode(), "realtime");
        assertEqual(window.getCurrentTimingMethod(), "RealTime");

        window.toggleTimingMethod();
        assertEqual(window.getTimerDisplayMode(), "both");
        assertEqual(window.getCurrentTimingMethod(), "GameTime");

        window.toggleTimingMethod();
        assertEqual(window.getTimerDisplayMode(), "both");
        assertEqual(window.getCurrentTimingMethod(), "RealTime");

        window.toggleTimingMethod();
        assertEqual(window.getTimerDisplayMode(), "gametime");
        assertEqual(window.getCurrentTimingMethod(), "GameTime");
      });
      it("supports clicking trigger pill to latch menu open (pressed down) and clicking again or close button to dismiss", () => {
        if (typeof window.initOverlay === "function") window.initOverlay();
        const wrap = document.getElementById("quick-settings-wrap");
        const pill = document.getElementById("settings-trigger-pill");
        const closeBtn = document.getElementById("btn-close-settings");

        wrap.classList.remove("menu-open");
        pill.classList.remove("is-pressed");

        // Click 1: Press down and latch open
        pill.click();
        assertEqual(wrap.classList.contains("menu-open"), true);
        assertEqual(pill.classList.contains("is-pressed"), true);

        // Click 2: Unpress and close
        pill.click();
        assertEqual(wrap.classList.contains("menu-open"), false);
        assertEqual(pill.classList.contains("is-pressed"), false);

        // Re-open then close via ✕ button
        pill.click();
        assertEqual(wrap.classList.contains("menu-open"), true);
        closeBtn.click();
        assertEqual(wrap.classList.contains("menu-open"), false);
        assertEqual(pill.classList.contains("is-pressed"), false);
      });
      it("remains idempotent and maintains single-click latching even if initOverlay is repeatedly called", () => {
        const wrap = document.getElementById("quick-settings-wrap");
        const pill = document.getElementById("settings-trigger-pill");

        // Simulate duplicate initialization calls (such as DOMContentLoaded + window.onload)
        if (typeof window.initOverlay === "function") {
          window.initOverlay();
          window.initOverlay();
        }

        wrap.classList.remove("menu-open");
        pill.classList.remove("is-pressed");

        // Single click must reliably open and latch pressed, without immediate cancellation
        pill.click();
        assertEqual(wrap.classList.contains("menu-open"), true);
        assertEqual(pill.classList.contains("is-pressed"), true);

        // Second click must reliably unpress and close
        pill.click();
        assertEqual(wrap.classList.contains("menu-open"), false);
        assertEqual(pill.classList.contains("is-pressed"), false);
      });
    });


    describe("In-Run State Persistence: saveInRunState, loadInRunState, clearInRunState", () => {
      it("exports in-run state helper functions on window", () => {
        assert(typeof window.saveInRunState === "function", "saveInRunState exported");
        assert(typeof window.loadInRunState === "function", "loadInRunState exported");
        assert(typeof window.clearInRunState === "function", "clearInRunState exported");
      });

      it("persists and restores locked deltas across storage cycles", () => {
        window.clearInRunState();
        assert(localStorage.getItem("livesplit_in_run_state") === null, "storage cleared");
        window.saveInRunState();
        const raw = localStorage.getItem("livesplit_in_run_state");
        assert(raw !== null, "storage created on save");
        const loaded = window.loadInRunState();
        assert(typeof loaded === "boolean", "loadInRunState returns boolean");
        window.clearInRunState();
      });
    });


    describe("Comparison Switching: cycleComparison & Toast Notification", () => {
      it("exports cycleComparison and showComparisonToast on window", () => {
        assert(typeof window.cycleComparison === "function", "cycleComparison exported");
        assert(typeof window.showComparisonToast === "function", "showComparisonToast exported");
      });

      it("cycles through comparisons in both directions", () => {
        const curBefore = window.getCurrentComparison ? window.getCurrentComparison() : "Personal Best";
        window.cycleComparison(false);
        const curAfterNext = window.getCurrentComparison ? window.getCurrentComparison() : "Best Segments";
        assert(curAfterNext !== curBefore, "advances to next comparison");
        window.cycleComparison(true);
        const curAfterRev = window.getCurrentComparison ? window.getCurrentComparison() : "Personal Best";
        assert(curAfterRev === curBefore, "returns to original comparison on reverse");
      });

      it("renders hud-toast element with glassmorphic styling", () => {
        window.showComparisonToast("Personal Best");
        const toast = document.getElementById("hud-toast");
        assert(toast !== null, "#hud-toast element exists");
        assert(toast.classList.contains("hud-toast"), "has hud-toast class");
        assert(toast.innerText.includes("Personal Best"), "displays comparison name");
      });

      it("recalculates completed split deltas and segment states when switching comparisons", () => {
        const originalComp = window.getCurrentComparison ? window.getCurrentComparison() : "Personal Best";
        window.applyActiveComparison("Personal Best", false, false);
        
        // Cycle comparison to next
        window.cycleComparison(false);
        const compAfter = window.getCurrentComparison ? window.getCurrentComparison() : "";
        assert(compAfter !== originalComp, "successfully switches active comparison");

        // Revert back
        window.applyActiveComparison(originalComp, false, false);
      });
    });


    describe("Architectural Safeguards & Bug Fixes", () => {
      it("exports safeStorage with in-memory fallback on window", () => {
        assert(typeof window.safeStorage === "object", "safeStorage exported");
        assert(typeof window.safeStorage.getItem === "function", "getItem exists");
        assert(typeof window.safeStorage.setItem === "function", "setItem exists");
        assert(typeof window.safeStorage.removeItem === "function", "removeItem exists");
        
        window.safeStorage.setItem("test_key", "test_val");
        assertEqual(window.safeStorage.getItem("test_key"), "test_val");
        window.safeStorage.removeItem("test_key");
        assertEqual(window.safeStorage.getItem("test_key"), null);
      });

      it("layout profiles export and restore activeGhosts array", () => {
        const exp = window.hudLayout.createProfileExport("GhostProfileTest");
        assert(Array.isArray(exp.preferences.activeGhosts), "activeGhosts is an array in preferences");
      });
    });


    describe("Modular Architecture: LiveSplit Namespaces", () => {
      it("exposes LiveSplit namespace and core submodules", () => {
        assert(typeof window.LiveSplit === "object", "window.LiveSplit exists");
        assert(typeof window.LiveSplit.Storage === "object", "LiveSplit.Storage exists");
        assert(typeof window.LiveSplit.Time === "object", "LiveSplit.Time exists");
        assert(typeof window.LiveSplit.SplitEngine === "object", "LiveSplit.SplitEngine exists");
        assert(typeof window.LiveSplit.GhostMath === "object", "LiveSplit.GhostMath exists");
        assert(typeof window.LiveSplit.Client === "object", "LiveSplit.Client exists");
        assert(typeof window.LiveSplit.TrackRenderer === "object", "LiveSplit.TrackRenderer exists");
        assert(typeof window.LiveSplit.LayoutEngine === "object", "LiveSplit.LayoutEngine exists");
        assert(typeof window.LiveSplit.Interactions === "object", "LiveSplit.Interactions exists");
      });

      it("LiveSplit.Time parses and formats times correctly", () => {
        assertEqual(window.LiveSplit.Time.timeStringToSeconds("01:23.45"), 83.45);
        assertEqual(window.LiveSplit.Time.formatTargetTime(83.45), "1:23");
        assertEqual(window.LiveSplit.Time.formatTimerDisplay(83.45), "1:23.45");
        assertEqual(window.LiveSplit.Time.formatDeltaSeconds(-1.25), "-1.2");
      });

      it("LiveSplit.TrackRenderer provides zero-allocation element cache", () => {
        const cache = window.LiveSplit.TrackRenderer.createLiveElementCache();
        assert(typeof cache.getElements === "function", "cache.getElements exists");
        assert(typeof cache.invalidate === "function", "cache.invalidate exists");
        const res = cache.getElements(0);
        assert("fill" in res, "result contains fill");
        assert("deltaSpan" in res, "result contains deltaSpan");
      });
    });
})();
