/**
 * tests/unit/ui/settings-track-panel.test.js
 * LiveSplit.SettingsTrackPanel: orientation (segmented + badge + hint), name / delta
 * positions kept opposite in 40° angle mode, split angle, size sliders, visible split
 * spin boxes and "Always Show Last Split".
 */

(function () {
  "use strict";

  const { mountHtml, stubOverlay } = window.TestUtils;
  const KEYS = window.LiveSplit.Storage.KEYS;

  const seg = (id, vals, cls = () => "") =>
    `<div id="${id}">${vals.map((v) => `<button class="seg-btn ${cls(v)}" data-val="${v}"></button>`).join("")}</div>`;
  const posClass = (v) => (v === "top" || v === "bottom" ? "seg-btn-horiz" : "seg-btn-vert");

  const PANEL_HTML = `
    <div id="track"></div>
    ${seg("ctrl-track-orient", ["horizontal", "vertical"])}
    <div id="opposing-hint"></div>
    ${seg("ctrl-name-pos", ["top", "bottom", "left", "right"], posClass)}
    ${seg("ctrl-delta-pos", ["top", "bottom", "left", "right"], posClass)}
    ${seg("ctrl-modal-angle", ["auto", "angled", "flat"])}
    <select id="select-split-angle"><option value="auto">auto</option><option value="angled">angled</option><option value="flat">flat</option></select>
    <input type="range" id="slider-name-font"><span id="val-name-font"></span>
    <input type="range" id="slider-delta-font"><span id="val-delta-font"></span>
    <input type="range" id="slider-bar-height"><span id="val-bar-height"></span>
    <input type="range" id="slider-dot-size"><span id="val-dot-size"></span>
    <button id="btn-splits-dec"></button><input id="input-visible-splits"><button id="btn-splits-inc"></button>
    <button id="btn-splits-fit-all"></button><button id="btn-splits-auto"></button>
    <input type="checkbox" id="cb-always-show-last-split">`;

  const TOUCHED_KEYS = [KEYS.SPLIT_ANGLE, KEYS.VISIBLE_SPLITS, KEYS.ALWAYS_SHOW_LAST];

  function withPanel(fn, styleOverrides = {}) {
    const dom = mountHtml(PANEL_HTML);
    const saved = TOUCHED_KEYS.map((k) => [k, localStorage.getItem(k)]);
    TOUCHED_KEYS.forEach((k) => localStorage.removeItem(k));
    const style = Object.assign({ orientation: "horizontal", namePos: "top", deltaPos: "bottom", nameFontSize: 17, deltaFontSize: 15, barHeight: 6, dotSize: 15 }, styleOverrides);
    const log = { applied: 0, saved: 0, orientation: [], visible: [], density: 0, refresh: 0 };
    const panel = window.LiveSplit.SettingsTrackPanel.createTrackPanel({
      getCurrentTrackStyle: () => style,
      applyTrackStyle: () => { log.applied++; },
      saveTrackStyle: () => { log.saved++; },
      setTrackOrientation: (o) => log.orientation.push(o),
      setVisibleSplits: (v) => { log.visible.push(v); localStorage.setItem(KEYS.VISIBLE_SPLITS, String(v)); }
    });
    const click = (group, val) => dom.root.querySelector(`#${group} [data-val="${val}"]`).click();
    const active = (group) => dom.root.querySelector(`#${group} .seg-btn.active`)?.getAttribute("data-val");
    try {
      return stubOverlay({
        updateTrackDensityAndAngle: () => { log.density++; },
        refreshTrack: () => { log.refresh++; }
      }, () => fn({ dom, el: dom.el, panel, style, log, click, active }));
    } finally {
      dom.remove();
      saved.forEach(([k, v]) => (v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v)));
    }
  }

  describe("Settings Track Panel (LiveSplit.SettingsTrackPanel)", () => {
    it("syncs a horizontal track: segments, badge, Top/Bottom buttons, sliders and defaults", () => withPanel(({ dom, el, panel, active }) => {
      panel.sync({ orientation: "horizontal", namePos: "top", deltaPos: "bottom", nameFontSize: 17, deltaFontSize: 15, barHeight: 6, dotSize: 15 });
      assertEqual(active("ctrl-track-orient"), "horizontal");
      assertEqual(active("ctrl-name-pos"), "top");
      assertEqual(active("ctrl-delta-pos"), "bottom");
      assertEqual(active("ctrl-modal-angle"), "auto");
      assertEqual(el("select-split-angle").value, "auto");
      assertEqual(el("opposing-hint").style.display, "none", "hint hidden while not angled");
      assertEqual(dom.root.querySelector('#ctrl-name-pos [data-val="left"]').style.display, "none", "Left/Right hidden");
      assertEqual(el("val-name-font").innerText, "17px");
      assertEqual(el("val-dot-size").innerText, "15px");
      assert(el("btn-splits-auto").classList.contains("active"));
      assert(el("cb-always-show-last-split").checked, "Always Show Last defaults on");
    }));

    it("syncs a vertical track with Left/Right buttons and the vertical hint", () => withPanel(({ dom, el, panel }) => {
      panel.sync({ orientation: "vertical", namePos: "left", deltaPos: "right" });
      assertEqual(el("opposing-hint").style.display, "block");
      assert(el("opposing-hint").innerText.includes("vertical timeline"));
      assertEqual(dom.root.querySelector('#ctrl-name-pos [data-val="top"]').style.display, "none", "Top/Bottom hidden");
      assertEqual(dom.root.querySelector('#ctrl-name-pos [data-val="left"]').style.display, "");
    }));

    it("shows the opposing-side hint when angle mode is on (chosen or auto-applied)", () => withPanel(({ el, panel }) => {
      localStorage.setItem(KEYS.SPLIT_ANGLE, "angled");
      panel.sync({ orientation: "horizontal" });
      assertEqual(el("opposing-hint").style.display, "block", "explicit 40°");
      assertEqual(el("select-split-angle").value, "angled");

      localStorage.setItem(KEYS.SPLIT_ANGLE, "auto");
      el("track").classList.add("angled-text");
      panel.sync({ orientation: "horizontal" });
      assertEqual(el("opposing-hint").style.display, "block", "auto-applied by track density");
      assert(window.LiveSplit.SettingsTrackPanel.isAngledMode());
    }));

    it("syncs a numeric or Fit All visible split preference", () => withPanel(({ el, panel }) => {
      localStorage.setItem(KEYS.VISIBLE_SPLITS, "12");
      panel.sync({});
      assertEqual(el("input-visible-splits").value, "12");

      localStorage.setItem(KEYS.VISIBLE_SPLITS, "all");
      panel.sync({});
      assert(el("btn-splits-fit-all").classList.contains("active"));
    }));

    it("orientation segments call setTrackOrientation", () => withPanel(({ panel, log, click }) => {
      panel.bind();
      click("ctrl-track-orient", "vertical");
      click("ctrl-track-orient", "horizontal");
      assertEqual(log.orientation, ["vertical", "horizontal"]);
    }));

    it("positions move freely when flat, and stay opposite in angle mode", () => withPanel(({ panel, style, log, click }) => {
      panel.bind();
      click("ctrl-name-pos", "bottom");
      assertEqual([style.namePos, style.deltaPos], ["bottom", "bottom"], "flat: deltas stay put");
      assertEqual([log.applied, log.saved], [1, 1]);

      localStorage.setItem(KEYS.SPLIT_ANGLE, "angled");
      click("ctrl-name-pos", "top");
      assertEqual([style.namePos, style.deltaPos], ["top", "bottom"], "angled: deltas pushed to the other side");
      click("ctrl-delta-pos", "top");
      assertEqual([style.namePos, style.deltaPos], ["bottom", "top"], "angled: names pushed to the other side");

      localStorage.setItem(KEYS.SPLIT_ANGLE, "flat");
      click("ctrl-delta-pos", "bottom");
      assertEqual([style.namePos, style.deltaPos], ["bottom", "bottom"], "flat again: independent");
    }));

    it("vertical positions stay independent even with a saved 40° angle (names never tilt there)", () => withPanel(({ el, panel, style, click, active }) => {
      localStorage.setItem(KEYS.SPLIT_ANGLE, "angled");
      el("track").classList.add("vertical", "angled-text");
      assert(!window.LiveSplit.SettingsTrackPanel.isAngledMode(), "a vertical track is never in angle mode");
      panel.bind();

      click("ctrl-name-pos", "right");
      assertEqual([style.namePos, style.deltaPos], ["right", "right"], "name side does not move the delta");
      click("ctrl-delta-pos", "left");
      assertEqual([style.namePos, style.deltaPos], ["right", "left"], "delta side does not move the name");

      click("ctrl-modal-angle", "angled");
      assertEqual(style.deltaPos, "left", "choosing 40° on a vertical track moves nothing");

      panel.sync(style);
      assertEqual([active("ctrl-name-pos"), active("ctrl-delta-pos")], ["right", "left"], "both groups keep a selection");
    }, { orientation: "vertical", namePos: "left", deltaPos: "right" }));

    it("choosing 40° forces deltas opposite the names; other angles just apply", () => withPanel(({ el, panel, style, log, click }) => {
      panel.bind();
      style.namePos = "bottom";
      style.deltaPos = "bottom";
      click("ctrl-modal-angle", "angled");
      assertEqual(localStorage.getItem(KEYS.SPLIT_ANGLE), "angled");
      assertEqual(style.deltaPos, "top");
      assertEqual(log.saved, 1, "style saved with the moved deltas");
      assertEqual(log.density, 1, "track density re-measured");

      const select = el("select-split-angle");
      select.value = "flat";
      select.dispatchEvent(new Event("change"));
      assertEqual(localStorage.getItem(KEYS.SPLIT_ANGLE), "flat");
      assertEqual(log.saved, 1, "flat does not move anything");
      assertEqual(log.applied, 2);
    }));

    it("spin boxes step, clamp, and set Fit All / Auto", () => withPanel(({ el, panel, log }) => {
      panel.bind();
      el("btn-splits-inc").click();
      assertEqual(log.visible, [9], "no preference: steps from 8");
      el("btn-splits-dec").click();
      el("btn-splits-dec").click();
      assertEqual(log.visible.slice(1), [8, 7]);

      const input = el("input-visible-splits");
      input.value = "99";
      input.dispatchEvent(new Event("input"));
      assertEqual(log.visible.length, 3, "out-of-range typing is ignored until committed");
      input.dispatchEvent(new Event("change"));
      assertEqual(input.value, "60", "clamped on commit");
      input.value = "5";
      input.dispatchEvent(new Event("input"));
      assertEqual(log.visible.slice(-2), [60, 5]);

      el("btn-splits-fit-all").click();
      el("btn-splits-auto").click();
      assertEqual(log.visible.slice(-2), ["all", "auto"]);
    }));

    it("size sliders preview live and save on change", () => withPanel(({ el, panel, style, log }) => {
      panel.bind();
      const s = el("slider-bar-height");
      s.value = "10";
      s.dispatchEvent(new Event("input"));
      assertEqual(style.barHeight, 10);
      assertEqual(el("val-bar-height").innerText, "10px");
      s.dispatchEvent(new Event("change"));
      assertEqual(log.saved, 1);
    }));

    it("Always Show Last Split persists and refreshes the track", () => withPanel(({ el, panel, log }) => {
      panel.bind();
      const cb = el("cb-always-show-last-split");
      cb.checked = false;
      cb.dispatchEvent(new Event("change"));
      assertEqual(localStorage.getItem(KEYS.ALWAYS_SHOW_LAST), "false");
      assertEqual(log.refresh, 1);
    }));

    it("ignores position clicks while no track style is loaded", () => {
      const dom = mountHtml(PANEL_HTML);
      try {
        let applied = 0;
        const panel = window.LiveSplit.SettingsTrackPanel.createTrackPanel({
          getCurrentTrackStyle: () => null, applyTrackStyle: () => { applied++; }, saveTrackStyle: () => {},
          setTrackOrientation: () => {}, setVisibleSplits: () => {}
        });
        panel.bind();
        dom.root.querySelector('#ctrl-name-pos [data-val="top"]').click();
        dom.root.querySelector('#ctrl-delta-pos [data-val="top"]').click();
        assertEqual(applied, 0);
      } finally {
        dom.remove();
      }
    });
  });
})();
