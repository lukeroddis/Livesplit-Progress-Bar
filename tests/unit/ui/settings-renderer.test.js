/**
 * tests/unit/ui/settings-renderer.test.js
 * LiveSplit.SettingsRenderer: each control type built from a registry schema entry
 * (what a click / input sends through set / run, and how update shows values),
 * dropdown vs buttons for enums, and mouse wheel stepping.
 */

(function () {
  "use strict";

  const { mountHtml, withFakeTimers } = window.TestUtils;
  const SR = window.LiveSplit.SettingsRenderer;

  // Renders one setting row into the page with recording set / run
  function withRow(def, options, fn, values = {}) {
    const dom = mountHtml('<div id="sr-host"></div>');
    const log = { set: [], run: [] };
    const renderer = SR.createSettingsRenderer({
      set: (id, v) => log.set.push([id, v]),
      run: (id, v) => log.run.push([id, v]),
      getValue: (id) => values[id]
    });
    const row = renderer.row(def, options);
    dom.el("sr-host").appendChild(row);
    renderer.update(values);
    try {
      return fn({ row, renderer, log, q: (sel) => row.querySelector(sel), all: (sel) => [...row.querySelectorAll(sel)] });
    } finally {
      dom.remove();
    }
  }

  describe("Settings Renderer (LiveSplit.SettingsRenderer)", () => {
    it("bool: an On / Off button that sets the opposite", () => withRow({ id: "golds", label: "Gold splits", type: "bool" }, [], ({ q, log, renderer, row }) => {
      const btn = q("button");
      assertEqual([btn.textContent, btn.classList.contains("sr-on")], ["On", true]);
      assertEqual(row.querySelector(".sr-label").textContent, "Gold splits");
      assertEqual(row.dataset.setting, "golds");
      btn.click();
      assertEqual(log.set, [["golds", false]]);
      renderer.update({ golds: false });
      assertEqual(btn.textContent, "Off");
    }, { golds: true }));

    it("enum: a few short options as buttons, using option labels", () => withRow(
      { id: "timerDisplay", label: "Timers", type: "enum", optionLabels: { gametime: "Game", both: "Both" } },
      ["gametime", "realtime", "both"], ({ all, log }) => {
        const btns = all("button");
        assertEqual(btns.map((b) => b.textContent), ["Game", "realtime", "Both"]);
        assert(btns[2].classList.contains("sr-on") && !btns[0].classList.contains("sr-on"), "current option marked");
        btns[0].click();
        assertEqual(log.set, [["timerDisplay", "gametime"]]);
      }, { timerDisplay: "both" }));

    it("enum: many or long options as a dropdown", () => withRow({ id: "comparison", label: "Comparison", type: "enum" },
      ["Personal Best", "Best Segments"], ({ q, log }) => {
        const select = q("select");
        assertEqual(select.value, "Best Segments");
        select.value = "Personal Best";
        select.dispatchEvent(new Event("change"));
        assertEqual(log.set, [["comparison", "Personal Best"]]);
      }, { comparison: "Best Segments" }));

    it("ghosts: buttons that toggle one ghost in the current list", () => withRow({ id: "ghosts", label: "Ghosts", type: "ghosts" },
      ["wr", "pb"], ({ all, log }) => {
        const [wr, pb] = all("button");
        assert(wr.classList.contains("sr-on") && !pb.classList.contains("sr-on"));
        assertEqual([wr.dataset.option, pb.dataset.option], ["wr", "pb"], "tagged for per-option styling (ghost colours)");
        pb.click();
        wr.click();
        assertEqual(log.set, [["ghosts", ["wr", "pb"]], ["ghosts", []]]);
      }, { ghosts: ["wr"] }));

    it("splits: - / number / + / Auto / All", () => withRow({ id: "visibleSplits", label: "Splits", type: "splits", min: 2, max: 60 },
      [], ({ q, all, log, renderer }) => {
        const num = q(".sr-num");
        assertEqual(num.value, "8");
        const [dec, inc, auto, all2] = all("button");
        inc.click();
        dec.click();
        auto.click();
        all2.click();
        num.value = "12";
        num.dispatchEvent(new Event("change"));
        assertEqual(log.set, [["visibleSplits", 9], ["visibleSplits", 7], ["visibleSplits", "auto"], ["visibleSplits", "all"], ["visibleSplits", "12"]]);
        renderer.update({ visibleSplits: "all" });
        assert(all2.classList.contains("sr-on"));
        assertEqual([num.value, num.placeholder], ["", "all"]);
      }, { visibleSplits: "8" }));

    it("range: a slider that sends at most one change per 60ms while dragging", () => withFakeTimers((clock) => withRow(
      { id: "trackPosition", label: "Split view", type: "range" }, [0, 1, 2, 3, 4, 5], ({ q, log }) => {
        const slider = q(".sr-slider");
        assertEqual([slider.value, q(".sr-slider-val").textContent], ["2", "2 / 5"]);
        slider.value = "3";
        slider.dispatchEvent(new Event("input"));
        slider.value = "4";
        slider.dispatchEvent(new Event("input"));
        assertEqual(log.set.length, 1, "the first change goes straight away");
        clock.tick(60);
        assertEqual(log.set, [["trackPosition", 3], ["trackPosition", 4]], "the last one follows");
      }, { trackPosition: 2 })));

    it("action: a button per option that runs it; the wheel steps back / forward", () => withRow(
      { id: "trackScroll", label: "Scroll", type: "action", optionLabels: { "-1": "◀", "0": "Current", "1": "▶" } }, [-1, 0, 1], ({ all, log, row }) => {
        assertEqual(all("button").map((b) => b.textContent), ["◀", "Current", "▶"]);
        all("button")[1].click();
        row.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, cancelable: true }));
        row.dispatchEvent(new WheelEvent("wheel", { deltaY: -200, cancelable: true }));
        assertEqual(log.run, [["trackScroll", 0], ["trackScroll", 1], ["trackScroll", -1], ["trackScroll", -1]]);
      }));

    it("the wheel over a slider steps it; trackpad deltas add up", () => withFakeTimers((clock) => withRow(
      { id: "trackPosition", label: "Split view", type: "range" }, [0, 1, 2, 3, 4, 5], ({ log, row }) => {
        row.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, cancelable: true }));
        for (let i = 0; i < 4; i++) row.dispatchEvent(new WheelEvent("wheel", { deltaY: 30, cancelable: true }));
        clock.tick(60);
        assertEqual(log.set.map((c) => c[1]), [1, 2], "one notch, then 120px of trackpad");
      }, { trackPosition: 0 })));

    it("unknown types render nothing; reset forgets old controls", () => {
      const renderer = SR.createSettingsRenderer({ set: () => {} });
      assertEqual(renderer.row({ id: "x", label: "X", type: "nope" }, []), null);
      const row = renderer.row({ id: "golds", label: "Golds", type: "bool" }, []);
      renderer.reset();
      renderer.update({ golds: true });
      assertEqual(row.querySelector("button").textContent, "", "no longer updated after reset");
    });
  });
})();
