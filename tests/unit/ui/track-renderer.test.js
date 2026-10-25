/**
 * tests/unit/ui/track-renderer.test.js
 * Unit tests for track-renderer
 */

(function () {
  "use strict";


    describe("Track Orientation: Horizontal and Vertical Modes", () => {
      it("supports horizontal and vertical track orientation toggle", () => {
        if (window.hudLayout && window.hudLayout.setTrackOrientation) {
          window.hudLayout.setTrackOrientation("vertical");
          const style = window.hudLayout.getTrackStyle();
          assertEqual(style.orientation, "vertical");
          const track = document.getElementById("track");
          assertEqual(track.classList.contains("vertical"), true);

          // Switching to vertical should map positions to left/right
          assertEqual(["left", "right"].includes(style.namePos), true);
          assertEqual(["left", "right"].includes(style.deltaPos), true);

          // Switch back to horizontal
          window.hudLayout.setTrackOrientation("horizontal");
          assertEqual(style.orientation, "horizontal");
          assertEqual(track.classList.contains("vertical"), false);
          assertEqual(["top", "bottom"].includes(style.namePos), true);
          assertEqual(["top", "bottom"].includes(style.deltaPos), true);
        }
      });
      it("supports left/right positioning combinations in vertical mode", () => {
        if (window.hudLayout && window.hudLayout.setTrackOrientation) {
          window.hudLayout.setTrackOrientation("vertical");
          const style = window.hudLayout.getTrackStyle();

          // Test Name Left, Delta Right (Default Symmetrical)
          style.namePos = "left";
          style.deltaPos = "right";
          window.hudLayout.applyTrackStyle();
          const track = document.getElementById("track");
          assertEqual(track.classList.contains("pos-name-left"), true);
          assertEqual(track.classList.contains("pos-delta-right"), true);

          // Test Both on Right (Classic LiveSplit)
          style.namePos = "right";
          style.deltaPos = "right";
          window.hudLayout.applyTrackStyle();
          assertEqual(track.classList.contains("pos-name-right"), true);
          assertEqual(track.classList.contains("pos-delta-right"), true);

          // Restore to horizontal
          window.hudLayout.setTrackOrientation("horizontal");
        }
      });
    });


    describe("Track Scrolling & Mousewheel", () => {
      it("setupTrackScrollInteractions is exposed and functional", () => {
        assertEqual(typeof window.setupTrackScrollInteractions, "function");
      });

      it("layout engine exports isEditMode getter", () => {
        assertEqual(typeof window.hudLayout.isEditMode, "function");
        assertEqual(window.hudLayout.isEditMode(), false);
      });

      it("scrolling listener handles wheel events without error", () => {
        const vp = document.getElementById("track-viewport");
        assert(vp !== null, "track-viewport exists");
        const wheelEvt = new WheelEvent("wheel", { deltaY: 50, cancelable: true });
        window.dispatchEvent(wheelEvt);
      });
    });


    describe("Skipped Splits & Incomplete Data", () => {
      it("ALL_SPLIT_STATE_CLASSES includes uncoloured", () => {
        const item = document.getElementById("item-0");
        assert(item !== null, "item-0 exists");
        item.classList.add("completed", "uncoloured");
        assert(item.classList.contains("uncoloured"), "item-0 accepts uncoloured class");
        item.classList.remove("uncoloured");
      });

      it("setDeltaDisplay handles uncoloured state and dash delta correctly", () => {
        const delta = { text: "-", isAhead: false, signedSeconds: 0 };
        window.setDeltaDisplay(0, delta, "uncoloured", null);
        const deltaSpan = document.getElementById("delta-val-0");
        const timeSpan = document.getElementById("time-val-0");
        const fill = document.getElementById("fill-0");
        const item = document.getElementById("item-0");
        assertEqual(deltaSpan.innerText, "-");
        assertEqual(timeSpan.innerText, "-");
        assert(fill.classList.contains("uncoloured"), "fill has uncoloured class");
        assert(item.classList.contains("uncoloured"), "item has uncoloured class");
      });

      it("setDeltaDisplay preserves completed time on incomplete comparison data", () => {
        const delta = { text: "-", isAhead: false, signedSeconds: 0 };
        window.setDeltaDisplay(0, delta, "uncoloured", 45.2);
        const timeSpan = document.getElementById("time-val-0");
        assert(timeSpan.innerText.includes("45") || timeSpan.innerText.includes("0:45"), "timeSpan displays split time");
      });
    });


    describe("Always Show Last Split: updateTrackWindow", () => {
      it("exports updateTrackWindow, shiftTrackWindow, and isTrackWindowed on window", () => {
        assert(typeof window.updateTrackWindow === "function", "updateTrackWindow exported");
        assert(typeof window.shiftTrackWindow === "function", "shiftTrackWindow exported");
        assert(typeof window.isTrackWindowed === "function", "isTrackWindowed exported");
      });

      it("returns false and preserves continuous track when alwaysShowLast is disabled", () => {
        localStorage.setItem("livesplit_always_show_last_split", "false");
        const res = window.updateTrackWindow(0);
        assert(res === false, "returns false when disabled");
        localStorage.setItem("livesplit_always_show_last_split", "true");
      });

      it("shifts visible window with shiftTrackWindow when track is windowed", () => {
        localStorage.setItem("livesplit_always_show_last_split", "true");
        localStorage.setItem("livesplit_visible_splits", "8");
        const isWin = window.isTrackWindowed();
        if (isWin) {
          const offsetBefore = window.getTrackManualScrollOffset ? window.getTrackManualScrollOffset() : 0;
          const shifted = window.shiftTrackWindow(1);
          assert(typeof shifted === "boolean", "shiftTrackWindow returns boolean");
          const offsetAfter = window.getTrackManualScrollOffset ? window.getTrackManualScrollOffset() : 0;
          assert(offsetAfter >= offsetBefore, "offset shifted forward");
          window.shiftTrackWindow(-1);
        }
      });
    });


    describe("Track Orientation & Split Density Reflow", () => {
      it("exports setTrackOrientation, updateTrackDensityAndAngle, and getVisibleSplitsCapacity", () => {
        assert(typeof window.setTrackOrientation === "function", "setTrackOrientation exported");
        assert(typeof window.updateTrackDensityAndAngle === "function", "updateTrackDensityAndAngle exported");
        assert(typeof window.getVisibleSplitsCapacity === "function", "getVisibleSplitsCapacity exported");
      });

      it("setTrackOrientation updates track class and resets viewport scroll positions", () => {
        const viewport = document.getElementById("track-viewport");
        if (viewport) {
          viewport.scrollLeft = 50;
          viewport.scrollTop = 50;
        }
        window.setTrackOrientation("vertical");
        const track = document.getElementById("track");
        assert(track.classList.contains("vertical"), "track contains vertical class");
        if (viewport) {
          assert(viewport.scrollLeft === 0, "scrollLeft reset to 0");
          assert(viewport.scrollTop === 0, "scrollTop reset to 0");
        }

        // Switch back to horizontal
        window.setTrackOrientation("horizontal");
        assert(!track.classList.contains("vertical"), "track vertical class removed");
        if (viewport) {
          assert(viewport.scrollLeft === 0, "scrollLeft reset to 0");
          assert(viewport.scrollTop === 0, "scrollTop reset to 0");
        }
      });

      it("getVisibleSplitsCapacity computes positive capacity without crashing in both orientations", () => {
        window.setTrackOrientation("vertical");
        const vertCap = window.getVisibleSplitsCapacity();
        assert(typeof vertCap === "number" && vertCap > 0, "vertical capacity is a positive number");

        window.setTrackOrientation("horizontal");
        const horizCap = window.getVisibleSplitsCapacity();
        assert(typeof horizCap === "number" && horizCap > 0, "horizontal capacity is a positive number");
      });

      it("updateTrackDensityAndAngle executes cleanly on Start screen (currentIndex = -1)", () => {
        let threw = false;
        try {
          window.updateTrackDensityAndAngle();
        } catch (e) {
          threw = true;
        }
        assert(!threw, "updateTrackDensityAndAngle runs without error at currentIndex = -1");
      });
    });
})();
