/**
 * tests/unit/ui/settings-dialog-rows.test.js
 * LiveSplit.SettingsDialogRows: [data-settings] containers in the dialogs filled with
 * registry rows (shared renderer) over a fake settings controller: what they show,
 * what a click sets, showIf hiding, live updates and rebuilding.
 */

(function () {
  "use strict";

  const { mountHtml } = window.TestUtils;

  function makeSettings(values) {
    const listeners = [];
    const settings = {
      values,
      calls: [],
      get: (id) => values[id],
      set: (id, v) => { settings.calls.push([id, v]); values[id] = v; listeners.forEach((fn) => fn(id, v)); return { ok: true, value: v }; },
      run: (id, v) => settings.calls.push(["run", id, v]),
      snapshot: () => ({ ...values }),
      options: (id) => (id === "timerDisplay" ? ["gametime", "realtime", "both"] : id === "timingMethod" ? ["GameTime", "RealTime"] : []),
      subscribe: (fn) => { listeners.push(fn); return () => {}; }
    };
    return settings;
  }

  function withRows(fn, values) {
    const dom = mountHtml('<div id="dr-box" data-settings="timerDisplay timingMethod nope"></div><div id="dr-golds" data-settings="golds"></div>');
    const settings = makeSettings(values);
    const rows = window.LiveSplit.SettingsDialogRows.createDialogRows({ getSettings: () => settings, root: dom.root });
    try {
      rows.build();
      return fn({ dom, el: dom.el, settings, rows });
    } finally {
      dom.remove();
    }
  }

  describe("Settings Dialog Rows (LiveSplit.SettingsDialogRows)", () => {
    it("fills each container with its registry settings, in order, skipping unknown ids", () => withRows(({ el }) => {
      assertEqual([...el("dr-box").children].map((r) => r.dataset.setting), ["timerDisplay", "timingMethod"]);
      assertEqual(el("dr-golds").querySelector("button").textContent, "On");
    }, { timerDisplay: "both", timingMethod: "GameTime", golds: true }));

    it("a click sets the setting, and rows follow changes made anywhere", () => withRows(({ el, settings }) => {
      el("dr-golds").querySelector("button").click();
      assertEqual(settings.calls, [["golds", false]]);
      assertEqual(el("dr-golds").querySelector("button").textContent, "Off", "updated through the subscription");
    }, { timerDisplay: "both", timingMethod: "GameTime", golds: true }));

    it("the primary timer row only shows while both timers are shown", () => withRows(({ el, settings }) => {
      const focusRow = el("dr-box").querySelector('[data-setting="timingMethod"]');
      assert(focusRow.hidden, "hidden with one timer");
      settings.set("timerDisplay", "both");
      assert(!focusRow.hidden, "shown with both");
    }, { timerDisplay: "gametime", timingMethod: "GameTime", golds: true }));

    it("rebuilding replaces the rows instead of adding to them", () => withRows(({ el, rows }) => {
      rows.build();
      assertEqual(el("dr-box").children.length, 2);
    }, { timerDisplay: "both", timingMethod: "GameTime", golds: true }));

    it("does nothing without a settings controller", () => {
      const dom = mountHtml('<div data-settings="golds" id="dr-none"></div>');
      try {
        window.LiveSplit.SettingsDialogRows.createDialogRows({ getSettings: () => undefined, root: dom.root }).build();
        assertEqual(dom.el("dr-none").children.length, 0);
      } finally {
        dom.remove();
      }
    });
  });
})();
