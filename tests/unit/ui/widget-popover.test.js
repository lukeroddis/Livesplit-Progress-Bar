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

    it("stays on screen when it fits nowhere", () => {
      const placed = WP.placePopover(rect(0, 0, 800, 600), { width: 900, height: 700 }, { width: 900, height: 700 });
      assert(placed.left >= 8 && placed.top >= 8, "clamped to the margin");
      assert(placed.maxHeight >= 120, "keeps a usable height");
    });
  });

  describe("Widget Popover: controller", () => {
    const HTML = `
      <div id="hud-comp-wpt" class="hud-component" style="position: fixed; left: 10px; top: 10px; width: 100px; height: 40px;"></div>
      <div class="widget-popover" id="wp-test" data-widget="wpt" hidden>
        <button data-popover-close id="wp-x"></button>
        <input id="wp-input">
        <button data-popover-reset id="wp-reset"></button>
      </div>
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
