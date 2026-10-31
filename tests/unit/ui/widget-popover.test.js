/**
 * tests/unit/ui/widget-popover.test.js
 * LiveSplit.WidgetPopover: placement beside a widget (side choice, clamping, height
 * limits) and the popover controller (open / toggle / close buttons / reset / outside
 * clicks / repositioning) over a mounted widget and popover.
 */

(function () {
  "use strict";

  const { mountHtml } = window.TestUtils;
  const WP = window.LiveSplit.WidgetPopover;
  const VIEW = { width: 1920, height: 1080 };
  const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });
  const SIZE = { width: 360, height: 500 };

  describe("Widget Popover: placement", () => {
    it("puts it on the roomiest side it fits on", () => {
      assertEqual(WP.placePopover(rect(100, 300, 300, 100), SIZE, VIEW).side, "right", "small widget on the left");
      assertEqual(WP.placePopover(rect(1500, 300, 300, 100), SIZE, VIEW).side, "left", "small widget on the right");
    });

    it("goes above a bottom-docked full-width track, capped to the room there", () => {
      const placed = WP.placePopover(rect(0, 880, 1920, 200), SIZE, VIEW);
      assertEqual(placed.side, "above");
      assertEqual(placed.maxHeight, 880 - 12 - 8, "the room above the track");
      assertEqual(placed.top + SIZE.height, 880 - 12, "bottom edge a gap above the track");
    });

    it("goes beside a vertical track docked to the left, at full height", () => {
      const placed = WP.placePopover(rect(0, 0, 340, 1080), SIZE, VIEW);
      assertEqual(placed.side, "right");
      assertEqual(placed.left, 340 + 12);
      assertEqual(placed.maxHeight, 1080 - 16);
      assertEqual(placed.top, 8, "clamped inside the screen");
    });

    it("keeps clear of a bar along the top (the Layout toolbar)", () => {
      const placed = WP.placePopover(rect(0, 880, 1920, 200), SIZE, Object.assign({ top: 70 }, VIEW));
      assertEqual(placed.side, "above");
      assertEqual(placed.maxHeight, 880 - 12 - 78, "the room between the toolbar and the track");
      const beside = WP.placePopover(rect(0, 0, 340, 1080), SIZE, Object.assign({ top: 70 }, VIEW));
      assertEqual(beside.top, 78, "clamped below the toolbar");
    });

    it("centres it when its widget is not on screen", () => {
      const placed = WP.placePopover(rect(0, 0, 0, 0), SIZE, VIEW);
      assertEqual(placed.side, "center");
      assertEqual([placed.left, placed.top], [(1920 - 360) / 2, (1080 - 500) / 2]);
      assertEqual(WP.placePopover(null, SIZE, VIEW).side, "center", "no widget at all");
    });

    it("stays on screen when it fits nowhere", () => {
      const placed = WP.placePopover(rect(0, 0, 800, 600), { width: 900, height: 700 }, { width: 900, height: 700 });
      assert(placed.left >= 8 && placed.top >= 8, "clamped to the margin");
      assert(placed.maxHeight >= 120, "keeps a usable height");
    });
  });

  describe("Widget Popover: moved / resized boxes", () => {
    const VIEWPORT = { width: 1280, height: 720, top: 70 };

    it("keeps a box inside the screen and below the toolbar", () => {
      assertEqual(WP.clampBox({ left: 2000, top: -50, width: 300, height: 200 }, VIEWPORT),
        { left: 1280 - 300 - 8, top: 78, width: 300, height: 200 });
    });

    it("keeps a box between the minimum size and the screen size", () => {
      const tiny = WP.clampBox({ left: 100, top: 100, width: 50, height: 20 }, VIEWPORT);
      assertEqual([tiny.width, tiny.height], [260, 160]);
      const huge = WP.clampBox({ left: 0, top: 0, width: 5000, height: 5000 }, VIEWPORT);
      assertEqual([huge.width, huge.height, huge.left, huge.top], [1280 - 16, 720 - 78 - 8, 8, 78]);
    });
  });

  describe("Widget Popover: controller", () => {
    const HTML = `
      <div id="hud-comp-wpt" class="hud-component" style="position: fixed; left: 10px; top: 10px; width: 100px; height: 40px;"></div>
      <div class="widget-popover" id="wp-test" data-widget="wpt" hidden style="width: 300px; height: 240px;">
        <div class="widget-popover-header" id="wp-header"><span id="wp-title">Title</span><button data-popover-close id="wp-x"></button></div>
        <input id="wp-input">
        <button data-popover-reset id="wp-reset"></button>
      </div>
      <div class="widget-popover" id="wp-anchored" data-widget="wpt-extra" data-anchor="wpt" hidden style="width: 300px; height: 200px;"></div>
      <div id="wp-outside"></div>`;

    function withPopovers(fn) {
      const dom = mountHtml(HTML);
      const log = [];
      const popovers = WP.createWidgetPopovers({
        onOpen: (id) => log.push(["open", id]),
        onClose: (id) => log.push(["close", id]),
        onReset: (id) => log.push(["reset", id])
      });
      popovers.bind();
      const pointerdown = (el) => el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      try {
        return fn({ dom, el: dom.el, popovers, log, pointerdown });
      } finally {
        popovers.close();
        dom.remove();
      }
    }

    it("opens beside its widget and syncs, and the cog toggles it closed", () => withPopovers(({ el, popovers, log }) => {
      assert(popovers.open("wpt"));
      const pop = el("wp-test");
      assert(!pop.hidden, "shown");
      assertEqual(popovers.getOpenWidget(), "wpt");
      assert(pop.style.left.endsWith("px") && pop.style.top.endsWith("px"), "positioned");
      assert(pop.dataset.side, "side recorded");
      assertEqual(log, [["open", "wpt"]]);

      popovers.toggle("wpt");
      assert(pop.hidden && !popovers.isOpen(), "second cog click closes");
      assertEqual(log.pop(), ["close", "wpt"]);
      assert(!popovers.open("nope"), "widgets without a popover report false");
    }));

    it("a popover with data-anchor sits beside that widget instead of its own", () => withPopovers(({ el, popovers }) => {
      popovers.open("wpt-extra");
      const pop = el("wp-anchored");
      assert(pop.dataset.side !== "center", "placed beside the anchor widget, not centred");
      assertEqual(popovers.getOpenWidget(), "wpt-extra");
    }));

    it("closes from its close button and resets through onReset", () => withPopovers(({ el, popovers, log }) => {
      popovers.open("wpt");
      el("wp-reset").click();
      assertEqual(log.pop(), ["reset", "wpt"]);
      el("wp-x").click();
      assert(!popovers.isOpen());
      assertEqual(log.pop(), ["close", "wpt"]);
    }));

    it("clicks outside close it; clicks inside it or on HUD widgets do not", () => withPopovers(({ el, popovers, pointerdown }) => {
      popovers.open("wpt");
      pointerdown(el("wp-input"));
      pointerdown(el("hud-comp-wpt"));
      assert(popovers.isOpen(), "still open");
      pointerdown(el("wp-outside"));
      assert(!popovers.isOpen(), "closed by an outside click");
    }));

    // Fires a pointer drag on an element (the handlers listen on the element itself)
    const drag = (target, dx, dy) => {
      const r = target.getBoundingClientRect();
      const at = (x, y) => ({ bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y });
      target.dispatchEvent(new PointerEvent("pointerdown", at(r.left + 5, r.top + 5)));
      target.dispatchEvent(new PointerEvent("pointermove", at(r.left + 5 + dx, r.top + 5 + dy)));
      target.dispatchEvent(new PointerEvent("pointerup", at(r.left + 5 + dx, r.top + 5 + dy)));
    };

    it("drags by the header and resizes from the grip, keeping both when reopened", () => withPopovers(({ el, popovers }) => {
      popovers.open("wpt");
      const pop = el("wp-test");
      const before = pop.getBoundingClientRect();
      // The same screen area the controller uses (the test window may be small, so boxes get clamped)
      const toolbar = document.getElementById("layout-toolbar");
      const top = toolbar && document.body.classList.contains("edit-mode") ? toolbar.offsetTop + toolbar.offsetHeight : 0;
      const viewport = { width: window.innerWidth, height: window.innerHeight, top };
      drag(el("wp-header"), 120, 60);
      assertEqual(pop.dataset.side, "manual");
      const moved = WP.clampBox({ left: before.left + 120, top: before.top + 60, width: before.width, height: before.height }, viewport);
      assertEqual([parseFloat(pop.style.left), parseFloat(pop.style.top)], [moved.left, moved.top], "moved with the pointer");
      assert(!pop.classList.contains("is-moving"), "drag finished");

      drag(pop.querySelector(".widget-popover-resize"), 40, 30);
      const sized = WP.clampBox({ left: moved.left, top: moved.top, width: moved.width + 40, height: moved.height + 30 }, viewport);
      assertEqual([parseFloat(pop.style.width), parseFloat(pop.style.height)], [sized.width, sized.height], "resized");

      const box = [pop.style.left, pop.style.top, pop.style.width, pop.style.height];
      popovers.close();
      popovers.open("wpt");
      assertEqual([pop.style.left, pop.style.top, pop.style.width, pop.style.height], box, "same place and size when reopened");
    }));

    it("double-clicking the header puts it back beside its widget; buttons in the header do not drag", () => withPopovers(({ el, popovers }) => {
      popovers.open("wpt");
      const pop = el("wp-test");
      const auto = [pop.style.left, pop.style.top];
      drag(el("wp-x"), 200, 200);
      assertEqual([pop.style.left, pop.style.top], auto, "the close button is not a drag handle");
      drag(el("wp-title"), 200, 100);
      assert(pop.style.left !== auto[0], "moved");
      el("wp-header").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      assertEqual([pop.style.left, pop.style.top], auto, "back beside the widget");
      assert(pop.dataset.side !== "manual");
    }));

    it("repositions on the next frame after a change inside it", async () => {
      const dom = mountHtml(HTML);
      const popovers = WP.createWidgetPopovers();
      popovers.bind();
      try {
        popovers.open("wpt");
        const anchor = dom.el("hud-comp-wpt");
        const before = dom.el("wp-test").style.left;
        anchor.style.left = "600px";
        dom.el("wp-input").dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((r) => requestAnimationFrame(() => r()));
        assert(dom.el("wp-test").style.left !== before, "followed the widget");
      } finally {
        popovers.close();
        dom.remove();
      }
    });
  });
})();
