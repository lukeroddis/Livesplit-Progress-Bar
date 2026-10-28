/**
 * tests/unit/ui/race-dock-bridge.test.js
 * LiveSplit.RaceDockBridge: dock command parsing, race status description, storage
 * event handling (connect / disconnect / invalid code) and the status heartbeat.
 * Uses an in-memory storage and event target so the real localStorage is untouched.
 */

(function () {
  "use strict";

  const { withFakeTimers } = window.TestUtils;
  const KEYS = window.LiveSplit.Storage.KEYS;
  const Bridge = window.LiveSplit.RaceDockBridge;

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
      connected: false, simulating: false, standby: false, listener: null,
      isConnected: () => rc.connected,
      isSimulating: () => rc.simulating,
      isStandby: () => rc.standby,
      getRaceId: () => "abc1",
      subscribe: (fn) => { rc.listener = fn; }
    };
    return rc;
  }

  function withBridge(fn) {
    return withFakeTimers((clock) => {
      const rc = makeClient();
      const storage = makeStorage();
      const target = makeTarget();
      const calls = [];
      const controls = {
        connectWithCode: (code) => { calls.push(["connect", code]); rc.connected = true; },
        disconnect: () => { calls.push(["disconnect"]); rc.connected = false; }
      };
      const bridge = Bridge.createRaceDockBridge({ raceClient: rc, controls, storage, target });
      bridge.start();
      const status = () => JSON.parse(storage.data[KEYS.DOCK_STATUS]);
      const command = (cmd) => target.fire("storage", { key: KEYS.DOCK_COMMAND, newValue: JSON.stringify(cmd) });
      try {
        return fn({ rc, calls, bridge, status, command, target, clock });
      } finally {
        bridge.stop();
      }
    });
  }

  describe("Race Dock Bridge (LiveSplit.RaceDockBridge)", () => {
    it("parses only connect / disconnect commands", () => {
      assertEqual(Bridge.parseDockCommand('{"action":"connect","code":" ab12 ","id":"x"}'), { action: "connect", code: "ab12", id: "x" });
      assertEqual(Bridge.parseDockCommand('{"action":"disconnect"}'), { action: "disconnect", code: "", id: null });
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

    it("publishes status on start and on every heartbeat", () => withBridge(({ status, clock }) => {
      assertEqual(status().state, "off");
      const first = status().at;
      clock.tick(Bridge.HEARTBEAT_MS);
      assert(status().at > first, "heartbeat refreshes the timestamp");
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

    it("ignores other storage keys and republishes on race events", () => withBridge(({ rc, calls, status, target }) => {
      target.fire("storage", { key: KEYS.HUD_LAYOUT, newValue: '{"action":"connect","code":"ab12"}' });
      assertEqual(calls, []);
      rc.connected = true;
      rc.listener("race_connected");
      assertEqual(status().state, "connected");
    }));

    it("stops listening after stop()", () => withBridge(({ bridge, calls, command, target }) => {
      bridge.stop();
      assertEqual(target.listeners.storage.length, 0);
      command({ action: "disconnect" });
      assertEqual(calls, []);
    }));
  });
})();
