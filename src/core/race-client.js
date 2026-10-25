/**
 * src/core/race-client.js - Live Race Client Facade
 *
 * Creates isolated race clients and exposes their public API. Each client owns
 * one state object (LiveSplit.RaceState) and composes:
 * - race-host.js        local runner progress, undo, DNF, timing method, reset
 * - race-connection.js  therun.gg REST snapshot + room WebSocket
 * - race-hydration.js   catch-up of runners first seen mid-race, avatars
 * - race-protocol.js    therun.gg message parsing (via race-connection)
 * - race-ranking.js     F1 standings, gaps and intervals
 * - race-simulation.js  offline simulated race
 * - race-discovery.js   auto-detect, standby and connect cooldown
 * - race-logger.js      WebSocket telemetry log
 * plus event fan-out to subscribers and entrant mute / race pin visibility.
 */

(function () {
  "use strict";

  const STORAGE_KEYS = window.LiveSplit.Storage.KEYS;
  const { isValidUsername, isValidRaceCode, parseRaceId, loadStoredUsername } = window.LiveSplit.RaceIdentity;
  const { isLiveRoom } = window.LiveSplit.RaceState;

  /**
   * Factory to create an isolated Race Client instance.
   */
  function createRaceClient() {
    const raceState = window.LiveSplit.RaceState.createRaceState();
    // Shared with this client's controllers; they call each other through ctx.<fn> at call time
    const ctx = { raceState };
    window.LiveSplit.RaceConnection.installRaceConnection(ctx);
    window.LiveSplit.RaceHydration.installRaceHydration(ctx);
    window.LiveSplit.RaceHost.installRaceHost(ctx);
    let loggerInstance = null;
    function getLogger() {
      if (!loggerInstance && typeof window !== "undefined" && window.LiveSplit && window.LiveSplit.RaceLogger) {
        loggerInstance = window.LiveSplit.RaceLogger.createRaceLogger({
          notifyListeners
        });
      }
      return loggerInstance;
    }

    function recordWsLog(direction, type, data, raw) {
      const logger = getLogger();
      return logger ? logger.recordLog(direction, type, data, raw) : null;
    }

    function getWebSocketLogs() {
      const logger = getLogger();
      return logger ? logger.getLogs() : [];
    }

    function clearWebSocketLogs() {
      const logger = getLogger();
      if (logger) {
        logger.clearLogs();
      }
    }

    function setExternalHostConnected(connected) {
      raceState.isExternalLiveSplitConnected = Boolean(connected);
    }

    // Offline simulation engine (course, rivals, virtual clock), created on first use
    let simEngine = null;
    function getSimEngine() {
      if (!simEngine && typeof window !== "undefined" && window.LiveSplit && window.LiveSplit.RaceSimulation) {
        simEngine = window.LiveSplit.RaceSimulation.createRaceSimulation({
          getTimingMethod: () => raceState.currentTimingMethod,
          getStatus: () => raceState.raceStatus,
          setStatus: (s) => { raceState.raceStatus = s; },
          setCountdownTargetMs: (ms) => { raceState.countdownTargetMs = ms; },
          getCountdownSeconds: () => raceState.countdownSeconds,
          setCountdownSeconds: (sec) => { raceState.countdownSeconds = sec; },
          pushRaceEvent,
          notifyListeners,
          getEntrants: () => raceState.entrants,
          recentRaceEvents: raceState.recentRaceEvents,
          getHostState: () => raceState.hostState,
          getLastHostGameTimeSec: () => raceState.lastHostGameTimeSec,
          getLastHostRealTimeSec: () => raceState.lastHostRealTimeSec,
          updateHostProgress: ctx.updateHostProgress,
          clearRunStartLookupTimers,
          setStandby,
          setRaceId: (id) => { raceState.raceId = id; },
          getLastExternalHostUpdate: () => raceState.lastExternalHostUpdate,
          setLastHostTimes: (gt, rt) => {
            raceState.lastHostGameTimeSec = gt;
            raceState.lastHostRealTimeSec = rt;
          },
          loadStoredUsername,
          setHostUsername: ctx.setHostUsername,
          getHostUsername: () => raceState.hostUsername,
          lastKnownRanks: raceState.lastKnownRanks,
          checkpointRankHistory: raceState.checkpointRankHistory,
          isExternalHostConnected: () => raceState.isExternalLiveSplitConnected
        });
      }
      return simEngine;
    }

    function pushRaceEvent(evt) {
      if (!evt || !evt.text) return;
      const last = raceState.recentRaceEvents[raceState.recentRaceEvents.length - 1];
      if (last && last.text === evt.text && (evt.timestamp - last.timestamp) < 1500) {
        return;
      }
      raceState.recentRaceEvents.push(evt);
      if (raceState.recentRaceEvents.length > 20) {
        raceState.recentRaceEvents.shift();
      }
      notifyListeners("race_event", evt);
    }

    function getCountdownSec() {
      if (raceState.countdownTargetMs && raceState.countdownTargetMs > 0) {
        const diffMs = raceState.countdownTargetMs - Date.now();
        if (diffMs > 0) {
          return Math.ceil(diffMs / 1000);
        }
        if (diffMs > -2500) {
          return 0; // GO!
        }
        raceState.countdownTargetMs = null;
        return null;
      }
      if (typeof raceState.countdownSeconds === "number") {
        return raceState.countdownSeconds;
      }
      return null;
    }

    /**
     * Normalizes split times dictionary/array into a clean numeric array.
     */
    function normalizeSplitTimes(times) {
      return window.LiveSplit.RaceRanking.normalizeSplitTimes(times);
    }

    // Entrants map: userId -> Entrant Object

    // Event subscribers

    function notifyListeners(eventType, payload) {
      raceState.listeners.forEach((fn) => {
        try {
          fn(eventType, payload, getRankedEntrants());
        } catch (e) {
          console.warn("[RaceClient] Listener error:", e);
        }
      });
    }

    /**
     * Returns all entrants (host + competitors), sorted into F1 standings order.
     */
    // Course the running simulation races on (empty when not simulating)
    function getSimulationCourseTargets() {
      const se = getSimEngine();
      return (se && se.isSimulating()) ? se.getCourseTargets() : [];
    }

    function getRankedEntrants() {
      const seRank = getSimEngine();
      return window.LiveSplit.RaceRanking.calculateRankedEntrants({
        entrants: raceState.entrants,
        hostState: raceState.hostState,
        isSimulating: Boolean(seRank && seRank.isSimulating()),
        isLiveRace: isLiveRoom(raceState),
        currentTimingMethod: raceState.currentTimingMethod,
        activeSplitsList: raceState.activeSplitsList,
        activeComparisonTargets: ctx.getActiveComparisonTargets(),
        simulationCourseTargets: getSimulationCourseTargets(),
        lastKnownRanks: raceState.lastKnownRanks,
        checkpointRankHistory: raceState.checkpointRankHistory
      });
    }

    // ============================================================
    // RACE DISCOVERY & AUTO-DETECT ENGINE (delegated to LiveSplit.RaceDiscovery)
    // ============================================================

    let discoveryEngine = null;
    function getDiscovery() {
      if (!discoveryEngine && typeof window !== "undefined" && window.LiveSplit && window.LiveSplit.RaceDiscovery) {
        discoveryEngine = window.LiveSplit.RaceDiscovery.createRaceDiscovery({
          getSimEngine,
          isValidUsername,
          getHostUsername: () => raceState.hostUsername,
          notifyListeners,
          getRaceId: () => raceState.raceId,
          getWebSocket: () => raceState.ws,
          connectToRace: ctx.connectToRace,
          disconnectFromRace: ctx.disconnectFromRace,
          startSimulation,
          isSimStandby,
          onStop: () => {
            if (raceState.heartbeatTimer) {
              clearInterval(raceState.heartbeatTimer);
              raceState.heartbeatTimer = null;
            }
          }
        });
        if (raceState.hostUsername) {
          discoveryEngine.setAutoDetectUsername(raceState.hostUsername);
        }
      }
      return discoveryEngine;
    }

    function getConnectCooldownRemainingMs() {
      const d = getDiscovery();
      return d ? d.getConnectCooldownRemainingMs() : 0;
    }

    function clearRunStartLookupTimers() {
      const d = getDiscovery();
      if (d) d.clearRunStartLookupTimers();
    }

    function setStandby(val) {
      const d = getDiscovery();
      return d ? d.setStandby(val) : false;
    }

    function isStandby() {
      const d = getDiscovery();
      return d ? d.isStandby() : false;
    }

    function armSimulationStandby(splitsList = [], comparisonTimes = [], comparisonTimesRT = []) {
      const d = getDiscovery();
      if (d) {
        return d.armSimulationStandby(splitsList, comparisonTimes, comparisonTimesRT);
      }
      return { status: "sim_standby", isStandby: true, isSimStandby: true };
    }

    function resetConnectCooldown() {
      const d = getDiscovery();
      if (d) d.resetConnectCooldown();
    }

    function startAutoDetect(username) {
      const d = getDiscovery();
      return d ? d.startAutoDetect(username) : Promise.resolve({ status: "idle" });
    }

    function stopAutoDetect() {
      const d = getDiscovery();
      if (d) d.stopAutoDetect();
    }

    function pollUserStatus(usernameOverride, ignoreCooldown = false) {
      const d = getDiscovery();
      return d ? d.pollUserStatus(usernameOverride, ignoreCooldown) : Promise.resolve({ status: "idle", remainingMs: 0 });
    }

    function handleHostRunStarted(opts = {}) {
      const d = getDiscovery();
      return d ? d.handleHostRunStarted(opts) : Promise.resolve({ status: "idle" });
    }

    // ============================================================
    // LIVE RACE SIMULATION DELEGATION (LiveSplit.RaceSimulation)
    // ============================================================

    function startSimulation(splitsList = [], comparisonTimes = [], comparisonTimesRT = [], opts = {}) {
      const se = getSimEngine();
      return se ? se.startSimulation(splitsList, comparisonTimes, comparisonTimesRT, opts) : null;
    }

    function stopSimulation(keepRaceOpen) {
      const se = getSimEngine();
      return se ? se.stopSimulation(keepRaceOpen) : null;
    }

    function isSimulating() {
      const se = getSimEngine();
      return Boolean(se && se.isSimulating());
    }

    function isSimStandby() {
      const se = getSimEngine();
      return Boolean(se && se.isSimStandby());
    }

    // ============================================================
    // INTERACTIVE MUTE & CONTROLS
    // ============================================================

    function setEntrantMuted(userId, isMuted) {
      const e = raceState.entrants.get(userId);
      if (e) {
        e.isMuted = !!isMuted;
        notifyListeners("entrant_mute_changed", { userId, isMuted: e.isMuted });
      }
    }

    function toggleEntrantMuted(userId) {
      const e = raceState.entrants.get(userId);
      if (e) {
        setEntrantMuted(userId, !e.isMuted);
        return e.isMuted;
      }
      return false;
    }

    function areRacePinsVisible() {
      return !!raceState.racePinsVisible;
    }

    function setRacePinsVisible(visible) {
      raceState.racePinsVisible = !!visible;
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem(STORAGE_KEYS.RACE_PINS_VISIBLE, raceState.racePinsVisible ? "true" : "false");
        }
      } catch (_) {}
      notifyListeners("race_pins_visibility_changed", { visible: raceState.racePinsVisible });
      return raceState.racePinsVisible;
    }

    function toggleRacePinsVisible() {
      return setRacePinsVisible(!raceState.racePinsVisible);
    }

    // Client-level functions the controllers call through ctx.<name>
    Object.assign(ctx, {
      getSimulationCourseTargets,
      getLogger,
      recordWsLog,
      getWebSocketLogs,
      clearWebSocketLogs,
      setExternalHostConnected,
      getSimEngine,
      pushRaceEvent,
      getCountdownSec,
      normalizeSplitTimes,
      notifyListeners,
      getRankedEntrants,
      getDiscovery,
      getConnectCooldownRemainingMs,
      clearRunStartLookupTimers,
      setStandby,
      isStandby,
      armSimulationStandby,
      resetConnectCooldown,
      startAutoDetect,
      stopAutoDetect,
      pollUserStatus,
      handleHostRunStarted,
      startSimulation,
      stopSimulation,
      isSimulating,
      isSimStandby,
      setEntrantMuted,
      toggleEntrantMuted,
      areRacePinsVisible,
      setRacePinsVisible,
      toggleRacePinsVisible
    });

    return {
      init(opts = {}) {
        if (opts.username) {
          ctx.setHostUsername(opts.username);
        }
      },
      parseRaceId,
      isValidRaceCode,
      isValidUsername,
      fetchRaceData: ctx.fetchRaceData,
      connectToRace: ctx.connectToRace,
      disconnectFromRace: ctx.disconnectFromRace,
      startAutoDetect,
      stopAutoDetect,
      pollUserStatus,
      handleHostRunStarted,
      armSimulationStandby,
      isStandby,
      isSimStandby,
      setStandby,
      getConnectCooldownRemainingMs,
      resetConnectCooldown,
      setHostUsername: ctx.setHostUsername,
      getHostUsername: ctx.getHostUsername,
      getHostState: () => Object.assign({}, raceState.hostState),
      setHostDNF: ctx.setHostDNF,
      isHostDNF: ctx.isHostDNF,
      handleUndoSplit: ctx.handleUndoSplit,
      setEntrantDNF: ctx.setEntrantDNF,
      setTimingMethod: ctx.setTimingMethod,
      setExternalHostConnected,
      isExternalHostConnected: () => raceState.isExternalLiveSplitConnected,
      getTimingMethod: ctx.getTimingMethod,
      startSimulation,
      stopSimulation,
      isSimulating,
      isConnected: () => Boolean(raceState.raceId && !isSimulating()),
      getRaceId: () => raceState.raceId,
      getRaceStatus: () => raceState.raceStatus,
      getCountdownSec,
      getRecentEvents: () => raceState.recentRaceEvents.slice(),
      getLatestEvent: () => (raceState.recentRaceEvents.length > 0 ? raceState.recentRaceEvents[raceState.recentRaceEvents.length - 1] : null),
      updateHostProgress: ctx.updateHostProgress,
      handleRaceMessage: ctx.handleRaceMessage,
      getRankedEntrants,
      setEntrantMuted,
      toggleEntrantMuted,
      areRacePinsVisible,
      setRacePinsVisible,
      toggleRacePinsVisible,
      getWebSocketLogs,
      clearWebSocketLogs,
      recordWsLog,
      reset: ctx.reset,
      subscribe(fn) {
        raceState.listeners.add(fn);
        return () => raceState.listeners.delete(fn);
      }
    };
  }

  // Export to namespace
  const defaultClient = createRaceClient();
  defaultClient.createRaceClient = createRaceClient;
  defaultClient.instance = defaultClient;

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.RaceClient = defaultClient;
  window.createLiveSplitRaceClient = createRaceClient;
  window.LiveSplitRaceClient = defaultClient;
  window.getRaceWsLogs = () => defaultClient.getWebSocketLogs();
  window.clearRaceWsLogs = () => defaultClient.clearWebSocketLogs();

})();
