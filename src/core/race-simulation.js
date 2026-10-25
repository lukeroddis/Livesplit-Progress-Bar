/**
 * src/core/race-simulation.js - Local Virtual Speedrun Race Simulation Engine
 *
 * Offline race against nine simulated rivals, driven by the race client:
 * - Start / stop, standby (arm now, start when the host's timer starts), reset, undo
 * - 50ms simulation loop: rivals follow the host's LiveSplit time when connected,
 *   wait at 00:00 while LiveSplit sits at the start line, or race a virtual host
 * - Timing method switches (GameTime / RealTime) for every rival
 *
 * Composed from race-sim-roster.js (rivals), race-sim-lobby.js (lobby, countdown,
 * start) and race-sim-pacing.js (rival pacing, virtual host), sharing one
 * simulation state object.
 */

(function () {
  "use strict";

  // Room id the local simulation reports while running (never a real therun.gg code)
  const SIM_RACE_ID = "sim_cup_2026";
  const { SIMULATED_COMPETITORS, buildCompetitorEntrant } = window.LiveSplit.RaceSimRoster;
  const FALLBACK_SPLITS = ["Split 1", "Split 2", "Split 3", "Split 4", "Split 5", "Split 6", "Split 7", "Finished"];
  const FALLBACK_TARGETS = [30, 60, 90, 120, 150, 180, 210, 240];
  const TICK_MS = 50;

  function createSimState() {
    return {
      isSimulating: false,
      isSimStandby: false,
      pendingSimConfig: null,
      simulationTimer: null,
      simLobbyTimers: [],
      simHasLobby: false,
      simProgressiveLobby: false,
      simVirtualSec: 0,
      lastSimTickTimestamp: 0,
      activeSplitsList: [],
      activeComparisonTimes: [],
      activeComparisonTimesRT: [],
      simulationCourseTargets: [],
      simulationCourseTargetsRT: []
    };
  }

  // Copy of a comparison curve, or null when none is loaded
  function copyTimes(times) {
    return (Array.isArray(times) && times.length > 0) ? [...times] : null;
  }

  // Extra splits beyond the comparison get +30s each
  function padCourse(course, splitCount) {
    while (course.length < splitCount) {
      const lastT = course[course.length - 1] || 0;
      course.push(lastT + 30);
    }
    return course;
  }

  /**
   * Factory creating an isolated simulation engine connected to RaceClient state.
   *
   * @param {Object} ctx - Adapter context connecting to RaceClient state & event callbacks
   * @returns {Object} Simulation controller API
   */
  function createRaceSimulation(ctx) {
    const state = createSimState();
    const call = (name, fallback, ...args) => (ctx && typeof ctx[name] === "function") ? ctx[name](...args) : fallback;

    // Guarded accessors onto the race client, shared with the lobby and pacing modules
    const sim = {
      state,
      ctx,
      setCountdownTargetMs: (ms) => call("setCountdownTargetMs", undefined, ms),
      setCountdownSeconds: (sec) => call("setCountdownSeconds", undefined, sec),
      getCountdownSeconds: () => call("getCountdownSeconds", null),
      setStatus: (st) => call("setStatus", undefined, st),
      getStatus: () => call("getStatus", "open"),
      pushRaceEvent: (evt) => call("pushRaceEvent", undefined, evt),
      notifyListeners: (evt, payload) => call("notifyListeners", undefined, evt, payload),
      getTimingMethod: () => call("getTimingMethod", "GameTime"),
      getEntrants: () => call("getEntrants", new Map()),
      getHostState: () => call("getHostState", {}),
      getLastHostGameTimeSec: () => call("getLastHostGameTimeSec", 0),
      getLastHostRealTimeSec: () => call("getLastHostRealTimeSec", 0),
      setRaceId: (id) => call("setRaceId", undefined, id),
      createEntrant: (cfg, withLobby = false) => buildCompetitorEntrant(cfg, {
        courseTargets: state.simulationCourseTargets,
        courseTargetsRT: state.simulationCourseTargetsRT,
        splitsList: state.activeSplitsList,
        isRT: sim.getTimingMethod() === "RealTime",
        withLobby
      })
    };
    const lobby = window.LiveSplit.RaceSimLobby.createSimLobby(sim);
    const pacing = window.LiveSplit.RaceSimPacing.createSimPacing(sim);
    const { tickSimulatedCompetitors, advanceVirtualHost } = pacing;

    function clearRanks() {
      if (ctx.lastKnownRanks) ctx.lastKnownRanks.clear();
      if (ctx.checkpointRankHistory) ctx.checkpointRankHistory.clear();
    }

    function resetEntrantsToHost(hostState) {
      const entrants = sim.getEntrants();
      entrants.clear();
      entrants.set(hostState.userId, Object.assign({}, hostState));
      return entrants;
    }

    // LiveSplit is connected but its timer has not started: every rival waits at 00:00
    function holdRacersAtStart(entrants) {
      state.simVirtualSec = 0;
      if (ctx.checkpointRankHistory) ctx.checkpointRankHistory.clear();
      entrants.forEach((racer) => {
        if (racer.isHost) return;
        racer.currentTimeSecGT = 0;
        racer.currentTimeSecRT = 0;
        racer.currentTimeSec = 0;
        racer.currentSplitIndex = 0;
        racer.currentSplitName = (state.activeSplitsList && state.activeSplitsList[0]) ? state.activeSplitsList[0] : "Split 1";
        racer.splitTimes = [];
        racer.splitTimesGT = [];
        racer.splitTimesRT = [];
        racer.isFinished = false;
        racer.finalTimeSec = null;
        racer.score = 0;
        racer.lastSplitEffect = null;
        racer.positionDelta = 0;
        racer.positionDeltaDisplay = "-";
      });
    }

    function runSimulationTick(hostState, entrants) {
      if (!state.isSimulating) return;

      const now = Date.now();
      const dt = Math.min(0.2, Math.max(0.01, (now - (state.lastSimTickTimestamp || now)) / 1000));
      state.lastSimTickTimestamp = now;

      if (sim.getStatus() !== "in_progress") {
        sim.notifyListeners("entrant_updated", null);
        return;
      }

      const isExtConnected = ctx.isExternalHostConnected ? ctx.isExternalHostConnected() : false;
      const lastHostRealTimeSec = sim.getLastHostRealTimeSec();
      const lastHostGameTimeSec = sim.getLastHostGameTimeSec();
      const isRTActive = (sim.getTimingMethod() === "RealTime");

      if (hostState.isDNF) {
        // Host has forfeited / DNF'd: competitors continue running to the finish line
        state.simVirtualSec += dt;
        tickSimulatedCompetitors(state.simVirtualSec, dt);
      } else if (isExtConnected) {
        if (hostState.currentTimeSec > 0) {
          tickSimulatedCompetitors(isRTActive ? (lastHostRealTimeSec || hostState.currentTimeSec) : (lastHostGameTimeSec || hostState.currentTimeSec), dt);
        } else if (lastHostRealTimeSec > 0) {
          tickSimulatedCompetitors(isRTActive ? lastHostRealTimeSec : (lastHostGameTimeSec || lastHostRealTimeSec), dt);
        } else {
          holdRacersAtStart(entrants);
        }
      } else {
        advanceVirtualHost(state.simVirtualSec);
      }
      sim.notifyListeners("entrant_updated", null);
      if (typeof window !== "undefined" && typeof window.updateGhostRunner === "function") {
        window.updateGhostRunner(hostState.currentTimeSec || state.simVirtualSec);
      }
    }

    function setCourse(splitsList, comparisonTimes, comparisonTimesRT) {
      state.activeSplitsList = (Array.isArray(splitsList) && splitsList.length > 0) ? [...splitsList] : [...FALLBACK_SPLITS];
      state.simulationCourseTargets = copyTimes(comparisonTimes) || [...FALLBACK_TARGETS];
      state.activeComparisonTimes = [...state.simulationCourseTargets];
      state.simulationCourseTargetsRT = copyTimes(comparisonTimesRT) || [...state.simulationCourseTargets];
      state.activeComparisonTimesRT = [...state.simulationCourseTargetsRT];
      padCourse(state.simulationCourseTargets, state.activeSplitsList.length);
      padCourse(state.simulationCourseTargetsRT, state.activeSplitsList.length);
    }

    function prepareHost(hostState, withLobby, preserveLiveHost) {
      if (ctx.loadStoredUsername) {
        const stored = ctx.loadStoredUsername();
        if (stored && ctx.setHostUsername) ctx.setHostUsername(stored);
      }
      hostState.username = ctx.getHostUsername ? (ctx.getHostUsername() || "You") : "You";
      hostState.isHost = true;
      hostState.color = "#38bdf8";
      if (!preserveLiveHost) {
        hostState.currentTimeSec = 0;
        hostState.currentSplitIndex = 0;
        hostState.currentSplitName = state.activeSplitsList[0] || "Split 1";
        hostState.splitTimes = [];
        hostState.score = 0;
      }
      hostState.isFinished = false;
      hostState.finalTimeSec = null;
      hostState.isDNF = false;
      hostState.dnfTimeSec = null;
      hostState.lastSplitEffect = null;
      hostState.status = withLobby ? "ready" : "started";
      hostState.isReady = true;
    }

    function startSimulation(splitsList = [], comparisonTimes = [], comparisonTimesRT = [], opts = {}) {
      if (ctx.clearRunStartLookupTimers) ctx.clearRunStartLookupTimers();
      lobby.clearTimers();
      if (ctx.setStandby) ctx.setStandby(false);
      stopSimulation();

      state.isSimulating = true;
      sim.setRaceId(SIM_RACE_ID);

      const withLobby = !!(opts && opts.withLobby);
      const isProgressive = withLobby && (opts.progressive !== false) && !opts.immediate && !opts.immediateEntrants;
      state.simHasLobby = withLobby;
      state.simProgressiveLobby = isProgressive;
      sim.setStatus(withLobby ? "open" : "in_progress");
      sim.setCountdownTargetMs(null);
      sim.setCountdownSeconds(null);
      if (ctx.recentRaceEvents) ctx.recentRaceEvents.length = 0;

      const hostState = sim.getHostState();
      const lastExternalHostUpdate = ctx.getLastExternalHostUpdate ? ctx.getLastExternalHostUpdate() : 0;
      // Starting a quick sim mid-run keeps the host's live LiveSplit progress
      const preserveLiveHost = !withLobby && (lastExternalHostUpdate > 0 && hostState.currentTimeSec > 0);
      if (!preserveLiveHost && ctx.setLastHostTimes) {
        ctx.setLastHostTimes(0, 0);
      }

      setCourse(splitsList, comparisonTimes, comparisonTimesRT);
      prepareHost(hostState, withLobby, preserveLiveHost);

      const entrants = resetEntrantsToHost(hostState);
      clearRanks();

      if (!withLobby || !isProgressive) {
        SIMULATED_COMPETITORS.forEach((cfg) => {
          entrants.set(cfg.id, sim.createEntrant(cfg, withLobby));
        });
      }

      if (preserveLiveHost) {
        const isRT = (sim.getTimingMethod() === "RealTime");
        const activeHostSec = isRT
          ? (sim.getLastHostRealTimeSec() || hostState.currentTimeSec)
          : (sim.getLastHostGameTimeSec() || hostState.currentTimeSec);
        tickSimulatedCompetitors(activeHostSec, 0);
      }

      sim.notifyListeners("race_connected", { raceId: SIM_RACE_ID, isSimulated: true });

      if (withLobby) {
        lobby.startLobbySequence(isProgressive);
      }

      state.simVirtualSec = hostState.currentTimeSec || 0;
      state.lastSimTickTimestamp = Date.now();
      state.simulationTimer = setInterval(() => runSimulationTick(hostState, entrants), TICK_MS);
    }

    function stopSimulation() {
      state.simHasLobby = false;
      state.simProgressiveLobby = false;
      if (ctx.clearRunStartLookupTimers) ctx.clearRunStartLookupTimers();
      lobby.clearTimers();
      if (ctx.setStandby) ctx.setStandby(false);
      if (state.simulationTimer) {
        clearInterval(state.simulationTimer);
        state.simulationTimer = null;
      }
      state.simVirtualSec = 0;
      if (!state.isSimulating) return;

      state.isSimulating = false;
      sim.setRaceId(null);
      sim.setStatus("open");
      sim.setCountdownTargetMs(null);
      sim.setCountdownSeconds(null);
      if (ctx.recentRaceEvents) ctx.recentRaceEvents.length = 0;

      const hostState = sim.getHostState();
      hostState.currentTimeSec = 0;
      hostState.currentSplitIndex = 0;
      hostState.currentSplitName = "Start";
      hostState.splitTimes = [];
      hostState.isFinished = false;
      hostState.finalTimeSec = null;
      hostState.score = 0;
      hostState.lastSplitEffect = null;

      resetEntrantsToHost(hostState);
      clearRanks();
      sim.notifyListeners("race_disconnected", null);
    }

    function armSimulationStandby(splitsList = [], comparisonTimes = [], comparisonTimesRT = []) {
      if (ctx.clearRunStartLookupTimers) ctx.clearRunStartLookupTimers();
      if (state.isSimulating) {
        stopSimulation();
      }
      state.pendingSimConfig = {
        splitsList: Array.isArray(splitsList) ? [...splitsList] : [],
        comparisonTimes: Array.isArray(comparisonTimes) ? [...comparisonTimes] : [],
        comparisonTimesRT: Array.isArray(comparisonTimesRT) ? [...comparisonTimesRT] : []
      };
      state.isSimStandby = true;
      if (ctx.setStandby) ctx.setStandby(true);
      sim.notifyListeners("race_standby_changed", { isStandby: true, isSimStandby: true });
      return { status: "sim_standby", isStandby: true, isSimStandby: true };
    }

    // The host started their LiveSplit timer: skip any remaining lobby / countdown and race
    function handleHostRunStarted() {
      if (!state.isSimulating) return false;
      if (sim.getStatus() !== "in_progress") {
        lobby.clearTimers();
        lobby.startRaceNow();
      }
      return true;
    }

    function handleUndoSplit(targetIdx) {
      if (!state.isSimulating) return;
      const course = state.simulationCourseTargets;
      if (targetIdx < course.length) {
        const prevTarget = targetIdx > 0 ? (course[targetIdx - 1] || 0) : 0;
        if (state.simVirtualSec > (course[targetIdx] || prevTarget + 30)) {
          state.simVirtualSec = prevTarget;
        }
      }
    }

    function onTimingMethodChanged(isRT) {
      if (!state.isSimulating) return;
      sim.getEntrants().forEach((racer) => {
        if (racer.isHost) return;
        if (racer.checkpointTimesGT && racer.checkpointTimesRT) {
          racer.checkpointTimes = isRT ? racer.checkpointTimesRT : racer.checkpointTimesGT;
          racer.pbCheckpointTimes = isRT ? racer.pbCheckpointTimesRT : racer.pbCheckpointTimesGT;
          racer.splitTimes = isRT
            ? (racer.splitTimesRT && racer.splitTimesRT.length > 0 ? racer.splitTimesRT : racer.splitTimes)
            : (racer.splitTimesGT && racer.splitTimesGT.length > 0 ? racer.splitTimesGT : racer.splitTimes);
          if (racer.currentTimeSecGT !== undefined && racer.currentTimeSecRT !== undefined) {
            racer.currentTimeSec = isRT ? racer.currentTimeSecRT : racer.currentTimeSecGT;
          }
        }
      });
    }

    // LiveSplit reset during a simulation: back to the lobby with the same rivals
    function resetSimulation() {
      if (!state.isSimulating) return;
      state.simHasLobby = true;
      lobby.clearTimers();
      sim.setStatus("open");
      sim.setCountdownTargetMs(null);
      sim.setCountdownSeconds(null);
      const hostState = sim.getHostState();
      hostState.status = "ready";
      hostState.isReady = true;

      if (state.simProgressiveLobby) {
        resetEntrantsToHost(hostState);
        lobby.startLobbySequence(true);
      } else {
        sim.getEntrants().forEach((racer) => {
          if (!racer.isHost) {
            racer.status = "joined";
            racer.isReady = false;
          }
        });
        lobby.startLobbySequence(false);
      }
    }

    return {
      SIMULATED_COMPETITORS,
      startSimulation,
      stopSimulation,
      isSimulating: () => state.isSimulating,
      armSimulationStandby,
      isSimStandby: () => state.isSimStandby,
      getPendingSimConfig: () => state.pendingSimConfig,
      clearStandby: () => {
        state.isSimStandby = false;
        state.pendingSimConfig = null;
      },
      tickSimulatedCompetitors,
      handleHostRunStarted,
      handleUndoSplit,
      onTimingMethodChanged,
      resetSimulation,
      getSimVirtualSec: () => state.simVirtualSec,
      setSimVirtualSec: (sec) => { state.simVirtualSec = sec; },
      getCourseTargets: () => state.simulationCourseTargets.slice(),
      getCourseTargetsRT: () => state.simulationCourseTargetsRT.slice()
    };
  }

  // Namespace export
  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.RaceSimulation = {
    SIM_RACE_ID,
    SIMULATED_COMPETITORS,
    createRaceSimulation
  };
})();
