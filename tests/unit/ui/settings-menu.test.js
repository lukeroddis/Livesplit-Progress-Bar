/**
 * tests/unit/ui/settings-menu.test.js
 * LiveSplit.SettingsMenu: open/close toggle, header drag with viewport clamping,
 * position persistence, double-click reset and resize re-clamping.
 */

(function () {
  "use strict";

  const { mountHtml, captureWindowListeners } = window.TestUtils;
  const Menu = () => window.LiveSplit.SettingsMenu;
  const POS_KEY = window.LiveSplit.Storage.KEYS.SETTINGS_POS;

  const PANEL_HTML = `
    <div id="footer-bar" style="position: fixed; left: 100px; top: 100px; width: 300px; height: 200px;">
      <div class="settings-menu-header" style="height: 30px;">
        <span class="title">Settings</span>
        <button id="sm-test-btn">x</button>
      </div>
    </div>`;

  function withPanel(fn) {
    const savedPos = localStorage.getItem(POS_KEY);
    localStorage.removeItem(POS_KEY);
    const dom = mountHtml(PANEL_HTML);
    const header = dom.root.querySelector(".settings-menu-header");
    // Synthetic pointer ids are not active pointers, so capture would throw
    header.setPointerCapture = () => {};
    header.releasePointerCapture = () => {};
    try {
      return fn({ dom, panel: dom.el("footer-bar"), header });
    } finally {
      dom.remove();
      if (savedPos === null) localStorage.removeItem(POS_KEY); else localStorage.setItem(POS_KEY, savedPos);
    }
  }

  const pointer = (type, target, x, y) =>
    target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true, cancelable: true }));

  describe("Settings Menu (LiveSplit.SettingsMenu)", () => {
    it("toggles the quick settings menu open and closed", () => {
      const dom = mountHtml('<div id="quick-settings-wrap"></div><button id="settings-trigger-pill"></button>');
      try {
        const wrap = dom.el("quick-settings-wrap");
        const pill = dom.el("settings-trigger-pill");
        Menu().toggleSettingsMenu();
        assert(wrap.classList.contains("menu-open"), "opens");
        assertEqual(pill.getAttribute("aria-pressed"), "true");
        Menu().toggleSettingsMenu();
        assert(!wrap.classList.contains("menu-open"), "closes");
        assertEqual(pill.getAttribute("aria-pressed"), "false");
        Menu().toggleSettingsMenu(false);
        assert(!wrap.classList.contains("menu-open"), "forced closed stays closed");
        Menu().toggleSettingsMenu(true);
        assert(pill.classList.contains("is-pressed"), "forced open");
      } finally {
        dom.remove();
      }
    });

    it("dragging the header moves the panel, clamps it on screen and saves the position", () => withPanel(({ panel, header }) => {
      captureWindowListeners(() => Menu().initSettingsMenuDraggable());
      const title = header.querySelector(".title");
      pointer("pointerdown", title, 150, 110);
      assert(panel.classList.contains("is-dragging"), "dragging state shown");
      assert(panel.classList.contains("is-custom-pos"), "switched to a custom position");

      pointer("pointermove", title, 200, 160);
      assertEqual(panel.style.left, "150px", "moved right by 50");
      assertEqual(panel.style.top, "150px", "moved down by 50");

      pointer("pointermove", title, -5000, -5000);
      assertEqual(panel.style.left, "10px", "clamped to the left margin");
      assertEqual(panel.style.top, "10px", "clamped to the top margin");

      pointer("pointerup", title, -5000, -5000);
      assert(!panel.classList.contains("is-dragging"), "drag ended");
      assertEqual(JSON.parse(localStorage.getItem(POS_KEY)), { left: 10, top: 10 }, "position saved");

      pointer("pointermove", title, 400, 400);
      assertEqual(panel.style.left, "10px", "moves after pointerup are ignored");
    }));

    it("ignores drags that start on header buttons", () => withPanel(({ panel, dom }) => {
      captureWindowListeners(() => Menu().initSettingsMenuDraggable());
      pointer("pointerdown", dom.el("sm-test-btn"), 150, 110);
      assert(!panel.classList.contains("is-dragging"), "button press does not start a drag");
    }));

    it("double-clicking the header resets to the default position", () => withPanel(({ panel, header }) => {
      localStorage.setItem(POS_KEY, JSON.stringify({ left: 50, top: 60 }));
      captureWindowListeners(() => Menu().initSettingsMenuDraggable());
      assert(panel.classList.contains("is-custom-pos"), "saved position restored on init");
      header.querySelector(".title").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      assert(!panel.classList.contains("is-custom-pos"), "custom position cleared");
      assertEqual(panel.style.left, "");
      assertEqual(localStorage.getItem(POS_KEY), null, "saved position removed");
    }));

    it("restores a saved position clamped to the viewport and ignores bad data", () => withPanel(({ panel }) => {
      localStorage.setItem(POS_KEY, JSON.stringify({ left: 99999, top: -50 }));
      Menu().restoreSettingsMenuPosition();
      assertEqual(panel.style.left, `${Math.max(10, window.innerWidth - 480)}px`, "left clamped");
      assertEqual(panel.style.top, "10px", "top clamped");

      Menu().resetSettingsMenuPosition();
      localStorage.setItem(POS_KEY, "{not json");
      const realWarn = console.warn;
      console.warn = () => {};
      try {
        Menu().restoreSettingsMenuPosition();
      } finally {
        console.warn = realWarn;
      }
      assert(!panel.classList.contains("is-custom-pos"), "corrupt position ignored");
    }));

    it("re-clamps a custom position when the window resizes", () => withPanel(({ panel }) => {
      const win = captureWindowListeners(() => Menu().initSettingsMenuDraggable());
      panel.classList.add("is-custom-pos");
      panel.style.left = "-200px";
      panel.style.top = "-200px";
      win.fire("resize");
      assertEqual(panel.style.left, "10px");
      assertEqual(panel.style.top, "10px");
    }));
  });
})();
