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
    <button class="preset-pill-btn" data-preset-bg="0"></button>
    <button class="preset-pill-btn" data-preset-bg="55"></button>
    <button class="preset-pill-btn" data-preset-bg="80"></button>
    <button class="preset-pill-btn" data-preset-bg="oops"></button>
    <input type="checkbox" id="cb-bg-title"><input type="checkbox" id="cb-bg-timers"><input type="checkbox" id="cb-bg-track">
    <button id="bg-opacity-badge"></button>`;

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
      return fn({ dom, panel, log, style, el: dom.el, pill: (v) => dom.root.querySelector(`[data-preset-bg="${v}"]`), setStyle: (s) => { current = s; } });
    } finally {
      dom.remove();
    }
  }

  describe("Settings Background Panel (LiveSplit.SettingsBackgroundPanel)", () => {
    it("syncs defaults: 55% opacity, 8px blur, all plates on", () => withPanel(({ panel, el, pill }) => {
      panel.sync({});
      assertEqual(el("val-bg-opacity").innerText, "55%");
      assertEqual(el("val-bg-blur").innerText, "8px");
      assert(pill(55).classList.contains("active") && !pill(80).classList.contains("active"), "55% preset active");
      assert(el("cb-bg-title").checked && el("cb-bg-timers").checked && el("cb-bg-track").checked, "plates default on");
      assertEqual(el("bg-opacity-badge").innerText, "BG: 55%");
    }));

    it("syncs an Off background and disabled plates", () => withPanel(({ panel, el, pill }) => {
      panel.sync({ bgOpacity: 0, bgBlur: 12, bgTimers: false });
      assertEqual(el("val-bg-opacity").innerText, "0% (Off)");
      assertEqual(el("val-bg-blur").innerText, "12px");
      assert(pill(0).classList.contains("active"));
      assert(!el("cb-bg-timers").checked && el("cb-bg-track").checked, "only timers plate off");
      assertEqual(el("bg-opacity-badge").innerText, "BG: Off");
    }));

    it("preset pills set the opacity and save; invalid presets are ignored", () => withPanel(({ panel, log, style, pill }) => {
      panel.bind();
      pill(80).click();
      assertEqual(style.bgOpacity, 80);
      assertEqual([log.applied, log.saved], [1, 1]);
      pill("oops").click();
      assertEqual(style.bgOpacity, 80, "non-numeric preset does nothing");
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

    it("the footer badge cycles 55 -> 80 -> Off -> 35 -> 55, and resets unknown values to 55", () => withPanel(({ panel, style, el }) => {
      panel.bind();
      const badge = el("bg-opacity-badge");
      const seen = [];
      for (let i = 0; i < 4; i++) { badge.click(); seen.push(style.bgOpacity); }
      assertEqual(seen, [80, 0, 35, 55]);
      style.bgOpacity = 42;
      badge.click();
      assertEqual(style.bgOpacity, 55, "custom value resets to the default");
    }));

    it("does nothing while no track style is loaded", () => withPanel(({ panel, log, el, pill, setStyle }) => {
      panel.bind();
      setStyle(null);
      pill(80).click();
      el("bg-opacity-badge").click();
      const cb = el("cb-bg-title");
      cb.checked = false;
      cb.dispatchEvent(new Event("change"));
      assertEqual([log.applied, log.saved], [0, 0]);
    }));
  });
})();
