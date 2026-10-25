/**
 * LiveSplit Progress Bar - Race Discovery & Auto-Detect Engine Spec
 */
(function () {
  "use strict";

  describe("LiveSplit.RaceDiscovery", () => {
    it("exports RaceDiscovery namespace and createRaceDiscovery factory", () => {
      assert(window.LiveSplit.RaceDiscovery !== null, "LiveSplit.RaceDiscovery exists");
      assertEqual(typeof window.LiveSplit.RaceDiscovery.createRaceDiscovery, "function", "createRaceDiscovery is a function");
      assertEqual(window.LiveSplit.RaceDiscovery.CONNECT_COOLDOWN_MS, 5000, "CONNECT_COOLDOWN_MS is 5000ms");
      assertEqual(window.LiveSplit.RaceDiscovery.THERUN_LIVE_API, "https://therun.gg/api/live", "THERUN_LIVE_API matches expected URL");
    });

    it("initializes with clean default state and exports discovery API", () => {
      const discovery = window.LiveSplit.RaceDiscovery.createRaceDiscovery();
      assertEqual(discovery.isStandby(), false, "Standby is initially false");
      assertEqual(discovery.getConnectCooldownRemainingMs(), 0, "Initial cooldown is 0");
      assertEqual(discovery.getAutoDetectUsername(), "", "Initial username is empty");
      assertEqual(typeof discovery.pollUserStatus, "function", "pollUserStatus is exported");
      assertEqual(typeof discovery.handleHostRunStarted, "function", "handleHostRunStarted is exported");
      assertEqual(typeof discovery.armSimulationStandby, "function", "armSimulationStandby is exported");
    });

    it("validates usernames and guards against invalid input", () => {
      const discovery = window.LiveSplit.RaceDiscovery.createRaceDiscovery();
      discovery.pollUserStatus("").then((resEmpty) => {
        assertEqual(resEmpty.status, "idle", "Empty username returns status idle");
      });

      discovery.pollUserStatus("invalid$$name!").then((resInvalid) => {
        assertEqual(resInvalid.status, "invalid_username", "Special characters return status invalid_username");
      });
    });

    it("enforces 5-second connect cooldown between status requests", () => {
      const origFetch = window.fetch;
      let fetchCount = 0;
      window.fetch = function () {
        fetchCount++;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ raceId: null })
        });
      };

      const discovery = window.LiveSplit.RaceDiscovery.createRaceDiscovery();
      try {
        discovery.pollUserStatus("SpeedyRunner");
        assertEqual(fetchCount, 1, "First poll triggers exactly 1 fetch");
        assert(discovery.getConnectCooldownRemainingMs() > 4000, "Cooldown is > 4000ms immediately after poll");

        // Immediate second call should be guarded by cooldown
        discovery.pollUserStatus("SpeedyRunner").then((second) => {
          assertEqual(second.status, "cooldown", "Second poll within cooldown window returns cooldown status");
        });
        assertEqual(fetchCount, 1, "Second poll does not trigger fetch");

        // Reset cooldown
        discovery.resetConnectCooldown();
        assertEqual(discovery.getConnectCooldownRemainingMs(), 0, "resetConnectCooldown clears timer");
      } finally {
        window.fetch = origFetch;
      }
    });

    it("connects to discovered raceId and clears standby", () => {
      const origFetch = window.fetch;
      let connectedRaceId = null;

      window.fetch = function () {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ raceId: "live-race-456" })
        });
      };

      try {
        const discovery = window.LiveSplit.RaceDiscovery.createRaceDiscovery({
          connectToRace: (id) => { connectedRaceId = id; }
        });

        discovery.pollUserStatus("Champion").then((res) => {
          assertEqual(res.status, "connected", "Returns connected status");
          assertEqual(res.raceId, "live-race-456", "Returns discovered raceId");
          assertEqual(connectedRaceId, "live-race-456", "connectToRace callback called with raceId");
          assertEqual(discovery.isStandby(), false, "Standby is cleared when race is discovered");
        });
      } finally {
        window.fetch = origFetch;
      }
    });

    it("disconnects when active race clears on server", () => {
      const origFetch = window.fetch;
      let disconnected = false;

      window.fetch = function () {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ raceId: null })
        });
      };

      try {
        const discovery = window.LiveSplit.RaceDiscovery.createRaceDiscovery({
          getRaceId: () => "active-room-123",
          disconnectFromRace: () => { disconnected = true; }
        });

        discovery.pollUserStatus("Champion").then((res) => {
          assertEqual(res.status, "no_race", "Returns no_race");
          assertEqual(disconnected, true, "disconnectFromRace callback was invoked");
        });
      } finally {
        window.fetch = origFetch;
      }
    });

    it("supports standby transitions and simulation standby arming", () => {
      let simArmed = false;
      let standbyEvents = [];

      const discovery = window.LiveSplit.RaceDiscovery.createRaceDiscovery({
        getHostUsername: () => "TestUser",
        notifyListeners: (type, payload) => {
          if (type === "race_standby_changed") standbyEvents.push(payload);
        },
        getSimEngine: () => ({
          armSimulationStandby: () => {
            simArmed = true;
            return { status: "sim_standby", isStandby: true, isSimStandby: true };
          },
          clearStandby: () => {}
        })
      });

      discovery.setStandby(true);
      assertEqual(discovery.isStandby(), true, "Standby set to true");
      assertEqual(standbyEvents.length, 1, "Standby change event fired");
      assertEqual(standbyEvents[0].isStandby, true, "Event payload isStandby is true");

      const simRes = discovery.armSimulationStandby(["A", "B"], [10, 20]);
      assertEqual(simArmed, true, "Simulation engine armSimulationStandby called");
      assertEqual(simRes.status, "sim_standby", "Simulation standby returned");

      discovery.stopAutoDetect();
      assertEqual(discovery.isStandby(), false, "stopAutoDetect clears standby");
    });

    it("handles event-driven host run started with zero delay", () => {
      const origFetch = window.fetch;
      let connectedRaceId = null;

      window.fetch = function () {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ raceId: "auto-started-race" })
        });
      };

      try {
        const discovery = window.LiveSplit.RaceDiscovery.createRaceDiscovery({
          getHostUsername: () => "AutoRunner",
          connectToRace: (id) => { connectedRaceId = id; }
        });

        discovery.handleHostRunStarted({ initialDelayMs: 0 }).then((res) => {
          assertEqual(res.status, "connected", "handleHostRunStarted returns connected");
          assertEqual(res.raceId, "auto-started-race", "Discovers auto-started race");
          assertEqual(connectedRaceId, "auto-started-race", "Connects to race automatically");
        });
      } finally {
        window.fetch = origFetch;
      }
    });

    it("launches simulation immediately if sim standby is armed when host run starts", () => {
      let simStarted = false;
      const discovery = window.LiveSplit.RaceDiscovery.createRaceDiscovery({
        startSimulation: () => { simStarted = true; },
        getSimEngine: () => ({
          isSimulating: () => false,
          isSimStandby: () => true,
          getPendingSimConfig: () => ({ splitsList: ["S1"], comparisonTimes: [25] })
        })
      });

      discovery.handleHostRunStarted({ initialDelayMs: 0 }).then((res) => {
        assertEqual(res.status, "connected", "Sim standby start returns connected");
        assertEqual(res.isSimulated, true, "isSimulated flag is true");
        assertEqual(simStarted, true, "startSimulation callback was invoked");
      });
    });
  });
})();
