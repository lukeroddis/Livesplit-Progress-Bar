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
  describe("Layout Drag: pointer lifecycle on HUD components", () => {
    const { mountHtml, captureWindowListeners } = window.TestUtils;

    const HUD_HTML = `
      <div id="hud-comp-title" style="position: absolute; left: 100px; top: 50px; width: 200px; height: 60px;">
        <button data-action="toggle-visibility">eye</button>
        <input id="ld-test-input">
        <div class="hud-resize-handle"></div>
      </div>
      <div id="hud-comp-timers" style="position: absolute; left: 400px; top: 50px; width: 300px; height: 60px;"></div>
      <div id="hud-comp-track" style="position: absolute; left: 0px; top: 300px; width: 600px; height: 60px;"></div>
      <div id="hud-comp-leaderboard" style="position: absolute; left: 20px; top: 120px; width: 300px; height: 200px;">
        <div class="leaderboard-header">Standings <span class="leaderboard-status">LIVE</span><button id="ld-lb-btn">x</button></div>
      </div>
      <button id="btn-dock-track"></button>`;

    // Mounts the HUD, binds a drag engine with recording callbacks, captures window listeners
    function withHud(fn, { editMode = true, orientation = "horizontal" } = {}) {
      const dom = mountHtml(HUD_HTML);
      const layout = {
        title: { x: 100, y: 50, scale: 1, visible: true, docked: "none" },
        timers: { x: 400, y: 50, scale: 1, visible: true, docked: "none" },
        track: { x: 0, y: 300, scale: 1, visible: true, docked: "none" },
        leaderboard: { x: 20, y: 120, scale: 1, visible: true, docked: "none" }
      };
      const log = { applied: [], saves: 0, anchorSyncs: 0 };
      const style = { orientation };
      let edit = editMode;
      const engine = window.LiveSplit.LayoutDrag.createLayoutDrag({
        getLayoutState: () => layout,
        getCurrentTrackStyle: () => style,
        isEditMode: () => edit,
        saveLayout: () => { log.saves++; },
        applyComponentLayout: (id) => log.applied.push(id),
        syncTimerAnchorUI: () => { log.anchorSyncs++; }
      });
      const win = captureWindowListeners(() => engine.initPointerListeners());
      const at = (x, y) => ({ clientX: x, clientY: y, pointerId: 7 });
      const ctx = {
        dom, layout, log, style, engine,
        setEdit: (v) => { edit = v; },
        down: (el, x, y) => el.dispatchEvent(new PointerEvent("pointerdown", { ...at(x, y), bubbles: true, cancelable: true })),
        move: (x, y) => win.fire("pointermove", at(x, y)),
        up: (x, y) => win.fire("pointerup", at(x, y))
      };
      try {
        return fn(ctx);
      } finally {
        dom.remove();
      }
    }

    it("drags a component by the pointer delta and saves on release", () => withHud(({ dom, layout, log, engine, down, move, up }) => {
      const title = dom.el("hud-comp-title");
      down(title, 150, 70);
      assertEqual(engine.getActiveOp().type, "drag");
      assert(title.classList.contains("is-dragging"), "dragging class shown");

      move(180, 110);
      assertEqual([layout.title.x, layout.title.y], [130, 90], "moved by (+30, +40)");
      assertEqual(log.applied, ["title"]);

      move(-9999, -9999);
      assertEqual([layout.title.x, layout.title.y], [0, 0], "clamped to the viewport");

      up(0, 0);
      assertEqual(engine.getActiveOp(), null);
      assert(!title.classList.contains("is-dragging"), "dragging class cleared");
      assertEqual(log.saves, 1, "layout saved once on release");
      move(500, 500);
      assertEqual(layout.title.x, 0, "moves after release are ignored");
    }));

    it("ignores pointer downs outside edit mode or on controls", () => withHud(({ dom, engine, setEdit, down }) => {
      const title = dom.el("hud-comp-title");
      setEdit(false);
      down(title, 150, 70);
      assertEqual(engine.getActiveOp(), null, "not in edit mode");
      down(title.querySelector(".hud-resize-handle"), 150, 70);
      assertEqual(engine.getActiveOp(), null, "resize handle needs edit mode too");

      setEdit(true);
      down(title.querySelector("button"), 150, 70);
      down(dom.el("ld-test-input"), 150, 70);
      assertEqual(engine.getActiveOp(), null, "buttons and inputs never start a drag");
    }));

    it("scales a component from its resize handle, clamped to 0.4x-2.5x", () => withHud(({ dom, layout, log, engine, down, move, up }) => {
      const title = dom.el("hud-comp-title");
      down(title.querySelector(".hud-resize-handle"), 300, 100);
      assertEqual(engine.getActiveOp().type, "scale", "resize handle starts scaling, not dragging");
      assert(title.classList.contains("is-scaling"));

      move(390, 100);
      assertEqual(layout.title.scale, 1.5, "+90px is +0.5x");
      move(5000, 100);
      assertEqual(layout.title.scale, 2.5, "clamped to 2.5x");
      up(5000, 100);
      assert(!title.classList.contains("is-scaling"));
      assertEqual(log.saves, 1);
    }));

    it("dragging the timers keeps a right offset and re-syncs the anchor UI", () => withHud(({ dom, layout, log, down, move, up }) => {
      down(dom.el("hud-comp-timers"), 450, 70);
      move(400, 70);
      assertEqual(layout.timers.x, 350);
      assertEqual(layout.timers.right, Math.max(0, window.innerWidth - (350 + 300)), "right edge offset tracked");
      up(400, 70);
      assertEqual(log.anchorSyncs, 1);
    }));

    it("snaps the horizontal track to the bottom dock near the screen bottom", () => withHud(({ dom, layout, down, move }) => {
      down(dom.el("hud-comp-track"), 10, 310);
      move(10, 310 + window.innerHeight);
      assertEqual(layout.track.docked, "bottom");
      assertEqual([layout.track.x, layout.track.y], [0, window.innerHeight - 90]);
      move(10, 10);
      assertEqual(layout.track.docked, "none", "undocks when dragged to the top");
    }));

    it("snaps the vertical track to the left or right dock", () => withHud(({ dom, layout, down, move }) => {
      down(dom.el("hud-comp-track"), 10, 310);
      move(-500, 310);
      assertEqual(layout.track.docked, "left");
      move(5000, 310);
      assertEqual(layout.track.docked, "right");
    }, { orientation: "vertical" }));

    it("the leaderboard header drags even outside edit mode, except from its controls", () => withHud(({ dom, layout, engine, down, move, up }) => {
      const header = dom.root.querySelector(".leaderboard-header");
      down(dom.root.querySelector(".leaderboard-status"), 30, 130);
      down(dom.el("ld-lb-btn"), 30, 130);
      assertEqual(engine.getActiveOp(), null, "status badge and buttons do not drag");

      down(header, 30, 130);
      assertEqual(engine.getActiveOp().compId, "leaderboard");
      move(60, 150);
      assertEqual([layout.leaderboard.x, layout.leaderboard.y], [50, 140]);
      up(60, 150);
      assert(!dom.el("hud-comp-leaderboard").classList.contains("is-dragging"));
    }, { editMode: false }));

    it("the visibility toggle flips a component and saves", () => withHud(({ dom, layout, log }) => {
      dom.root.querySelector('[data-action="toggle-visibility"]').click();
      assertEqual(layout.title.visible, false);
      assertEqual(log.applied, ["title"]);
      assertEqual(log.saves, 1);
    }));

    function withTrackRefreshStubs(fn) {
      const calls = [];
      return window.TestUtils.stubOverlay({ refreshTrack: () => calls.push("refresh") }, () => fn(calls));
    }

    it("the dock button toggles the horizontal track between bottom dock and floating", () => withTrackRefreshStubs((calls) => withHud(({ dom, layout, log }) => {
      const btn = dom.el("btn-dock-track");
      btn.click();
      assertEqual(layout.track.docked, "bottom");
      assertEqual([layout.track.x, layout.track.y], [0, Math.max(0, window.innerHeight - 90)]);
      btn.click();
      assertEqual(layout.track.docked, "none");
      assertEqual([layout.track.x, layout.track.y], [42, Math.max(0, window.innerHeight - 150)]);
      assertEqual(log.saves, 2);
      assertEqual(log.applied, ["track", "track"]);
      assertEqual(calls, ["refresh", "refresh"], "track re-rendered after each toggle");
    })));

    it("the dock button toggles the vertical track between left dock and floating", () => withTrackRefreshStubs(() => withHud(({ dom, layout }) => {
      const btn = dom.el("btn-dock-track");
      btn.click();
      assertEqual([layout.track.docked, layout.track.x, layout.track.y], ["left", 0, 0]);
      btn.click();
      assertEqual([layout.track.docked, layout.track.x, layout.track.y], ["none", 42, 80]);
    }, { orientation: "vertical" })));
  });
})();
