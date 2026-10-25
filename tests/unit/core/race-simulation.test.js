/**
 * tests/unit/core/race-simulation.test.js
 * Unit tests for LiveSplit.RaceSimulation local simulation engine
 */

(function () {
  "use strict";

  describe("Race Simulation Engine: LiveSplit.RaceSimulation", () => {
    it("exports SIMULATED_COMPETITORS array and createRaceSimulation factory", () => {
      const rs = window.LiveSplit.RaceSimulation;
      assert(rs !== undefined && rs !== null, "RaceSimulation namespace is exported");
      assert(Array.isArray(rs.SIMULATED_COMPETITORS), "SIMULATED_COMPETITORS is an array");
      assertEqual(rs.SIMULATED_COMPETITORS.length, 9, "Contains 9 preset virtual competitors");
      assertEqual(typeof rs.createRaceSimulation, "function", "createRaceSimulation is a function");

      // Verify competitor structure
      rs.SIMULATED_COMPETITORS.forEach(comp => {
        assert(typeof comp.id === "string", "Has id");
        assert(typeof comp.username === "string", "Has username");
        assert(typeof comp.paceFactor === "number", "Has numeric paceFactor");
        assert(typeof comp.driftOffset === "number", "Has numeric driftOffset");
      });
    });

    it("initializes simulation and starts lobby with progressive entrants", () => {
      const rs = window.LiveSplit.RaceSimulation;
      const mockHost = { userId: "mock_host", username: "Host", score: 0 };
      const mockEntrants = new Map([[mockHost.userId, mockHost]]);
      let status = "open";
      let raceId = null;

      const sim = rs.createRaceSimulation({
        getHostState: () => mockHost,
        getEntrants: () => mockEntrants,
        getStatus: () => status,
        setStatus: (s) => { status = s; },
        setRaceId: (id) => { raceId = id; },
        getTimingMethod: () => "GameTime",
        getCountdownSeconds: () => null,
        setCountdownSeconds: () => {},
        setCountdownTargetMs: () => {},
        getLastHostGameTimeSec: () => 0,
        getLastHostRealTimeSec: () => 0,
        isExternalHostConnected: () => false,
        pushRaceEvent: () => {},
        notifyListeners: () => {},
        updateHostProgress: () => {},
        checkpointRankHistory: new Map(),
        lastKnownRanks: new Map(),
        recentRaceEvents: []
      });

      assertEqual(sim.isSimulating(), false);

      sim.startSimulation(["Split 1", "Split 2", "Split 3"], [30, 60, 90], [30, 60, 90], { withLobby: false });
      assertEqual(sim.isSimulating(), true);
      assertEqual(raceId, "sim_cup_2026");
      assertEqual(status, "in_progress");
      assertEqual(mockEntrants.size, 10, "Populates 9 competitors + host = 10 entrants");

      // Verify competitor checkpoint times generated
      const demon = mockEntrants.get("sim_speeddemon");
      assert(demon !== undefined, "SpeedDemon exists");
      assertEqual(demon.checkpointTimes.length, 3, "3 checkpoint times generated");
      assert(demon.pbSec > 0, "pbSec is computed");

      sim.stopSimulation();
      assertEqual(sim.isSimulating(), false);
      assertEqual(raceId, null);
      assertEqual(status, "open");
    });

    it("manages simulation standby arming and clearing", () => {
      const rs = window.LiveSplit.RaceSimulation;
      let standby = false;

      const sim = rs.createRaceSimulation({
        getHostState: () => ({ userId: "h" }),
        getEntrants: () => new Map(),
        getStatus: () => "open",
        setStatus: () => {},
        setRaceId: () => {},
        getTimingMethod: () => "GameTime",
        setStandby: (v) => { standby = v; },
        pushRaceEvent: () => {},
        notifyListeners: () => {}
      });

      assertEqual(sim.isSimStandby(), false);
      sim.armSimulationStandby(["S1", "S2"], [30, 60], [30, 60]);
      assertEqual(sim.isSimStandby(), true);
      assertEqual(standby, true);

      const cfg = sim.getPendingSimConfig();
      assertEqual(cfg.splitsList.length, 2);

      sim.clearStandby();
      assertEqual(sim.isSimStandby(), false);
    });

    it("switches competitor checkpoint times dynamically on timing method change", () => {
      const rs = window.LiveSplit.RaceSimulation;
      const mockHost = { userId: "mock_host", username: "Host", score: 0 };
      const mockEntrants = new Map([[mockHost.userId, mockHost]]);
      let timingMethod = "GameTime";
      let status = "open";

      const sim = rs.createRaceSimulation({
        getHostState: () => mockHost,
        getEntrants: () => mockEntrants,
        getStatus: () => status,
        setStatus: (s) => { status = s; },
        setRaceId: () => {},
        getTimingMethod: () => timingMethod,
        pushRaceEvent: () => {},
        notifyListeners: () => {}
      });

      // Different GT vs RT course targets: GT is 30/60, RT is 45/90
      sim.startSimulation(["S1", "S2"], [30, 60], [45, 90], { withLobby: false });
      const rival = mockEntrants.get("sim_speeddemon");
      assert(rival !== undefined);

      const initialCheckTimes = rival.checkpointTimes;
      timingMethod = "RealTime";
      sim.onTimingMethodChanged(true);

      assert(rival.checkpointTimes !== initialCheckTimes, "Checkpoint times reference updated to RT");
      assert(rival.checkpointTimes[0] > initialCheckTimes[0], "RT targets are longer than GT targets");

      sim.stopSimulation();
    });
  });
})();
