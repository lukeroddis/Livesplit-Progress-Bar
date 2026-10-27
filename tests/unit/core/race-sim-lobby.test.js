/**
 * tests/unit/core/race-sim-lobby.test.js
 * LiveSplit.RaceSimLobby: scripted lobby flows, countdown and race start on a fake clock
 * (TestUtils.withFakeTimers), so the 10.5s progressive lobby runs instantly.
 */

(function () {
  "use strict";

  const { withFakeTimers } = window.TestUtils;
  const ROSTER = () => window.LiveSplit.RaceSimRoster.SIMULATED_COMPETITORS;

  // Stand-in for the simulation context race-simulation.js passes to createSimLobby
  function makeSim(hostName = "Luke") {
    const sim = {
      state: { isSimulating: true, simLobbyTimers: [] },
      ctx: { recentRaceEvents: [{ type: "stale" }] },
      status: "idle",
      countdownSeconds: undefined,
      countdownTargetMs: undefined,
      entrants: new Map(),
      events: [],
      notifications: [],
      getStatus: () => sim.status,
      setStatus: (s) => { sim.status = s; },
      setCountdownTargetMs: (ms) => { sim.countdownTargetMs = ms; },
      setCountdownSeconds: (n) => { sim.countdownSeconds = n; },
      getCountdownSeconds: () => sim.countdownSeconds,
      pushRaceEvent: (e) => sim.events.push(e),
      notifyListeners: (type, data) => sim.notifications.push({ type, data }),
      getEntrants: () => sim.entrants,
      getHostState: () => ({ username: hostName }),
      createEntrant: (cfg, joined) => ({ id: cfg.id, username: cfg.username, joined, status: "joined", isReady: false })
    };
    sim.lobby = window.LiveSplit.RaceSimLobby.createSimLobby(sim);
    sim.countdowns = () => sim.notifications.filter((n) => n.type === "race_countdown").map((n) => n.data.countdown);
    return sim;
  }

  describe("Race Sim Lobby (LiveSplit.RaceSimLobby)", () => {
    it("progressive lobby: rivals join, ready up, count down 3-2-1 and start", () => withFakeTimers((clock) => {
      const sim = makeSim();
      sim.lobby.startLobbySequence(true);
      assertEqual(sim.status, "open");
      assertEqual(sim.ctx.recentRaceEvents.length, 0, "previous race events cleared");
      assertEqual(sim.events[0].text, "Race lobby opened");
      assertEqual(sim.events[0].user, "Luke");

      clock.tick(500);
      assertEqual(sim.entrants.size, 1, "first rival joins at 0.5s");
      assertEqual(sim.events[1].text, `${ROSTER()[0].username} joined the race`);

      clock.tick(4500);
      assertEqual(sim.entrants.size, ROSTER().length, "everyone has joined by 5s");
      assert([...sim.entrants.values()].every((e) => !e.isReady), "nobody ready yet");

      clock.tick(5000);
      assert([...sim.entrants.values()].every((e) => e.isReady && e.status === "ready"), "everyone ready by 10s");
      assert(sim.events.some((e) => e.text === `All runners are ready! (${ROSTER().length}/${ROSTER().length})`), "last ready-up announces all");

      clock.tick(500);
      assertEqual(sim.status, "starting", "countdown at 10.5s");
      assertEqual(sim.countdownSeconds, 3);

      clock.tick(2000);
      assertEqual(sim.countdowns(), [3, 2, 1]);

      clock.tick(1000);
      assertEqual(sim.status, "in_progress");
      assertEqual(sim.countdownSeconds, 0, "GO! banner showing");
      assert([...sim.entrants.values()].every((e) => e.status === "started"), "every rival started");
      assert(sim.notifications.some((n) => n.type === "race_started"));

      clock.tick(1500);
      assertEqual(sim.countdownSeconds, null, "GO! banner cleared after 1.5s");
      assertEqual(clock.pending, 0, "no timers left behind");
    }));

    it("quick lobby: everyone is present and readies up in three waves", () => withFakeTimers((clock) => {
      const sim = makeSim();
      ROSTER().forEach((cfg) => sim.entrants.set(cfg.id, sim.createEntrant(cfg, false)));
      sim.lobby.startLobbySequence(false);
      assertEqual(sim.events[0].text, `Race lobby opened (${ROSTER().length} runners)`);

      clock.tick(500);
      assert(sim.entrants.get("sim_speeddemon").isReady && sim.entrants.get("sim_pixelknight").isReady, "first wave ready");
      assert(!sim.entrants.get("sim_apex").isReady, "second wave not yet");
      clock.tick(600);
      assert(sim.entrants.get("sim_apex").isReady, "second wave ready");
      clock.tick(600);
      assert([...sim.entrants.values()].every((e) => e.isReady), "all ready at 1.7s");
      clock.tick(600);
      assertEqual(sim.status, "starting", "countdown at 2.3s");
      clock.tick(3000);
      assertEqual(sim.status, "in_progress");
    }));

    it("the host starting early (startRaceNow) adds missing rivals and starts everyone", () => withFakeTimers(() => {
      const sim = makeSim();
      sim.lobby.startLobbySequence(true);
      sim.lobby.startRaceNow();
      assertEqual(sim.status, "in_progress");
      assertEqual(sim.entrants.size, ROSTER().length, "rivals who had not joined are added");
      assertEqual(sim.countdownTargetMs, null);
    }));

    it("stopping the simulation cancels every pending lobby step", () => withFakeTimers((clock) => {
      const sim = makeSim();
      sim.lobby.startLobbySequence(true);
      clock.tick(1000);
      const joined = sim.entrants.size;
      sim.lobby.clearTimers();
      clock.tick(20000);
      assertEqual(sim.entrants.size, joined, "no more joins");
      assertEqual(sim.status, "open", "no countdown");
      assertEqual(clock.pending, 0);
    }));

    it("lobby steps do nothing once the simulation is no longer running", () => withFakeTimers((clock) => {
      const sim = makeSim();
      sim.lobby.startLobbySequence(true);
      sim.state.isSimulating = false;
      clock.tick(20000);
      assertEqual(sim.entrants.size, 0, "no rivals join a stopped simulation");
      assertEqual(sim.status, "open");
    }));

    it("the countdown aborts if the race leaves the starting state", () => withFakeTimers((clock) => {
      const sim = makeSim();
      sim.status = "lobby";
      sim.lobby.scheduleCountdown();
      assertEqual(sim.status, "starting");
      sim.status = "open";
      clock.tick(2000);
      assertEqual(sim.countdowns(), [3], "no 2 / 1 after leaving the starting state");

      const closed = makeSim();
      closed.status = "finished";
      closed.lobby.scheduleCountdown();
      assertEqual(closed.status, "finished", "no countdown when the lobby is closed");
    }));

    it("restarting the lobby replaces the previous schedule", () => withFakeTimers((clock) => {
      const sim = makeSim();
      sim.lobby.startLobbySequence(true);
      clock.tick(3000);
      sim.lobby.startLobbySequence(false);
      clock.tick(20000);
      assertEqual(sim.status, "in_progress", "the quick lobby completes");
      assertEqual(sim.countdowns(), [3, 2, 1], "only one countdown ran");
    }));
  });
})();
