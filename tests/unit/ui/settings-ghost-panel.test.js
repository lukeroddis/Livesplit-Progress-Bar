/**
 * tests/unit/ui/settings-ghost-panel.test.js
 * LiveSplit.SettingsGhostPanel: ghost pills and dropdown sync (presets, custom comparisons,
 * "Custom:" combinations), pin sliders and ghost opacity.
 */

(function () {
  "use strict";

  const { mountHtml, stubOverlay } = window.TestUtils;
  const KEYS = window.LiveSplit.Storage.KEYS;

  const PANEL_HTML = `
    <div id="ghost-pill-row">
      <button class="preset-pill-btn" data-ghost-pill="off"></button>
      <button class="preset-pill-btn" data-ghost-pill="wr"></button>
      <button class="preset-pill-btn" data-ghost-pill="pb"></button>
      <button class="preset-pill-btn" data-ghost-pill="best"></button>
    </div>
    <select id="select-ghost-comparison"></select>
    <input type="range" id="slider-ghost-pin-length" min="0" max="60"><span id="val-ghost-pin-length"></span>
    <input type="range" id="slider-ghost-pin-size" min="10" max="60"><span id="val-ghost-pin-size"></span>
    <input type="range" id="slider-ghost-opacity" min="30" max="100"><span id="val-ghost-opacity"></span>
    <div class="segmented-control" id="ctrl-pin-pos">
      <button class="seg-btn" data-val="auto"></button>
      <button class="seg-btn" data-val="top"></button>
      <button class="seg-btn" data-val="bottom"></button>
    </div>
    <input type="checkbox" id="cb-pin-lane">`;

  function withPanel(fn, { ghosts = [], comparisons = ["Personal Best", "World Record", "Sub 3h"], style = {} } = {}) {
    const dom = mountHtml(PANEL_HTML);
    const log = { toggled: [], set: [], opacity: [], applied: 0, saved: 0 };
    const savedOpacity = localStorage.getItem(KEYS.GHOST_OPACITY);
    try {
      return stubOverlay({
        getActiveGhostComparisons: () => ghosts,
        getComparisonsList: () => comparisons,
        toggleGhostComparison: (v) => log.toggled.push(v),
        setGhostComparison: (v) => log.set.push(v),
        setGhostOpacity: (v) => log.opacity.push(v)
      }, () => {
        const panel = window.LiveSplit.SettingsGhostPanel.createGhostPanel({
          getCurrentTrackStyle: () => style,
          applyTrackStyle: () => { log.applied++; },
          saveTrackStyle: () => { log.saved++; }
        });
        return fn({ dom, panel, log, style, select: dom.el("select-ghost-comparison") });
      });
    } finally {
      dom.remove();
      if (savedOpacity === null) localStorage.removeItem(KEYS.GHOST_OPACITY); else localStorage.setItem(KEYS.GHOST_OPACITY, savedOpacity);
    }
  }

  const pill = (dom, val) => dom.root.querySelector(`[data-ghost-pill="${val}"]`);
  const options = (select) => [...select.options].map((o) => o.value);

  describe("Settings Ghost Panel (LiveSplit.SettingsGhostPanel)", () => {
    it("with no ghosts: Off pill active, Off selected, custom splits comparisons listed", () => withPanel(({ dom, panel, select }) => {
      panel.sync({});
      assert(pill(dom, "off").classList.contains("active"), "Off pill active");
      assert(!pill(dom, "wr").classList.contains("active"));
      assertEqual(select.value, "off");
      const presets = window.LiveSplit.SettingsGhostPanel.GHOST_PRESET_OPTIONS.map((o) => o.val);
      assertEqual(options(select), [...presets, "Sub 3h"], "built-ins and World Record are not repeated as custom entries");
      assertEqual(dom.el("val-ghost-pin-length").innerText, "16px", "default pin length");
      assertEqual(dom.el("val-ghost-pin-size").innerText, "26px", "default pinhead size");
    }));

    it("matches a dual preset regardless of order", () => withPanel(({ dom, panel, select }) => {
      panel.sync({ ghostPinLength: 0, ghostPinSize: 30 });
      assertEqual(select.value, "wr,pb");
      assert(pill(dom, "wr").classList.contains("active") && pill(dom, "pb").classList.contains("active"), "both pills active");
      assert(!pill(dom, "off").classList.contains("active"));
      assertEqual(dom.el("val-ghost-pin-length").innerText, "0px (On Track)");
      assertEqual(dom.el("val-ghost-pin-size").innerText, "30px");
    }, { ghosts: ["pb", "wr"] }));

    it("selects a single custom comparison from the splits", () => withPanel(({ panel, select }) => {
      panel.sync({});
      assertEqual(select.value, "Sub 3h");
    }, { ghosts: ["Sub 3h"] }));

    it("adds a Custom entry for combinations no option covers", () => withPanel(({ panel, select }) => {
      panel.sync({});
      assertEqual(select.value, "pb,average");
      assertEqual(select.selectedOptions[0].innerText, "Custom: pb + average");
    }, { ghosts: ["pb", "average", "off"] }));

    it("pills and dropdown changes go to the ghost runner", () => withPanel(({ dom, panel, log, select }) => {
      panel.bind();
      pill(dom, "wr").click();
      pill(dom, "off").click();
      assertEqual(log.toggled, ["wr", "off"]);
      panel.sync({});
      select.value = "best";
      select.dispatchEvent(new Event("change"));
      assertEqual(log.set, ["best"]);
    }));

    it("pin sliders update the track style live and save on change", () => withPanel(({ dom, panel, log, style }) => {
      panel.bind();
      const slider = dom.el("slider-ghost-pin-length");
      slider.value = "24";
      slider.dispatchEvent(new Event("input"));
      assertEqual(style.ghostPinLength, 24);
      assertEqual(dom.el("val-ghost-pin-length").innerText, "24px");
      assertEqual(log.applied, 1);
      slider.dispatchEvent(new Event("change"));
      assertEqual(log.saved, 1);
    }));

    it("pin side and lane controls sync from and write to the track style", () => withPanel(({ dom, panel, log, style }) => {
      const seg = (val) => dom.root.querySelector(`#ctrl-pin-pos [data-val="${val}"]`);
      panel.sync(style);
      assert(seg("auto").classList.contains("active"), "older styles show Auto");
      assertEqual(dom.el("cb-pin-lane").checked, true, "older styles keep the lane on");

      panel.bind();
      seg("bottom").click();
      assertEqual(style.pinPos, "bottom");
      const lane = dom.el("cb-pin-lane");
      lane.checked = false;
      lane.dispatchEvent(new Event("change"));
      assertEqual(style.pinLane, false);
      assertEqual([log.applied, log.saved], [2, 2], "each change applies and saves");

      panel.sync(style);
      assert(seg("bottom").classList.contains("active") && !seg("auto").classList.contains("active"), "sync shows the chosen side");
      assertEqual(lane.checked, false);
    }));

    it("opacity previews live and persists on change", () => withPanel(({ dom, panel, log }) => {
      panel.bind();
      const slider = dom.el("slider-ghost-opacity");
      slider.value = "60";
      slider.dispatchEvent(new Event("input"));
      assertEqual(dom.el("val-ghost-opacity").innerText, "60%");
      assertEqual(log.opacity, ["60"]);
      slider.dispatchEvent(new Event("change"));
      assertEqual(localStorage.getItem(KEYS.GHOST_OPACITY), "60");
      panel.sync({});
      assertEqual(dom.el("val-ghost-opacity").innerText, "60%", "sync reads the saved opacity");
    }));

    it("falls back to stored ghost settings when the ghost runner is not loaded", () => {
      const dom = mountHtml(PANEL_HTML);
      const saved = [KEYS.ACTIVE_GHOSTS, KEYS.GHOST_COMPARISON].map((k) => [k, localStorage.getItem(k)]);
      try {
        stubOverlay({ getActiveGhostComparisons: undefined, getComparisonsList: undefined, setGhostComparison: undefined }, () => {
          const panel = window.LiveSplit.SettingsGhostPanel.createGhostPanel({ getCurrentTrackStyle: () => ({}) });
          localStorage.setItem(KEYS.ACTIVE_GHOSTS, JSON.stringify(["best"]));
          panel.sync({});
          assertEqual(dom.el("select-ghost-comparison").value, "best", "active ghosts read from storage");

          localStorage.removeItem(KEYS.ACTIVE_GHOSTS);
          localStorage.setItem(KEYS.GHOST_COMPARISON, "wr");
          panel.sync({});
          assertEqual(dom.el("select-ghost-comparison").value, "wr", "legacy single ghost key");

          panel.bind();
          const select = dom.el("select-ghost-comparison");
          select.value = "average";
          select.dispatchEvent(new Event("change"));
          assertEqual(localStorage.getItem(KEYS.GHOST_COMPARISON), "average", "choice stored directly");
        });
      } finally {
        dom.remove();
        saved.forEach(([k, v]) => (v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v)));
      }
    });
  });
})();
