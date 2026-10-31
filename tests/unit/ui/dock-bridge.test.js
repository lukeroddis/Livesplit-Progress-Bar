/**
 * tests/unit/ui/dock-bridge.test.js
 * LiveSplit.DockBridge: dock command parsing, race status description, storage
 * event handling (connect / disconnect / invalid code / set), the status snapshot
 * (v1 race fields kept for older dock files, settings values and options) and the
 * heartbeat. Uses an in-memory storage and event target so the real localStorage
 * is untouched, and the real settings registry over a fake app.
 */

(function () {
  "use strict";

  const { withFakeTimers } = window.TestUtils;
  const KEYS = window.LiveSplit.Storage.KEYS;
  const Bridge = window.LiveSplit.DockBridge;

  function makeStorage() {
    const data = {};
    return { data, setItem: (k, v) => { data[k] = String(v); }, getItem: (k) => data[k] ?? null };
  }

  function makeTarget() {
    const listeners = {};
    return {
      listeners,
      addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
      removeEventListener: (type, fn) => { listeners[type] = (listeners[type] || []).filter((h) => h !== fn); },
      fire: (type, e) => (listeners[type] || []).forEach((h) => h(e))
    };
  }

  function makeClient() {
    const rc = {
      connected: false, simulating: false, standby: false, listeners: new Set(), pins: true,
      isConnected: () => rc.connected,
      isSimulating: () => rc.simulating,
      isStandby: () => rc.standby,
      getRaceId: () => "abc1",
      areRacePinsVisible: () => rc.pins,
      setRacePinsVisible: (v) => { rc.pins = v; },
      subscribe: (fn) => { rc.listeners.add(fn); return () => rc.listeners.delete(fn); },
      emit: (event) => rc.listeners.forEach((fn) => fn(event))
    };
    return rc;
  }

  // The real registry over a minimal app: golds and comparison are enough to drive it
  function makeSettings(rc) {
    const app = {
      state: { comparisonsList: ["Personal Best", "Best Segments"], currentComparison: "Personal Best", cachedEnableGolds: true },
      getRaceClient: () => rc,
      setGoldSegments: (v) => { app.state.cachedEnableGolds = v; },
      applyActiveComparison: (name) => { app.state.currentComparison = name; },
      ghostRunner: { getActiveGhostComparisons: () => ["off"], areGhostsEnabled: () => false },
      scrollTrack: (dir) => { app.scrolled.push(dir); },
      scrolled: []
    };
    return { app, settings: window.LiveSplit.SettingsRegistry.createSettingsController(app) };
  }

  function withBridge(fn, { withRace = true } = {}) {
    return withFakeTimers((clock) => window.TestUtils.stubWindow({ hudLayout: { getState: () => ({}) } }, () => {
      const rc = makeClient();
      const { app, settings } = makeSettings(rc);
      const storage = makeStorage();
      const target = makeTarget();
      const calls = [];
      const controls = {
        connectWithCode: (code) => { calls.push(["connect", code]); rc.connected = true; },
        disconnect: () => { calls.push(["disconnect"]); rc.connected = false; }
      };
      const bridge = Bridge.createDockBridge(Object.assign(
        { settings, storage, target, getProfileName: () => "Speedy" },
        withRace ? { raceClient: rc, controls } : {}));
      bridge.start();
      const status = () => JSON.parse(storage.data[KEYS.DOCK_STATUS]);
      const command = (cmd) => target.fire("storage", { key: KEYS.DOCK_COMMAND, newValue: JSON.stringify(cmd) });
      try {
        return fn({ rc, app, settings, calls, bridge, status, command, target, clock });
      } finally {
        bridge.stop();
      }
    }));
  }

  describe("Dock Bridge (LiveSplit.DockBridge)", () => {
    it("parses connect / disconnect / set commands only", () => {
      assertEqual(Bridge.parseDockCommand('{"action":"connect","code":" ab12 ","id":"x"}'), { action: "connect", code: "ab12", id: "x" });
      assertEqual(Bridge.parseDockCommand('{"action":"disconnect"}'), { action: "disconnect", code: "", id: null });
      assertEqual(Bridge.parseDockCommand('{"action":"set","setting":"golds","value":false,"id":"s"}'),
        { action: "set", setting: "golds", value: false, id: "s" });
      assertEqual(Bridge.parseDockCommand('{"action":"set","value":true}'), null, "set needs a setting");
      assertEqual(Bridge.parseDockCommand('{"action":"run","setting":"trackScroll","value":-1}'),
        { action: "run", setting: "trackScroll", value: -1, id: null });
      assertEqual(Bridge.parseDockCommand('{"action":"reset"}'), null);
      assertEqual(Bridge.parseDockCommand("not json"), null);
      assertEqual(Bridge.parseDockCommand("null"), null);
      assertEqual(Bridge.parseDockCommand(null), null);
    });

    it("describes the race client state", () => {
      const rc = makeClient();
      assertEqual(Bridge.describeRaceStatus(rc), { state: "off", raceId: "" });
      rc.standby = true;
      assertEqual(Bridge.describeRaceStatus(rc).state, "standby");
      rc.connected = true;
      assertEqual(Bridge.describeRaceStatus(rc), { state: "connected", raceId: "abc1" });
      rc.simulating = true;
      assertEqual(Bridge.describeRaceStatus(rc).state, "sim");
      assertEqual(Bridge.describeRaceStatus(null).state, "off");
    });

    it("only registry settings listed for the dock may be set", () => {
      assert(Bridge.isDockSetting("golds"));
      assert(Bridge.isDockSetting("visible.track"));
      assert(!Bridge.isDockSetting("nope"));
    });

    it("publishes a v2 snapshot with the v1 race fields, settings, options and profile", () => withBridge(({ status }) => {
      const s = status();
      assertEqual(s.v, Bridge.STATUS_VERSION);
      assertEqual([s.state, s.raceId], ["off", ""], "v1 fields for older dock files");
      assertEqual(s.race, { state: "off", raceId: "" });
      assertEqual(s.settings.values.golds, true);
      assertEqual(s.settings.values.comparison, "Personal Best");
      assertEqual(s.settings.options.comparison, ["Personal Best", "Best Segments"]);
      assert(!("golds" in s.settings.options), "bools have no options");
      assertEqual(s.profile, "Speedy");
      assertEqual(s.settings.schema.map((d) => d.id), window.LiveSplit.SettingsRegistry.listSettings("dock").map((d) => d.id), "schema for the dock UI");
      assertEqual(s.settings.options.trackScroll, [-1, 0, 1], "actions' options too");
      assert(!("trackScroll" in s.settings.values), "actions have no value");
    }));

    it("publishes on every heartbeat", () => withBridge(({ status, clock }) => {
      const first = status().at;
      clock.tick(Bridge.HEARTBEAT_MS);
      assert(status().at > first, "heartbeat refreshes the timestamp");
    }));

    it("sets a setting from a dock command through the registry", () => withBridge(({ app, status, command }) => {
      command({ action: "set", setting: "golds", value: false, id: "s1" });
      assertEqual(app.state.cachedEnableGolds, false);
      assertEqual(status().settings.values.golds, false);
      assertEqual([status().lastCommandId, status().lastResult], ["s1", "ok"]);

      command({ action: "set", setting: "comparison", value: "Best Segments", id: "s2" });
      assertEqual(app.state.currentComparison, "Best Segments");
    }));

    it("runs actions (split scrolling) from a dock command", () => withBridge(({ app, status, command }) => {
      command({ action: "run", setting: "trackScroll", value: 1, id: "r1" });
      command({ action: "run", setting: "trackScroll", value: 0, id: "r2" });
      assertEqual(app.scrolled, [1, 0]);
      assertEqual(status().lastResult, "ok");
      command({ action: "run", setting: "golds", value: true, id: "r3" });
      assertEqual(status().lastResult, "invalid value: not an action");
    }));

    it("rejects unknown settings and invalid values without changing anything", () => withBridge(({ app, status, command }) => {
      command({ action: "set", setting: "nope", value: 1, id: "u1" });
      assertEqual(status().lastResult, "unknown setting");
      command({ action: "set", setting: "comparison", value: "Sub 1h", id: "u2" });
      assertEqual(status().lastResult, "invalid value: not an option");
      assertEqual(app.state.currentComparison, "Personal Best");
    }));

    it("republishes when a setting changes in the overlay itself", () => withBridge(({ settings, status }) => {
      settings.set("golds", false);
      assertEqual(status().settings.values.golds, false);
    }));

    it("connects from a dock command and reports the result", () => withBridge(({ calls, status, command }) => {
      command({ action: "connect", code: "ab12", id: "c1" });
      assertEqual(calls, [["connect", "ab12"]]);
      assertEqual(status().state, "connected");
      assertEqual(status().raceId, "abc1");
      assertEqual(status().lastCommandId, "c1");
      assertEqual(status().lastResult, "connected");
    }));

    it("rejects invalid codes without touching the race", () => withBridge(({ calls, status, command }) => {
      command({ action: "connect", code: "https://therun.gg/x", id: "c2" });
      assertEqual(calls, []);
      assertEqual(status().lastResult, "invalid code");
    }));

    it("disconnects from a dock command", () => withBridge(({ rc, calls, status, command }) => {
      rc.connected = true;
      command({ action: "disconnect", id: "d1" });
      assertEqual(calls, [["disconnect"]]);
      assertEqual(status().state, "off");
    }));

    it("without a race client, race commands report it and settings still work", () => withBridge(({ app, status, command }) => {
      command({ action: "connect", code: "ab12", id: "n1" });
      assertEqual(status().lastResult, "race unavailable");
      command({ action: "set", setting: "golds", value: false, id: "n2" });
      assertEqual(app.state.cachedEnableGolds, false);
    }, { withRace: false }));

    it("ignores other storage keys and republishes on race events", () => withBridge(({ rc, calls, status, target }) => {
      target.fire("storage", { key: KEYS.HUD_LAYOUT, newValue: '{"action":"connect","code":"ab12"}' });
      assertEqual(calls, []);
      rc.connected = true;
      rc.emit("race_connected");
      assertEqual(status().state, "connected");
    }));

    it("stops listening after stop()", () => withBridge(({ bridge, rc, settings, calls, command, target, status }) => {
      bridge.stop();
      assertEqual(target.listeners.storage.length, 0);
      assertEqual(rc.listeners.size, 0, "race subscription removed");
      command({ action: "disconnect" });
      assertEqual(calls, []);
      const before = status().at;
      settings.set("golds", false);
      assertEqual(status().settings.values.golds, true, "settings subscription removed");
      assertEqual(status().at, before);
    }));
  });
})();
