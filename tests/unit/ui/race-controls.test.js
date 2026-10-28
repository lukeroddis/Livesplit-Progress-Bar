/**
 * tests/unit/ui/race-controls.test.js
 * LiveSplit.RaceControls against a scriptable race client: standings / pins toggles,
 * connect / disconnect with code validation and cooldown, Test Race badge, spectator
 * refresh tick and race client events. Runs on a fake clock (setInterval cooldowns).
 */

(function () {
  "use strict";

  const { mountHtml, withFakeTimers, stubWindow } = window.TestUtils;

  const CONTROLS_HTML = `
    <button id="btn-toggle-leaderboard"></button>
    <button id="btn-toggle-race-pins"></button>
    <button id="race-toggle-badge"></button>
    <button id="race-sim-badge"></button>
    <input type="text" id="input-therun-race-code">
    <button id="btn-save-therun-username"></button>
    <div id="ghost-marker-race-u1" style="display: flex;"></div>`;

  function makeRaceClient(overrides = {}) {
    const rc = {
      connected: false, simulating: false, standby: false, simStandby: false, pins: true,
      cooldownMs: 0, connectResult: true, listener: null, calls: [],
      isConnected: () => rc.connected,
      isSimulating: () => rc.simulating,
      isStandby: () => rc.standby,
      isSimStandby: () => rc.simStandby,
      getRaceId: () => "abc123",
      areRacePinsVisible: () => rc.pins,
      toggleRacePinsVisible: () => { rc.pins = !rc.pins; },
      getConnectCooldownRemainingMs: () => rc.cooldownMs,
      connectToRace: (code) => { rc.calls.push(["connect", code]); if (rc.connectResult) rc.connected = true; return rc.connectResult; },
      disconnectFromRace: () => { rc.calls.push(["disconnect"]); rc.connected = false; },
      stopSimulation: () => { rc.calls.push(["stopSim"]); rc.simulating = false; },
      startSimulation: (...args) => { rc.calls.push(["startSim", ...args]); rc.simulating = true; },
      resetConnectCooldown: () => rc.calls.push(["resetCooldown"]),
      setStandby: (v) => { rc.calls.push(["standby", v]); rc.standby = v; },
      subscribe: (fn) => { rc.listener = fn; },
      emit: (event, data) => rc.listener(event, data)
    };
    return Object.assign(rc, overrides);
  }

  function withControls(fn, { client = makeRaceClient(), layoutState = { leaderboard: { visible: true } }, simInputs } = {}) {
    const dom = mountHtml(CONTROLS_HTML);
    const log = { leaderboard: 0, ghosts: 0, saves: 0, applied: [] };
    const hudLayout = {
      getState: () => layoutState,
      saveLayout: () => { log.saves++; },
      applyComponentLayout: (id) => log.applied.push(id)
    };
    try {
      return withFakeTimers((clock) => stubWindow({ hudLayout }, () => {
        window.LiveSplit.RaceControls.bindRaceControls({
          raceClient: client,
          refreshLeaderboard: () => { log.leaderboard++; },
          refreshGhosts: () => { log.ghosts++; },
          getSimulationInputs: simInputs
        });
        const el = (id) => dom.el(id);
        return fn({ dom, el, rc: client, log, clock, layoutState, saveBtn: el("btn-save-therun-username") });
      }));
    } finally {
      dom.remove();
    }
  }

  const typeCode = (el, code) => { el("input-therun-race-code").value = code; };

  describe("Race Controls (LiveSplit.RaceControls)", () => {
    it("validates race codes with the race client's rule", () => {
      const valid = window.LiveSplit.RaceControls.isValidRaceCodeInput;
      assert(valid("abc_123-X"), "letters, digits, _ and -");
      assert(!valid("a"), "too short");
      assert(!valid("bad code!"), "spaces / punctuation rejected");
      assert(!valid("x".repeat(25)), "too long");
    });

    it("shows the idle state: Race Off, Connect, Test Race, Pins and Standings ON", () => withControls(({ el, saveBtn }) => {
      assertEqual(el("race-toggle-badge").textContent, "Race: Off");
      assertEqual(saveBtn.textContent, "Connect");
      assertEqual(el("race-sim-badge").textContent, "🧪 Test Race");
      assertEqual(el("btn-toggle-race-pins").textContent, "Pins: ON");
      assertEqual(el("btn-toggle-leaderboard").textContent, "Standings: ON");
    }));

    it("toggles standings visibility through the HUD layout", () => withControls(({ el, log, layoutState }) => {
      el("btn-toggle-leaderboard").click();
      assertEqual(layoutState.leaderboard.visible, false);
      assertEqual(el("btn-toggle-leaderboard").textContent, "Standings: OFF");
      assertEqual(log.saves, 1);
      assertEqual(log.applied, ["leaderboard"]);
      assertEqual(log.leaderboard, 1);
    }));

    it("creates the leaderboard layout entry if a layout has none", () => withControls(({ el, layoutState }) => {
      el("btn-toggle-leaderboard").click();
      assertEqual(layoutState.leaderboard.visible, false, "created visible, then toggled off");
      assertEqual(layoutState.leaderboard.x, 42);
    }, { layoutState: {} }));

    it("toggles race pins and re-renders markers", () => withControls(({ el, rc, log }) => {
      el("btn-toggle-race-pins").click();
      assertEqual(rc.pins, false);
      assertEqual(el("btn-toggle-race-pins").textContent, "Pins: OFF");
      assertEqual(log.ghosts, 1);
    }));

    it("connects with a valid code, then the same button disconnects", () => withControls(({ el, rc, saveBtn, log }) => {
      typeCode(el, "  abc123  ");
      saveBtn.click();
      assertEqual(rc.calls[0], ["connect", "abc123"], "code trimmed");
      assertEqual(saveBtn.textContent, "Disconnect");
      assert(saveBtn.classList.contains("danger"));
      assertEqual(el("race-toggle-badge").textContent, "Race: abc123");
      assertEqual(log.leaderboard, 1);

      saveBtn.click();
      assert(rc.calls.some((c) => c[0] === "disconnect"), "disconnected");
      assert(rc.calls.some((c) => c[0] === "resetCooldown"), "cooldown reset");
      assertEqual(saveBtn.textContent, "Connect");
      assertEqual(el("race-toggle-badge").textContent, "Race: Off");
    }));

    it("Enter in the code box connects", () => withControls(({ el, rc }) => {
      typeCode(el, "abc123");
      el("input-therun-race-code").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
      assertEqual(rc.calls[0], ["connect", "abc123"]);
    }));

    it("flashes Enter Code / Invalid Code and restores the button after 1.5s", () => withControls(({ el, rc, saveBtn, clock }) => {
      saveBtn.click();
      assertEqual(saveBtn.textContent, "Enter Code");
      clock.tick(1500);
      assertEqual(saveBtn.textContent, "Connect");

      typeCode(el, "bad code!");
      saveBtn.click();
      assertEqual(saveBtn.textContent, "Invalid Code");
      assertEqual(rc.calls.length, 0, "never reaches the race client");

      rc.connectResult = false;
      typeCode(el, "abc123");
      saveBtn.click();
      assertEqual(saveBtn.textContent, "Invalid Code", "a refused connection also flashes");
    }));

    it("counts down a connect cooldown, then re-enables Connect", () => withControls(({ el, rc, saveBtn, clock }) => {
      rc.cooldownMs = 2500;
      typeCode(el, "abc123");
      saveBtn.click();
      assert(saveBtn.disabled, "disabled during the cooldown");
      assertEqual(saveBtn.textContent, "Wait (3s)");
      clock.tick(1000);
      assertEqual(saveBtn.textContent, "Wait (2s)");
      clock.tick(1500);
      assert(!saveBtn.disabled, "re-enabled");
      assertEqual(saveBtn.textContent, "Connect");
      assertEqual(rc.calls.length, 0, "no connection attempted during the cooldown");
    }));

    it("the race badge disconnects when active, connects when idle", () => withControls(({ el, rc }) => {
      typeCode(el, "abc123");
      el("race-toggle-badge").click();
      assertEqual(rc.connected, true);
      el("race-toggle-badge").click();
      assertEqual(rc.connected, false);
    }));

    it("Test Race starts a simulation with a lobby, and stops it on the next click", () => withControls(({ el, rc }) => {
      const sim = el("race-sim-badge");
      sim.click();
      const start = rc.calls.find((c) => c[0] === "startSim");
      assertEqual(start.slice(1), [["A", "B"], [10, 20], [11, 22], { withLobby: true, progressive: true }]);
      assertEqual(sim.textContent, "🧪 Stop Sim");
      assertEqual(el("race-toggle-badge").textContent, "Race: Sim");

      sim.click();
      assert(rc.calls.some((c) => c[0] === "stopSim"), "simulation stopped");
      assertEqual(sim.textContent, "🧪 Test Race");
    }, { simInputs: () => ({ splitsList: ["A", "B"], gtComparisons: [10, 20], rtComparisons: [11, 22], isAlreadyRunning: false }) }));

    it("a run already in progress starts the simulation without a lobby", () => withControls(({ el, rc }) => {
      el("race-sim-badge").click();
      assertEqual(rc.calls[0][4], { withLobby: false, progressive: false });
    }, { simInputs: () => ({ splitsList: [], gtComparisons: [], rtComparisons: [], isAlreadyRunning: true }) }));

    it("shows standby states for the race and the simulation", () => withControls(({ el, rc, saveBtn }) => {
      rc.standby = true;
      rc.emit("race_standby_changed");
      assertEqual(el("race-toggle-badge").textContent, "Race: Standby");
      assertEqual(saveBtn.textContent, "Disconnect", "standby can be cancelled");
      saveBtn.click();
      assert(rc.calls.some((c) => c[0] === "standby" && c[1] === false), "standby cleared");

      rc.simStandby = true;
      rc.emit("race_standby_changed");
      assertEqual(el("race-sim-badge").textContent, "⏳ Sim Standby");
    }));

    it("refreshes the leaderboard every 100ms while connected as a spectator", () => withControls(({ rc, log, clock }) => {
      rc.connected = true;
      rc.emit("race_connected");
      const before = log.leaderboard;
      clock.tick(500);
      assertEqual(log.leaderboard - before, 5, "five ticks in 500ms");
      rc.connected = false;
      rc.emit("race_disconnected");
      const afterStop = log.leaderboard;
      clock.tick(500);
      assertEqual(log.leaderboard, afterStop, "tick stops on disconnect");
    }));

    it("the spectator tick stops itself if the connection drops silently", () => withControls(({ rc, log, clock }) => {
      rc.connected = true;
      rc.emit("race_connected");
      rc.connected = false;
      clock.tick(100);
      const n = log.leaderboard;
      clock.tick(500);
      assertEqual(log.leaderboard, n);
      assertEqual(clock.pending, 0, "interval cleared");
    }));

    it("starts the spectator tick at bind time when already connected", () => withControls(({ log, clock }) => {
      const before = log.leaderboard;
      clock.tick(200);
      assertEqual(log.leaderboard - before, 2);
    }, { client: makeRaceClient({ connected: true }) }));

    it("race events refresh standings and markers, and mute hides a runner's pin", () => withControls(({ el, rc, log }) => {
      rc.emit("entrants_update");
      rc.emit("entrant_updated");
      rc.emit("race_pins_visibility_changed");
      assertEqual(log.ghosts, 3);

      const marker = el("ghost-marker-race-u1");
      rc.emit("entrant_mute_changed", { userId: "u1", isMuted: true });
      assertEqual(marker.style.display, "none");
      rc.emit("entrant_mute_changed", { userId: "u1", isMuted: false });
      assertEqual(marker.style.display, "flex");
      rc.pins = false;
      rc.emit("entrant_mute_changed", { userId: "u1", isMuted: false });
      assertEqual(marker.style.display, "none", "stays hidden while pins are globally off");
      rc.emit("entrant_mute_changed", { userId: "missing", isMuted: true });
      rc.emit("entrant_mute_changed", null);
    }));

    it("returns actions that connect to a new code and disconnect", () => {
      const dom = mountHtml(CONTROLS_HTML);
      const rc = makeRaceClient();
      try {
        withFakeTimers(() => stubWindow({ hudLayout: undefined }, () => {
          const controls = window.LiveSplit.RaceControls.bindRaceControls({ raceClient: rc });
          controls.connectWithCode(" first ");
          controls.connectWithCode("second");
          assertEqual(rc.calls.filter((c) => c[0] !== "resetCooldown" && c[0] !== "standby"),
            [["connect", "first"], ["disconnect"], ["connect", "second"]], "leaves the current race first");
          assertEqual(dom.el("input-therun-race-code").value, "second");
          controls.disconnect();
          assertEqual(rc.connected, false);
        }));
      } finally {
        dom.remove();
      }
    });

    it("without a race client only the standings toggle is wired", () => {
      const dom = mountHtml(CONTROLS_HTML);
      try {
        stubWindow({ hudLayout: undefined }, () => {
          window.LiveSplit.RaceControls.bindRaceControls({});
          assertEqual(dom.el("btn-toggle-leaderboard").textContent, "Standings: ON", "defaults to ON without a layout");
          dom.el("btn-toggle-leaderboard").click();
          assertEqual(dom.el("btn-toggle-race-pins").textContent, "", "pins button untouched");
          assertEqual(dom.el("btn-save-therun-username").textContent, "", "connect button untouched");
        });
      } finally {
        dom.remove();
      }
    });
  });
})();
