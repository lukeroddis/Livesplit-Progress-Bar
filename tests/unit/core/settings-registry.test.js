/**
 * tests/unit/core/settings-registry.test.js
 * LiveSplit.SettingsRegistry: the definitions list, per-type value validation,
 * option stepping and the controller (get / set / toggle / cycle / snapshot /
 * subscribe) over a recording fake app. The live overlay's app.settings is
 * covered by the badge and race control specs.
 */

(function () {
  "use strict";

  const R = window.LiveSplit.SettingsRegistry;
  const { stubWindow } = window.TestUtils;

  // A fake overlay app recording every controller call the registry makes
  function makeApp() {
    const calls = [];
    const rec = (name) => (...args) => calls.push([name, ...args]);
    const app = {
      calls,
      state: {
        comparisonsList: ["Personal Best", "Best Segments", "Sub 1h"],
        currentComparison: "Personal Best",
        timerDisplayMode: "both",
        currentTimingMethod: "GameTime",
        cachedEnableGolds: true
      },
      ghosts: ["wr"],
      pins: true,
      applyActiveComparison: (name) => { calls.push(["comparison", name]); app.state.currentComparison = name; },
      cycleComparison: rec("cycleComparison"),
      setTimerDisplayMode: rec("setTimerDisplayMode"),
      toggleTimingMethod: rec("toggleTimingMethod"),
      setTimingMethodFocus: (m) => { calls.push(["focus", m]); app.state.currentTimingMethod = m; },
      setGoldSegments: (v) => { calls.push(["golds", v]); app.state.cachedEnableGolds = v; },
      setVisibleSplits: rec("setVisibleSplits"),
      cycleVisibleSplits: rec("cycleVisibleSplits"),
      setGhostComparison: (list) => { calls.push(["ghosts", list]); app.ghosts = list; },
      cycleGhostComparison: rec("cycleGhostComparison"),
      ghostRunner: {
        getActiveGhostComparisons: () => [...app.ghosts],
        areGhostsEnabled: () => app.ghosts.some((g) => g !== "off")
      },
      setGhostsEnabled: rec("setGhostsEnabled"),
      scrollTrack: rec("scrollTrack"),
      trackPos: { pos: 2, max: 5 },
      getTrackScrollPosition: () => ({ ...app.trackPos }),
      setTrackScrollPosition: (v) => { calls.push(["trackPosition", v]); app.trackPos.pos = v; },
      refreshLeaderboard: rec("refreshLeaderboard"),
      getRaceClient: () => ({ areRacePinsVisible: () => app.pins, setRacePinsVisible: (v) => { app.pins = v; } })
    };
    return app;
  }

  const validate = (id, raw, app = makeApp()) => R.validateSettingValue(R.getSettingDef(id), raw, app);

  describe("Settings Registry: definitions", () => {
    it("every setting has a unique id, a known type / surface / apply mode and get + set", () => {
      const ids = new Set();
      R.SETTINGS.forEach((def) => {
        assert(!ids.has(def.id), `duplicate id ${def.id}`);
        ids.add(def.id);
        assert(def.label && def.group, `${def.id} label / group`);
        assert(["bool", "enum", "splits", "ghosts", "range", "action"].includes(def.type), `${def.id} type`);
        assert(def.where.length > 0 && def.where.every((w) => w === "dock" || w === "widget"), `${def.id} where`);
        assert(def.apply === "instant" || def.apply === "draft", `${def.id} apply`);
        if (def.type === "action") {
          assert(typeof def.run === "function" && Array.isArray(def.options), `${def.id} run / options`);
        } else {
          assert(typeof def.get === "function" && typeof def.set === "function", `${def.id} get / set`);
        }
        assert(Object.isFrozen(def), `${def.id} frozen`);
      });
      assert(Object.isFrozen(R.SETTINGS));
    });

    it("has a visibility setting for every HUD component", () => {
      window.LiveSplit.LayoutEngine.COMPONENTS.forEach((id) => assert(R.getSettingDef(`visible.${id}`), id));
    });

    it("lists settings by surface and group, in registry order", () => {
      const dock = R.listSettings("dock");
      assertEqual(dock.length, R.SETTINGS.length, "every live setting is on the dock");
      assertEqual(R.listSettings("widget", "timers").map((d) => d.id), ["comparison", "timerDisplay", "timingMethod"]);
      assert(!R.listSettings("widget").some((d) => d.id.startsWith("visible.")), "visibility is the close button, not a widget setting");
      assertEqual(R.getSettingDef("nope"), null);
    });
  });

  describe("Settings Registry: validation", () => {
    it("bool accepts booleans and their strings only", () => {
      assertEqual(validate("golds", true), { ok: true, value: true });
      assertEqual(validate("golds", "false"), { ok: true, value: false });
      assert(!validate("golds", 1).ok);
      assert(!validate("golds", "yes").ok);
    });

    it("enum accepts listed options, including dynamic ones from the app", () => {
      assertEqual(validate("timerDisplay", "realtime").value, "realtime");
      assert(!validate("timerDisplay", "RealTime").ok, "case sensitive");
      assertEqual(validate("comparison", "Sub 1h").value, "Sub 1h");
      assert(!validate("comparison", "Sub 2h").ok);
    });

    it("splits accepts auto / all or a whole number, clamped to 2..60, as a string", () => {
      assertEqual(validate("visibleSplits", "auto").value, "auto");
      assertEqual(validate("visibleSplits", "all").value, "all");
      assertEqual(validate("visibleSplits", 12).value, "12");
      assertEqual(validate("visibleSplits", " 8 ").value, "8");
      assertEqual(validate("visibleSplits", 1).value, "2");
      assertEqual(validate("visibleSplits", 99).value, "60");
      assert(!validate("visibleSplits", 7.5).ok);
      assert(!validate("visibleSplits", "8 splits").ok);
      assert(!validate("visibleSplits", null).ok);
    });

    it("ghosts accepts a list or comma string of known ghosts, deduped, with off dropped", () => {
      assertEqual(validate("ghosts", ["wr", "pb", "wr"]).value, ["wr", "pb"]);
      assertEqual(validate("ghosts", "pb, best").value, ["pb", "best"]);
      assertEqual(validate("ghosts", "off").value, []);
      assertEqual(validate("ghosts", ["Sub 1h"]).value, ["Sub 1h"], "the splits' own comparisons work as ghosts");
      assert(!validate("ghosts", ["nope"]).ok);
      assert(!validate("ghosts", 5).ok);
    });

    it("only splits comparisons the built-in ghosts don't cover are custom ghosts", () => {
      ["Sub 1h", "Glitchless PB"].forEach((c) => assert(R.isCustomGhostComparison(c), c));
      ["Personal Best", "best segments", "World Record", "WR", "pb", "", null].forEach((c) => assert(!R.isCustomGhostComparison(c), String(c)));
    });

    it("range accepts whole numbers, clamped to its options", () => {
      assertEqual(validate("trackPosition", 3).value, 3);
      assertEqual(validate("trackPosition", "4").value, 4);
      assertEqual(validate("trackPosition", 99).value, 5, "clamped to the last position");
      assertEqual(validate("trackPosition", -2).value, 0);
      assert(!validate("trackPosition", 1.5).ok);
      assert(!validate("trackPosition", "end").ok);
    });

    it("rejects unknown settings", () => {
      assert(!R.validateSettingValue(null, true, makeApp()).ok);
    });

    it("nextOption steps and wraps either way, starting over from an unlisted value", () => {
      assertEqual(R.nextOption(["a", "b", "c"], "c"), "a");
      assertEqual(R.nextOption(["a", "b", "c"], "a", -1), "c");
      assertEqual(R.nextOption(["a", "b"], "zzz"), "a");
      assertEqual(R.nextOption([], "a"), undefined);
    });
  });

  describe("Settings Registry: controller", () => {
    it("set validates, applies through the app and notifies subscribers", () => {
      const app = makeApp();
      const s = R.createSettingsController(app);
      const heard = [];
      s.subscribe((id, value) => heard.push([id, value]));

      assertEqual(s.set("visibleSplits", 70), { ok: true, value: "60" });
      assertEqual(app.calls.pop(), ["setVisibleSplits", "60"]);
      assertEqual(s.set("golds", false).ok, true);
      assertEqual(s.get("golds"), false);
      assertEqual(heard.pop(), ["golds", false]);

      const before = app.calls.length;
      assert(!s.set("timerDisplay", "sideways").ok);
      assert(!s.set("nope", 1).ok);
      assertEqual(app.calls.length, before, "invalid values never reach the app");
      assertEqual(heard.length, 1, "and are not notified");
    });

    it("an empty ghost list turns ghosts off", () => {
      const app = makeApp();
      R.createSettingsController(app).set("ghosts", []);
      assertEqual(app.calls.pop(), ["ghosts", ["off"]]);
      assertEqual(R.createSettingsController(app).get("ghosts"), []);
    });

    it("toggle flips bool settings only", () => {
      const app = makeApp();
      const s = R.createSettingsController(app);
      s.toggle("racePins");
      assertEqual(app.pins, false);
      assert(!s.toggle("comparison").ok);
    });

    it("cycle uses a setting's own badge cycle, else steps its options", () => {
      const app = makeApp();
      const s = R.createSettingsController(app);
      const heard = [];
      s.subscribe((id) => heard.push(id));

      s.cycle("comparison", -1);
      assertEqual(app.calls.pop(), ["cycleComparison", true], "reverse");
      s.cycle("timerDisplay");
      assertEqual(app.calls.pop(), ["toggleTimingMethod"]);
      s.cycle("timingMethod");
      assertEqual(app.calls.pop(), ["focus", "RealTime"], "generic option step");
      s.cycle("golds");
      assertEqual(app.calls.pop(), ["golds", false], "bools toggle");
      assertEqual(heard, ["comparison", "timerDisplay", "timingMethod", "golds"]);
      assert(!s.cycle("nope").ok);
    });

    it("snapshot reads every setting on a surface", () => stubWindow({ hudLayout: { getState: () => ({ title: { visible: false } }) } }, () => {
      const snap = R.createSettingsController(makeApp()).snapshot("dock");
      assertEqual(snap.comparison, "Personal Best");
      assertEqual(snap.ghosts, ["wr"]);
      assertEqual(snap.racePins, true);
      assertEqual(snap["visible.title"], false);
      assertEqual(snap["visible.track"], true, "missing layout entries count as visible");
      assertEqual(Object.keys(snap).length, R.listSettings("dock").filter((d) => d.type !== "action").length, "actions have no value");
    }));

    it("visibility settings go through the HUD layout; standings also refresh the leaderboard", () => {
      const app = makeApp();
      const shown = [];
      stubWindow({ hudLayout: { getState: () => ({}), setComponentVisible: (id, v) => shown.push([id, v]) } }, () => {
        const s = R.createSettingsController(app);
        s.set("visible.track", false);
        s.set("visible.leaderboard", false);
      });
      assertEqual(shown, [["track", false], ["leaderboard", false]]);
      assertEqual(app.calls.filter((c) => c[0] === "refreshLeaderboard").length, 1);
    });

    it("unsubscribe stops notifications and a failing listener does not stop the others", () => {
      const s = R.createSettingsController(makeApp());
      const heard = [];
      const origError = console.error;
      console.error = () => {};
      try {
        s.subscribe(() => { throw new Error("boom"); });
        const off = s.subscribe((id) => heard.push(id));
        s.toggle("golds");
        off();
        s.toggle("golds");
      } finally {
        console.error = origError;
      }
      assertEqual(heard, ["golds"]);
    });

    it("options lists the current choices of enum / ghost settings, as copies", () => {
      const app = makeApp();
      const s = R.createSettingsController(app);
      assertEqual(s.options("timingMethod"), ["GameTime", "RealTime"]);
      assertEqual(s.options("ghosts"), [...R.GHOST_IDS, "Sub 1h"], "built-in comparisons are already ghosts");
      s.options("comparison").push("x");
      assertEqual(app.state.comparisonsList.length, 3, "not the app's own list");
      assertEqual(s.options("golds"), []);
      assertEqual(s.options("nope"), []);
    });

    it("actions validate and run, but cannot be set, cycled or read", () => {
      const app = makeApp();
      const s = R.createSettingsController(app);
      const heard = [];
      s.subscribe((id) => heard.push(id));
      assertEqual(s.run("trackScroll", 1), { ok: true, value: 1 });
      assertEqual(s.run("trackScroll", 0).ok, true);
      assertEqual(app.calls.slice(-2), [["scrollTrack", 1], ["scrollTrack", 0]]);
      assert(!s.run("trackScroll", 5).ok, "only listed directions");
      assert(!s.run("golds", true).ok, "settings are not actions");
      assert(!s.set("trackScroll", 1).ok);
      assert(!s.cycle("trackScroll").ok);
      assertEqual(s.get("trackScroll"), undefined);
      assertEqual(heard, [], "running an action changes no setting");
    });

    it("trackPosition reads and moves the split view; its options are every position", () => {
      const app = makeApp();
      const s = R.createSettingsController(app);
      assertEqual(s.get("trackPosition"), 2);
      assertEqual(s.options("trackPosition"), [0, 1, 2, 3, 4, 5]);
      s.set("trackPosition", 4);
      assertEqual(app.calls.pop(), ["trackPosition", 4]);
      assertEqual(s.get("trackPosition"), 4);
    });

    it("ghostsOn reads and switches ghosts through the ghost runner", () => {
      const app = makeApp();
      const s = R.createSettingsController(app);
      assertEqual(s.get("ghostsOn"), true);
      s.set("ghostsOn", false);
      assertEqual(app.calls.pop(), ["setGhostsEnabled", false]);
    });

    it("describeSettings is plain data: labels, groups, types, option labels and split limits", () => {
      const schema = R.describeSettings("dock");
      assertEqual(schema.map((d) => d.id), R.listSettings("dock").map((d) => d.id));
      const byId = Object.fromEntries(schema.map((d) => [d.id, d]));
      assertEqual(byId.golds, { id: "golds", label: "Gold splits", group: "track", type: "bool" });
      assertEqual(byId.trackScroll.optionLabels["0"], "Current");
      assertEqual([byId.visibleSplits.min, byId.visibleSplits.max], [2, 60]);
      assertEqual(JSON.parse(JSON.stringify(schema)), schema, "survives JSON");
    });

    it("installSettingsRegistry registers app.settings", () => {
      const app = makeApp();
      R.installSettingsRegistry(app);
      assertEqual(app.settings.get("timingMethod"), "GameTime");
    });
  });
})();
