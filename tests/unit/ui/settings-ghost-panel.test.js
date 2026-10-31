/**
 * tests/unit/ui/settings-ghost-panel.test.js
 * LiveSplit.SettingsGhostPanel: pin style (length / pinhead size sliders, pin side, lane) and
 * ghost opacity. Which ghosts show is a registry setting (settings-dialog-rows spec).
 */

(function () {
  "use strict";

  const { mountHtml, stubOverlay } = window.TestUtils;
  const KEYS = window.LiveSplit.Storage.KEYS;

  const PANEL_HTML = `
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
        return fn({ dom, panel, log, style });
      });
    } finally {
      dom.remove();
      if (savedOpacity === null) localStorage.removeItem(KEYS.GHOST_OPACITY); else localStorage.setItem(KEYS.GHOST_OPACITY, savedOpacity);
    }
  }

  describe("Settings Ghost Panel (LiveSplit.SettingsGhostPanel)", () => {
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


  });
})();
