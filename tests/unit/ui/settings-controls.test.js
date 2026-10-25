/**
 * tests/unit/ui/settings-controls.test.js
 * Unit tests for settings-controls (shared settings panel helpers)
 */

(function () {
  "use strict";

  describe("Settings Controls: shared panel helpers", () => {
    const C = window.LiveSplit.SettingsControls;

    function mount(html) {
      const host = document.createElement("div");
      host.innerHTML = html;
      document.body.appendChild(host);
      return host;
    }

    it("formats badges for px, percent, off and on-track values", () => {
      assertEqual(C.formats.px(16), "16px");
      assertEqual(C.formats.percent("85"), "85%");
      assertEqual(C.formats.percentOrOff(0), "0% (Off)");
      assertEqual(C.formats.percentOrOff(55), "55%");
      assertEqual(C.formats.pinLength(0), "0px (On Track)");
      assertEqual(C.formats.pinLength(12), "12px");
    });

    it("syncs and binds segmented controls", () => {
      const host = mount('<div id="t-seg"><button class="seg-btn" data-val="a"></button><button class="seg-btn" data-val="b"></button></div>');
      C.syncSegmented("#t-seg", "b");
      const [a, b] = host.querySelectorAll(".seg-btn");
      assert(!a.classList.contains("active") && b.classList.contains("active"), "only b is active");
      let picked = null;
      C.bindSegmented("#t-seg", (v) => { picked = v; });
      a.click();
      assertEqual(picked, "a");
      host.remove();
    });

    it("binds a style slider: input updates property, badge and preview; change saves", () => {
      const host = mount('<input type="range" id="t-slider" min="0" max="60"><span id="t-badge"></span>');
      const style = { ghostPinLength: 16 };
      let applied = 0;
      let saved = 0;
      C.bindStyleSlider({
        sliderId: "t-slider", badgeId: "t-badge", prop: "ghostPinLength", format: C.formats.pinLength,
        getStyle: () => style, applyStyle: () => applied++, saveStyle: () => saved++
      });
      const slider = document.getElementById("t-slider");
      slider.value = "0";
      slider.dispatchEvent(new Event("input"));
      assertEqual(style.ghostPinLength, 0);
      assertEqual(document.getElementById("t-badge").innerText, "0px (On Track)");
      assertEqual([applied, saved], [1, 0]);
      slider.dispatchEvent(new Event("change"));
      assertEqual(saved, 1);
      C.syncSlider("t-slider", "t-badge", 24, C.formats.px);
      assertEqual([slider.value, document.getElementById("t-badge").innerText], ["24", "24px"]);
      host.remove();
    });

    it("binds a split spinner with clamping and Fit All / Auto pills", () => {
      const host = mount('<button id="t-dec"></button><button id="t-inc"></button><input id="t-in"><button id="t-all"></button><button id="t-auto"></button>');
      const calls = [];
      let current = 2;
      C.bindSplitSpinner({ dec: "t-dec", inc: "t-inc", input: "t-in", all: "t-all", auto: "t-auto" }, () => current, (v) => calls.push(v));
      document.getElementById("t-dec").click();       // stays at the 2 minimum
      current = NaN;
      document.getElementById("t-inc").click();       // unset preference falls back to 8
      const input = document.getElementById("t-in");
      input.value = "99";
      input.dispatchEvent(new Event("change"));       // clamped to 60
      document.getElementById("t-all").click();
      document.getElementById("t-auto").click();
      assertEqual(calls, [2, 9, 60, "all", "auto"]);
      assertEqual(input.value, "60");
      host.remove();
    });

    it("persists storage checkboxes as true/false and treats missing as checked", () => {
      const key = "__settings_controls_test_flag";
      const host = mount(`<input type="checkbox" id="t-cb">`);
      localStorage.removeItem(key);
      C.syncStorageCheckbox("t-cb", key);
      assert(document.getElementById("t-cb").checked, "missing flag reads as checked");
      let changed = null;
      C.bindStorageCheckbox("t-cb", key, (v) => { changed = v; });
      const cb = document.getElementById("t-cb");
      cb.checked = false;
      cb.dispatchEvent(new Event("change"));
      assertEqual([localStorage.getItem(key), changed], ["false", false]);
      localStorage.removeItem(key);
      host.remove();
    });
  });
})();
