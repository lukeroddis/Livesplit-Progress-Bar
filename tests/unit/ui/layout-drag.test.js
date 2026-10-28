/**
 * Speedrun Overlay - Layout Pointer Drag & Scale Unit Tests
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

    it("clamps a whole box to the viewport, pinning oversized boxes to 0", () => {
      const clampBox = window.LiveSplit.LayoutDrag.clampBoxToViewport;
      assertEqual(clampBox(50, 60, 200, 100, 1000, 800), { x: 50, y: 60 }, "inside stays put");
      assertEqual(clampBox(950, 790, 200, 100, 1000, 800), { x: 800, y: 700 }, "right/bottom edges keep the box on screen");
      assertEqual(clampBox(-20, -5, 200, 100, 1000, 800), { x: 0, y: 0 }, "left/top edges");
      assertEqual(clampBox(300, 10, 1500, 100, 1000, 800), { x: 0, y: 10 }, "box wider than the screen pins to x = 0");
    });

    it("computes the largest scale that keeps a box on screen", () => {
      const maxFit = window.LiveSplit.LayoutDrag.maxScaleToFit;
      assertEqual(maxFit(0, 0, 100, 100, 1000, 800), 2.5, "never above 2.5x");
      assertEqual(maxFit(400, 0, 400, 50, 1000, 800), 1.5, "limited by the right edge");
      assertEqual(maxFit(0, 700, 100, 60, 1000, 800), 1.66, "limited by the bottom edge, floored");
      assertEqual(maxFit(950, 0, 400, 50, 1000, 800), 0.4, "never below 0.4x");
    });

    it("fits a track back on screen: floating ones move first, then shrink; docked ones only shrink", () => {
      const fit = window.LiveSplit.LayoutDrag.fitTrackBox;
      assertEqual(fit({ docked: "none", x: 100, y: 50, scale: 1 }, 400, 100, 1000, 800), { x: 100, y: 50, scale: 1 }, "already fits");
      assertEqual(fit({ docked: "none", x: 900, y: 750, scale: 1 }, 400, 100, 1000, 800), { x: 600, y: 700, scale: 1 }, "moved back on screen");
      assertEqual(fit({ docked: "none", x: 900, y: 0, scale: 2 }, 600, 100, 1000, 800), { x: 0, y: 0, scale: 1.66 }, "too big even at x=0: shrunk");
      assertEqual(fit({ docked: "left", x: 0, y: 0, scale: 2 }, 340, 800, 1000, 800), { x: 0, y: 0, scale: 1 }, "docked full height: back to 1x");
      assertEqual(fit({ docked: "bottom", x: 0, y: 710, scale: 0.8 }, 1000, 90, 1000, 800), { x: 0, y: 710, scale: 0.8 }, "a shrunk dock is left alone");
    });

    it("freezes only the track's stretched dimension", () => {
      const freeze = window.LiveSplit.LayoutDrag.freezeTrackSize;
      const el = { offsetWidth: 640, offsetHeight: 480 };
      const horiz = {};
      freeze(horiz, el, false);
      assertEqual(horiz, { width: 640 });
      const vert = {};
      freeze(vert, el, true);
      assertEqual(vert, { height: 480 });
      const unmeasured = { width: 300 };
      freeze(unmeasured, { offsetWidth: 0, offsetHeight: 0 }, false);
      assertEqual(unmeasured, { width: 300 }, "a hidden (0-size) element keeps the old size");
    });

    it("picks the dock edge from the half of the screen the track's centre is in", () => {
      const choose = window.LiveSplit.LayoutDrag.chooseDockSide;
      const rect = (left, top, width, height) => ({ left, top, width, height });
      assertEqual(choose(rect(0, 100, 1000, 80), 1000, 800, false), "top");
      assertEqual(choose(rect(0, 500, 1000, 80), 1000, 800, false), "bottom");
      assertEqual(choose(rect(100, 0, 340, 800), 1000, 800, true), "left");
      assertEqual(choose(rect(600, 0, 340, 800), 1000, 800, true), "right");
    });

    it("maps a saved dock to the edges this orientation can use", () => {
      const side = window.LiveSplit.LayoutDrag.effectiveDockSide;
      assertEqual(["top", "bottom", "left", "right"].map((d) => side(d, false)), ["top", "bottom", "bottom", "bottom"]);
      assertEqual(["top", "bottom", "left", "right"].map((d) => side(d, true)), ["left", "left", "left", "right"]);
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
      <div id="hud-comp-track" style="position: absolute; left: 0px; top: 300px; width: 600px; height: 60px;">
        <div class="hud-resize-handle"></div>
      </div>
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

    it("drags the horizontal track freely near the screen bottom without docking", () => withHud(({ dom, layout, down, move }) => {
      down(dom.el("hud-comp-track"), 10, 310);
      move(60, 99999);
      assertEqual(layout.track.docked, "none", "no bottom snap");
      assertEqual([layout.track.x, layout.track.y], [50, window.innerHeight - 60], "keeps its x, whole track clamped above the bottom");
      assertEqual(layout.track.width, 600, "width frozen so moving never resizes it");
      assertEqual(layout.track.height, undefined, "horizontal height stays content-sized");
    }));

    it("drags the vertical track freely along the side edges without docking", () => withHud(({ dom, layout, down, move }) => {
      down(dom.el("hud-comp-track"), 10, 310);
      move(-500, 210);
      assertEqual([layout.track.docked, layout.track.x, layout.track.y], ["none", 0, 200], "left edge keeps its height");
      move(5000, 210);
      assertEqual([layout.track.docked, layout.track.x, layout.track.y], ["none", Math.max(0, window.innerWidth - 600), 200], "whole track stays on screen at the right edge");
      assertEqual(layout.track.height, 60, "height frozen so moving never resizes it");
    }, { orientation: "vertical" }));

    it("keeps a scaled-up track fully on screen while dragging", () => withHud(({ dom, layout, down, move }) => {
      layout.track.scale = 1.5;
      down(dom.el("hud-comp-track"), 10, 310);
      move(99999, 99999);
      assertEqual([layout.track.x, layout.track.y],
        [Math.max(0, window.innerWidth - 900), Math.max(0, window.innerHeight - 90)], "clamped by its scaled 900x90 box");
    }));

    it("caps the floating track's scale so its resize handle stays on screen", () => withHud(({ dom, layout, down, move, up }) => {
      const track = dom.el("hud-comp-track");
      down(track.querySelector(".hud-resize-handle"), 600, 350);
      move(99999, 350);
      const cap = window.LiveSplit.LayoutDrag.maxScaleToFit(0, 300, 600, 60, window.innerWidth, window.innerHeight);
      assertEqual(layout.track.scale, cap, "scale capped at the largest size that fits");
      assertEqual(layout.track.width, 600, "scaling freezes the width too");
      up(99999, 350);

      layout.track.docked = "bottom";
      layout.track.scale = 1;
      down(track.querySelector(".hud-resize-handle"), 600, 350);
      move(99999, 350);
      assertEqual(layout.track.scale, window.LiveSplit.LayoutDrag.maxScaleToFit(0, 0, 600, 60, window.innerWidth, window.innerHeight),
        "a docked track is capped by its own size, wherever it sits");
    }));

    it("dragging a docked track floats it", () => withHud(({ dom, layout, down, move }) => {
      layout.track.docked = "left";
      down(dom.el("hud-comp-track"), 10, 310);
      move(20, 320);
      assertEqual(layout.track.docked, "none");
      assertEqual([layout.track.x, layout.track.y], [10, 310]);
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

    // Pins the fixture track at a screen position so the dock button can tell which half it is in
    function placeTrack(dom, left, top) {
      Object.assign(dom.el("hud-comp-track").style, { position: "fixed", left: `${left}px`, top: `${top}px` });
    }

    it("the dock button docks the horizontal track to the bottom when it sits low, and floats it back", () => withTrackRefreshStubs((calls) => withHud(({ dom, layout, log }) => {
      const btn = dom.el("btn-dock-track");
      placeTrack(dom, 0, window.innerHeight - 60);
      layout.track.width = 500;
      btn.click();
      assertEqual(layout.track.docked, "bottom");
      assertEqual([layout.track.x, layout.track.y], [0, Math.max(0, window.innerHeight - 90)]);
      btn.click();
      assertEqual(layout.track.docked, "none");
      assertEqual([layout.track.x, layout.track.y], [42, Math.max(0, window.innerHeight - 150)], "floats just above the bottom");
      assertEqual(layout.track.width, undefined, "floating from the dock fills to the right edge again");
      assertEqual(log.saves, 2);
      assertEqual(log.applied, ["track", "track"]);
      assertEqual(calls, ["refresh", "refresh"], "track re-rendered after each toggle");
    })));

    it("the dock button docks the horizontal track to the top when it sits high", () => withTrackRefreshStubs(() => withHud(({ dom, layout }) => {
      const btn = dom.el("btn-dock-track");
      placeTrack(dom, 0, 0);
      btn.click();
      assertEqual([layout.track.docked, layout.track.x, layout.track.y], ["top", 0, 0]);
      btn.click();
      assertEqual([layout.track.docked, layout.track.x, layout.track.y], ["none", 42, 80], "floats just below the top");
    })));

    it("the dock button docks the vertical track to the left or right, whichever half it is in", () => withTrackRefreshStubs(() => withHud(({ dom, layout }) => {
      const btn = dom.el("btn-dock-track");
      placeTrack(dom, 0, 0);
      layout.track.height = 400;
      btn.click();
      assertEqual([layout.track.docked, layout.track.x, layout.track.y], ["left", 0, 0]);
      btn.click();
      assertEqual([layout.track.docked, layout.track.x, layout.track.y], ["none", 42, 80]);
      assertEqual(layout.track.height, undefined, "floating from the dock fills downward again");

      placeTrack(dom, window.innerWidth - 300, 0);
      btn.click();
      assertEqual([layout.track.docked, layout.track.x, layout.track.y], ["right", Math.max(0, window.innerWidth - 340), 0]);
      btn.click();
      assertEqual([layout.track.docked, layout.track.x, layout.track.y], ["none", Math.max(0, window.innerWidth - 382), 80], "floats just inside the right edge");
    }, { orientation: "vertical" })));
  });
})();
