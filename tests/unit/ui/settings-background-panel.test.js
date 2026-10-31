/**
 * tests/unit/ui/settings-background-panel.test.js
 * LiveSplit.SettingsBackgroundPanel: opacity / blur sliders, preset pills,
 * per-component background toggles and the footer BG badge preset cycle.
 */

(function () {
  "use strict";

  const { mountHtml } = window.TestUtils;

  const PANEL_HTML = `
    <input type="range" id="slider-bg-opacity" min="0" max="95"><span id="val-bg-opacity"></span>
    <input type="range" id="slider-bg-blur" min="0" max="20"><span id="val-bg-blur"></span>
    <input type="checkbox" id="cb-bg-title"><input type="checkbox" id="cb-bg-timers"><input type="checkbox" id="cb-bg-track">`;

  function withPanel(fn, style = {}) {
    const dom = mountHtml(PANEL_HTML);
    const log = { applied: 0, saved: 0 };
    let current = style;
    const panel = window.LiveSplit.SettingsBackgroundPanel.createBackgroundPanel({
      getCurrentTrackStyle: () => current,
      applyTrackStyle: () => { log.applied++; },
      saveTrackStyle: () => { log.saved++; }
    });
    try {
      return fn({ dom, panel, log, style, el: dom.el, setStyle: (s) => { current = s; } });
    } finally {
      dom.remove();
    }
  }

  describe("Settings Background Panel (LiveSplit.SettingsBackgroundPanel)", () => {
    it("syncs defaults: 55% opacity, 8px blur, all plates on", () => withPanel(({ panel, el }) => {
      panel.sync({});
      assertEqual(el("val-bg-opacity").innerText, "55%");
      assertEqual(el("val-bg-blur").innerText, "8px");
      assert(el("cb-bg-title").checked && el("cb-bg-timers").checked && el("cb-bg-track").checked, "plates default on");
    }));

    it("syncs an Off background and disabled plates", () => withPanel(({ panel, el }) => {
      panel.sync({ bgOpacity: 0, bgBlur: 12, bgTimers: false });
      assertEqual(el("val-bg-opacity").innerText, "0% (Off)");
      assertEqual(el("val-bg-blur").innerText, "12px");
      assert(!el("cb-bg-timers").checked && el("cb-bg-track").checked, "only timers plate off");
    }));

    it("sliders preview live and save on change", () => withPanel(({ panel, log, style, el }) => {
      panel.bind();
      const blur = el("slider-bg-blur");
      blur.value = "15";
      blur.dispatchEvent(new Event("input"));
      assertEqual(style.bgBlur, 15);
      assertEqual(el("val-bg-blur").innerText, "15px");
      blur.dispatchEvent(new Event("change"));
      assertEqual(log.saved, 1);
    }));

    it("plate checkboxes toggle each component's background", () => withPanel(({ panel, log, style, el }) => {
      panel.bind();
      const cb = el("cb-bg-track");
      cb.checked = false;
      cb.dispatchEvent(new Event("change"));
      assertEqual(style.bgTrack, false);
      assertEqual([log.applied, log.saved], [1, 1]);
    }));

    it("does nothing while no track style is loaded", () => withPanel(({ panel, log, el, setStyle }) => {
      panel.bind();
      setStyle(null);
      const cb = el("cb-bg-title");
      cb.checked = false;
      cb.dispatchEvent(new Event("change"));
      assertEqual([log.applied, log.saved], [0, 0]);
    }));
  });
})();
