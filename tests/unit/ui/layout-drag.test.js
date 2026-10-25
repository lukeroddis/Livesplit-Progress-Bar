/**
 * LiveSplit Progress Bar - Layout Pointer Drag & Scale Unit Tests
 */

(function () {
  "use strict";

  describe("Layout Pointer Drag & Scale Engine (LiveSplit.LayoutDrag)", () => {
    it("exposes LiveSplit.LayoutDrag namespace, calculation helpers, and factory", () => {
      assert(window.LiveSplit, "window.LiveSplit namespace should exist");
      assert(window.LiveSplit.LayoutDrag, "window.LiveSplit.LayoutDrag should exist");
      assertEqual(typeof window.LiveSplit.LayoutDrag.createLayoutDrag, "function", "createLayoutDrag is a function");
      assertEqual(typeof window.LiveSplit.LayoutDrag.clampCoordinates, "function", "clampCoordinates is a function");
      assertEqual(typeof window.LiveSplit.LayoutDrag.computeScale, "function", "computeScale is a function");
      assertEqual(typeof window.LiveSplit.LayoutDrag.computeTrackDocking, "function", "computeTrackDocking is a function");
    });

    it("clamps drag coordinates within viewport bounds", () => {
      const clamp = window.LiveSplit.LayoutDrag.clampCoordinates;

      // Viewport 1000x800
      // Normal within bounds
      const resNormal = clamp(100, 100, 50, 50, 1000, 800);
      assertEqual(resNormal.x, 150, "normal x inside bounds");
      assertEqual(resNormal.y, 150, "normal y inside bounds");

      // Negative values clamped to 0
      const resNeg = clamp(50, 50, -100, -100, 1000, 800);
      assertEqual(resNeg.x, 0, "negative x clamped to 0");
      assertEqual(resNeg.y, 0, "negative y clamped to 0");

      // Exceeding viewport clamped to w - 80 and h - 50
      const resMax = clamp(900, 750, 200, 200, 1000, 800);
      assertEqual(resMax.x, 920, "x clamped to 1000 - 80 = 920");
      assertEqual(resMax.y, 750, "y clamped to 800 - 50 = 750");
    });

    it("computes proportional scale clamped between 0.4x and 2.5x", () => {
      const scaleFn = window.LiveSplit.LayoutDrag.computeScale;

      // 1.0 + (180 / 180) = 2.0
      assertEqual(scaleFn(1.0, 180), 2.0, "scale increases by 1.0 at +180px");

      // Lower bound clamped to 0.4
      assertEqual(scaleFn(1.0, -200), 0.4, "scale clamped to min 0.4");

      // Upper bound clamped to 2.5
      assertEqual(scaleFn(2.0, 300), 2.5, "scale clamped to max 2.5");
    });

    it("resolves track docking and snapping for horizontal and vertical modes", () => {
      const dockFn = window.LiveSplit.LayoutDrag.computeTrackDocking;

      // Horizontal: y >= h - 140 -> docked bottom
      // w = 1920, h = 1080. h - 140 = 940
      const horizDocked = dockFn(150, 960, 1920, 1080, false);
      assertEqual(horizDocked.docked, "bottom", "horizontal docked to bottom");
      assertEqual(horizDocked.x, 0, "x snapped to 0");
      assertEqual(horizDocked.y, 990, "y snapped to 1080 - 90 = 990");

      const horizFree = dockFn(150, 400, 1920, 1080, false);
      assertEqual(horizFree.docked, "none", "horizontal free floating");
      assertEqual(horizFree.x, 150, "x preserved");
      assertEqual(horizFree.y, 400, "y preserved");

      // Vertical: x <= 100 -> docked left
      const vertLeft = dockFn(50, 200, 1920, 1080, true);
      assertEqual(vertLeft.docked, "left", "vertical docked to left");
      assertEqual(vertLeft.x, 0, "x snapped to 0");
      assertEqual(vertLeft.y, 0, "y snapped to 0");

      // Vertical: x >= w - 380 (1920 - 380 = 1540) -> docked right
      const vertRight = dockFn(1600, 200, 1920, 1080, true);
      assertEqual(vertRight.docked, "right", "vertical docked to right");
      assertEqual(vertRight.x, 1580, "x snapped to 1920 - 340 = 1580");
      assertEqual(vertRight.y, 0, "y snapped to 0");
    });

    it("initializes drag engine and manages active pointer operation", () => {
      let isEditing = true;
      const mockLayoutState = {
        title: { x: 50, y: 50, scale: 1, docked: "none", visible: true }
      };

      const engine = window.LiveSplit.LayoutDrag.createLayoutDrag({
        getLayoutState: () => mockLayoutState,
        isEditMode: () => isEditing,
        components: ["title"]
      });

      assertEqual(engine.getActiveOp(), null, "initial activeOp is null");
    });
  });
})();
