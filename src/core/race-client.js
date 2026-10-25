/**
 * src/core/race-client.js - Live Race Client & Telemetry Engine
 * 
 * Manages live online speedrun race synchronization:
 * - Real-time connection to therun.gg race telemetry & WebSockets
 * - Zero-click auto-detection via user live status (detects raceId)
 * - Local high-fidelity Race Simulation Mode for offline testing & development
 * - F1-style continuous position ranking, leader gap, and interval calculations
 */

(function () {
  "use strict";

  const THERUN_LIVE_API = "https://therun.gg/api/live";
  const THERUN_RACE_API = "https://races.therun.gg";
  const THERUN_WS_BASE = "wss://ws.therun.gg?race=";

  // Preset colors for competitor pins and leaderboard
  const RACER_PALETTE = [
    "#38bdf8", // Sky Cyan
    "#f59e0b", // Amber / Gold
    "#ec4899", // Neon Pink
    "#10b981", // Emerald Green
    "#a855f7", // Violet
    "#f97316", // Coral Orange
    "#06b6d4", // Cyan
    "#eab308", // Yellow
    "#8b5cf6", // Purple
    "#14b8a6"  // Teal
  ];

  // Virtual competitors for simulation mode (delegated to LiveSplit.RaceSimulation)
  const SIMULATED_COMPETITORS = (window.LiveSplit && window.LiveSplit.RaceSimulation)
    ? window.LiveSplit.RaceSimulation.SIMULATED_COMPETITORS
    : [];

  /**
   * Validates that a string is a safe, strict username (alphanumeric, underscore, hyphen; no URLs or path/script chars).
   */
  function isValidUsername(str) {
    if (!str || typeof str !== "string") return false;
    const s = str.trim();
    if (!s || s.length > 50) return false;
    return /^[a-zA-Z0-9_-]+$/.test(s);
  }

  /**
   * Validates that a string is a safe, strict therun.gg race room code (alphanumeric/underscore/hyphen; no URLs, slashes, or colons).
   */
  function isValidRaceCode(str) {
    if (!str || typeof str !== "string") return false;
    const s = str.trim();
    if (s.length < 2 || s.length > 24) return false;
    return /^[a-zA-Z0-9_-]+$/.test(s);
  }

  /**
   * Safely loads the stored therun username from local storage.
   */
  function loadStoredUsername() {
    try {
      if (typeof localStorage !== "undefined") {
        const val = (localStorage.getItem("therun_username") || "").trim();
        if (!isValidUsername(val)) {
          if (val) localStorage.removeItem("therun_username");
          return "";
        }
        return val;
      }
    } catch (_) {}
    return "";
  }

  /**
   * Factory to create an isolated Race Client instance.
   */
  function createRaceClient() {
    let raceId = null;
    let ws = null;
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
    let heartbeatTimer = null;
    let isExternalLiveSplitConnected = false;

    function setExternalHostConnected(connected) {
      isExternalLiveSplitConnected = Boolean(connected);
    }
    let racePinsVisible = (function () {
      try {
        if (typeof localStorage !== "undefined") {
          return localStorage.getItem("livesplit_race_pins_visible") !== "false";
        }
      } catch (_) {}
      return true;
    })();
    let hostUsername = "";
    let currentTimingMethod = "GameTime";
    let activeSplitsList = [];
    let activeComparisonTimes = [];
    let activeComparisonTimesRT = [];
    let simulationCourseTargets = [];
    let simulationCourseTargetsRT = [];
    const lastKnownRanks = new Map();
    const checkpointRankHistory = new Map();
    let lastExternalHostUpdate = 0;
    let lastHostGameTimeSec = 0;
    let lastHostRealTimeSec = 0;
    let lastHostCompletedSplitsGT = [];
    let lastHostCompletedSplitsRT = [];
    let raceStatus = "open"; // "open" | "starting" | "in_progress" | "finished"
    let countdownTargetMs = null;
    let countdownSeconds = null;
    const recentRaceEvents = [];

    // Course targets, virtual clock, and PB checkpoints are delegated to LiveSplit.RaceSimulation
    // (simulationCourseTargets, simVirtualSec, pbCheckpointTimes, if (hostState.currentTimeSec > 0))
    let simEngine = null;
    function getSimEngine() {
      if (!simEngine && typeof window !== "undefined" && window.LiveSplit && window.LiveSplit.RaceSimulation) {
        simEngine = window.LiveSplit.RaceSimulation.createRaceSimulation({
          getTimingMethod: () => currentTimingMethod,
          getStatus: () => raceStatus,
          setStatus: (s) => { raceStatus = s; },
          setCountdownTargetMs: (ms) => { countdownTargetMs = ms; },
          getCountdownSeconds: () => countdownSeconds,
          setCountdownSeconds: (sec) => { countdownSeconds = sec; },
          pushRaceEvent,
          notifyListeners,
          getEntrants: () => entrants,
          recentRaceEvents,
          getHostState: () => hostState,
          getLastHostGameTimeSec: () => lastHostGameTimeSec,
          getLastHostRealTimeSec: () => lastHostRealTimeSec,
          updateHostProgress,
          clearRunStartLookupTimers,
          setStandby,
          setRaceId: (id) => { raceId = id; },
          getLastExternalHostUpdate: () => lastExternalHostUpdate,
          setLastHostTimes: (gt, rt) => {
            lastHostGameTimeSec = gt;
            lastHostRealTimeSec = rt;
          },
          loadStoredUsername,
          setHostUsername,
          getHostUsername: () => hostUsername,
          lastKnownRanks,
          checkpointRankHistory,
          isExternalHostConnected: () => isExternalLiveSplitConnected
        });
      }
      return simEngine;
    }

    function pushRaceEvent(evt) {
      if (!evt || !evt.text) return;
      const last = recentRaceEvents[recentRaceEvents.length - 1];
      if (last && last.text === evt.text && (evt.timestamp - last.timestamp) < 1500) {
        return;
      }
      recentRaceEvents.push(evt);
      if (recentRaceEvents.length > 20) {
        recentRaceEvents.shift();
      }
      notifyListeners("race_event", evt);
    }

    function getCountdownSec() {
      if (countdownTargetMs && countdownTargetMs > 0) {
        const diffMs = countdownTargetMs - Date.now();
        if (diffMs > 0) {
          return Math.ceil(diffMs / 1000);
        }
        if (diffMs > -2500) {
          return 0; // GO!
        }
        countdownTargetMs = null;
        return null;
      }
      if (typeof countdownSeconds === "number") {
        return countdownSeconds;
      }
      return null;
    }

    /**
     * Normalizes split times dictionary/array into a clean numeric array.
     */
    function normalizeSplitTimes(times) {
      if (window.LiveSplit && window.LiveSplit.RaceRanking && typeof window.LiveSplit.RaceRanking.normalizeSplitTimes === "function") {
        return window.LiveSplit.RaceRanking.normalizeSplitTimes(times);
      }
      if (!times) return [];
      if (Array.isArray(times)) {
        return times
          .map(t => (typeof t === "number" ? t : parseFloat(t)))
          .filter(t => typeof t === "number" && !isNaN(t));
      }
      return [];
    }

    // Entrants map: userId -> Entrant Object
    const entrants = new Map();

    // Event subscribers
    const listeners = new Set();

    // Local host runner state
    let hostState = {
      userId: "you",
      username: hostUsername || "You",
      isHost: true,
      avatar: "",
      color: "#38bdf8",
      currentSplitIndex: 0,
      currentSplitName: "Start",
      currentTimeSec: 0,
      splitTimes: [],
      isFinished: false,
      finalTimeSec: null,
      isDNF: false,
      dnfTimeSec: null,
      score: 0,
      isMuted: false
    };

    function setHostDNF(isDnf = true) {
      hostState.isDNF = !!isDnf;
      if (hostState.isDNF) {
        hostState.dnfTimeSec = hostState.currentTimeSec || 0;
        hostState.currentSplitName = "DNF";
      } else {
        hostState.dnfTimeSec = null;
        hostState.currentSplitName = (activeSplitsList && activeSplitsList[hostState.currentSplitIndex]) || "Start";
      }
      entrants.set(hostState.userId, Object.assign({}, hostState));
      notifyListeners("entrant_updated", { runnerId: hostState.userId, isDNF: hostState.isDNF });
    }

    /**
     * Handles LiveSplit Undo Split: cleanly rolls back host checkpoint,
     * trims split times, and clears completion effects.
     */
    function handleUndoSplit(newIdx, oldIdx) {
      const targetIdx = Math.max(0, typeof newIdx === "number" ? newIdx : 0);
      hostState.currentSplitIndex = targetIdx;
      hostState.isFinished = false;
      hostState.finalTimeSec = null;
      hostState.lastSplitEffect = null;
      hostState.isDNF = false;
      hostState.dnfTimeSec = null;

      if (Array.isArray(hostState.splitTimes)) {
        hostState.splitTimes = hostState.splitTimes.slice(0, targetIdx);
      }
      if (Array.isArray(lastHostCompletedSplitsGT)) {
        lastHostCompletedSplitsGT = lastHostCompletedSplitsGT.slice(0, targetIdx);
      }
      if (Array.isArray(lastHostCompletedSplitsRT)) {
        lastHostCompletedSplitsRT = lastHostCompletedSplitsRT.slice(0, targetIdx);
      }

      const sName = (activeSplitsList && activeSplitsList[targetIdx])
        ? activeSplitsList[targetIdx]
        : (targetIdx >= 0 ? `Split ${targetIdx + 1}` : "Start");
      hostState.currentSplitName = sName;

      // Rewind virtual host if in simulation
      const seUndo = getSimEngine();
      if (seUndo && seUndo.isSimulating()) {
        seUndo.handleUndoSplit(targetIdx);
      }

      const hostEntrant = entrants.get(hostState.userId);
      if (hostEntrant) {
        Object.assign(hostEntrant, hostState);
      }
      entrants.forEach((racer) => {
        if (racer.isHost && racer.userId !== hostState.userId) {
          racer.currentSplitIndex = hostState.currentSplitIndex;
          racer.currentSplitName = hostState.currentSplitName;
          racer.isFinished = false;
          racer.finalTimeSec = null;
          racer.lastSplitEffect = null;
          if (Array.isArray(racer.splitTimes)) {
            racer.splitTimes = racer.splitTimes.slice(0, targetIdx);
          }
        }
      });

      // Roll back checkpoint rank history for undone splits
      checkpointRankHistory.forEach((histMap, c) => {
        if (c >= targetIdx) {
          histMap.delete(hostState.userId);
          entrants.forEach((racer) => {
            if (racer.isHost) {
              histMap.delete(racer.userId);
            }
          });
        }
      });

      notifyListeners("entrant_updated", { runnerId: hostState.userId });
    }

    function isHostDNF() {
      return !!hostState.isDNF;
    }

    function setEntrantDNF(userId, isDnf = true) {
      const e = entrants.get(userId);
      if (e) {
        e.isDNF = !!isDnf;
        if (e.isDNF) {
          e.dnfTimeSec = e.currentTimeSec || 0;
          e.currentSplitName = "DNF";
        } else {
          e.dnfTimeSec = null;
        }
        notifyListeners("entrant_updated", { runnerId: userId, isDNF: e.isDNF });
      }
    }

    function setHostUsername(name) {
      const cleaned = (name || "").trim();
      if (cleaned && !isValidUsername(cleaned)) {
        // Reject URLs or invalid characters; preserve existing valid username
        hostUsername = loadStoredUsername();
      } else {
        hostUsername = cleaned;
        const d = getDiscovery();
        if (d) {
          d.setAutoDetectUsername(hostUsername);
        }
      }
      hostState.username = hostUsername || "You";

      const seHost = getSimEngine();
      if (seHost && seHost.isSimulating()) {
        const hostEntrant = entrants.get(hostState.userId);
        if (hostEntrant) {
          hostEntrant.username = hostState.username;
        }
      } else {
        // In live race, update isHost on entrants matching hostUsername
        entrants.forEach((entrant) => {
          if (entrant.userId === hostState.userId) {
            entrant.username = hostState.username;
            entrant.isHost = true;
            entrant.color = "#38bdf8";
            return;
          }
          const isMatch = !!(hostUsername && (
            String(entrant.username || "").trim().toLowerCase() === hostUsername.toLowerCase() ||
            String(entrant.userId || "").trim().toLowerCase() === hostUsername.toLowerCase()
          ));
          entrant.isHost = isMatch;
          if (isMatch) {
            entrant.color = "#38bdf8";
          }
        });
      }

      notifyListeners("entrants_update", null);
    }

    function getHostUsername() {
      return hostUsername;
    }

    function notifyListeners(eventType, payload) {
      listeners.forEach((fn) => {
        try {
          fn(eventType, payload, getRankedEntrants());
        } catch (e) {
          console.warn("[RaceClient] Listener error:", e);
        }
      });
    }

    /**
     * Validates and normalizes a strict race room code (e.g. "tzsm" or "f0ub"). Rejects URLs or unsafe strings.
     */
    function parseRaceId(input) {
      if (!input || typeof input !== "string") return null;
      const trimmed = input.trim();
      if (!isValidRaceCode(trimmed)) return null;
      return trimmed;
    }

    function getActiveComparisonTargets() {
      const isRT = (currentTimingMethod === "RealTime");
      if (isRT) {
        if (activeComparisonTimesRT && activeComparisonTimesRT.length > 0) return activeComparisonTimesRT;
        if (activeComparisonTimes && activeComparisonTimes.length > 0) return activeComparisonTimes;
      } else {
        if (activeComparisonTimes && activeComparisonTimes.length > 0) return activeComparisonTimes;
        if (activeComparisonTimesRT && activeComparisonTimesRT.length > 0) return activeComparisonTimesRT;
      }
      if (simulationCourseTargets && simulationCourseTargets.length > 0) return simulationCourseTargets;
      return [30, 60, 90, 120, 150, 180, 210, 240];
    }

    function setTimingMethod(method) {
      if (method === "GameTime" || method === "RealTime") {
        currentTimingMethod = method;
        syncTimingMethod();
        notifyListeners("timing_method_changed", { timingMethod: currentTimingMethod });
      }
    }

    function getTimingMethod() {
      return currentTimingMethod;
    }

    function syncTimingMethod() {
      const isRT = (currentTimingMethod === "RealTime");
      if (isRT) {
        hostState.currentTimeSec = lastHostRealTimeSec > 0 ? lastHostRealTimeSec : lastHostGameTimeSec;
        hostState.splitTimes = lastHostCompletedSplitsRT.length > 0 ? lastHostCompletedSplitsRT : lastHostCompletedSplitsGT;
      } else {
        hostState.currentTimeSec = lastHostGameTimeSec > 0 ? lastHostGameTimeSec : lastHostRealTimeSec;
        hostState.splitTimes = lastHostCompletedSplitsGT.length > 0 ? lastHostCompletedSplitsGT : lastHostCompletedSplitsRT;
      }
      const hostEntrant = entrants.get(hostState.userId);
      if (hostEntrant) {
        Object.assign(hostEntrant, hostState);
      }

      const seSync = getSimEngine();
      if (seSync && seSync.isSimulating()) {
        seSync.onTimingMethodChanged(isRT);
      }
      notifyListeners("progress_update", { runnerId: hostState.userId });
    }

    function getCourseRefTime(runner) {
      if (window.LiveSplit && window.LiveSplit.RaceRanking) {
        return window.LiveSplit.RaceRanking.getCourseRefTime(runner, getActiveComparisonTargets());
      }
      return 0;
    }

    /**
     * Calculates the milestone-based gap between two competitors.
     * Evaluated against checkpoint split times rather than interpolated curve approximations.
     */
    function calculateMilestoneGap(runner, aheadRunner) {
      if (window.LiveSplit && window.LiveSplit.RaceRanking) {
        return window.LiveSplit.RaceRanking.calculateMilestoneGap(runner, aheadRunner, getActiveComparisonTargets());
      }
      return null;
    }

    function getCompletedSplitCount(runner) {
      if (window.LiveSplit && window.LiveSplit.RaceRanking) {
        return window.LiveSplit.RaceRanking.getCompletedSplitCount(runner, activeSplitsList);
      }
      return 0;
    }

    function getSplitCheckpointTime(runner, c) {
      if (window.LiveSplit && window.LiveSplit.RaceRanking) {
        return window.LiveSplit.RaceRanking.getSplitCheckpointTime(runner, c, activeSplitsList);
      }
      return null;
    }

    function formatGapTime(sec) {
      if (window.LiveSplit && window.LiveSplit.RaceRanking) {
        return window.LiveSplit.RaceRanking.formatGapTime(sec);
      }
      return "--";
    }

    /**
     * Returns all entrants (host + competitors), sorted into F1 standings order.
     */
    function getRankedEntrants() {
      if (window.LiveSplit && window.LiveSplit.RaceRanking) {
        const seRank = getSimEngine();
        return window.LiveSplit.RaceRanking.calculateRankedEntrants({
          entrants,
          hostState,
          isSimulating: Boolean(seRank && seRank.isSimulating()),
          isLiveRace: Boolean(ws !== null || (raceId && raceId !== "sim_cup_2026")),
          currentTimingMethod,
          activeSplitsList,
          activeComparisonTargets: getActiveComparisonTargets(),
          simulationCourseTargets,
          lastKnownRanks,
          checkpointRankHistory
        });
      }
      return Array.from(entrants.values());
    }

    /**
     * Updates the host runner's in-run progress.
     */
    function updateHostProgress(currentSec, currentIndex, completedSplitTimes = [], comparisonTimes = [], currentSplitName = "", splitsList = [], splitFlash = null, isExternal = true, realTimeSec = null, comparisonTimesRT = [], completedSplitTimesRT = [], activeTimingMethod = null) {
      if (activeTimingMethod === "GameTime" || activeTimingMethod === "RealTime") {
        currentTimingMethod = activeTimingMethod;
      }
      if (isExternal) {
        lastExternalHostUpdate = Date.now();
      }
      if (Array.isArray(splitsList) && splitsList.length > 0) {
        activeSplitsList = splitsList;
      }
      if (Array.isArray(comparisonTimes) && comparisonTimes.length > 0) {
        activeComparisonTimes = comparisonTimes;
      }
      if (Array.isArray(comparisonTimesRT) && comparisonTimesRT.length > 0) {
        activeComparisonTimesRT = comparisonTimesRT;
      } else if (activeComparisonTimesRT.length === 0 && activeComparisonTimes.length > 0) {
        activeComparisonTimesRT = [...activeComparisonTimes];
      }

      const raceClockSec = (typeof realTimeSec === "number" && realTimeSec > 0)
        ? realTimeSec
        : Math.max(0, currentSec || 0);
      lastHostRealTimeSec = raceClockSec;

      if (currentTimingMethod === "GameTime") {
        lastHostGameTimeSec = Math.max(0, currentSec || 0);
      } else {
        if (typeof currentSec === "number" && currentSec > 0 && currentSec !== realTimeSec) {
          lastHostGameTimeSec = currentSec;
        } else if (lastHostGameTimeSec === 0) {
          lastHostGameTimeSec = lastHostRealTimeSec;
        }
      }

      const normCompletedGT = normalizeSplitTimes(completedSplitTimes);
      const normCompletedRT = normalizeSplitTimes(completedSplitTimesRT);
      lastHostCompletedSplitsGT = normCompletedGT;
      lastHostCompletedSplitsRT = normCompletedRT;

      const isRT = (currentTimingMethod === "RealTime");
      hostState.currentTimeSec = isRT ? lastHostRealTimeSec : lastHostGameTimeSec;

      if (currentIndex < hostState.currentSplitIndex) {
        // Rollback / Undo split detected
        hostState.currentSplitIndex = Math.max(0, currentIndex || 0);
        hostState.isFinished = false;
        hostState.finalTimeSec = null;
        hostState.lastSplitEffect = null;
        if (Array.isArray(hostState.splitTimes)) {
          hostState.splitTimes = hostState.splitTimes.slice(0, hostState.currentSplitIndex);
        }
        checkpointRankHistory.forEach((histMap, c) => {
          if (c >= hostState.currentSplitIndex) {
            histMap.delete(hostState.userId);
          }
        });
      } else {
        hostState.currentSplitIndex = Math.max(0, currentIndex || 0);
      }

      if (isRT) {
        hostState.splitTimes = normCompletedRT.length > 0 ? normCompletedRT : normCompletedGT;
      } else {
        hostState.splitTimes = normCompletedGT.length > 0 ? normCompletedGT : normCompletedRT;
      }

      let hostSplitName = currentSplitName;
      if (!hostSplitName) {
        if (currentIndex < 0) {
          hostSplitName = "Start";
        } else if (activeSplitsList && activeSplitsList[currentIndex]) {
          hostSplitName = activeSplitsList[currentIndex];
        } else if (comparisonTimes && currentIndex >= comparisonTimes.length) {
          hostSplitName = "Finished";
        } else {
          hostSplitName = `Split ${currentIndex + 1}`;
        }
      }
      hostState.currentSplitName = hostSplitName;

      if (splitFlash && splitFlash.type) {
        const completedName = splitFlash.completedSplitName
          || hostState.currentSplitName
          || (activeSplitsList && activeSplitsList[Math.max(0, currentIndex - 1)])
          || (currentIndex > 0 ? `Split ${currentIndex}` : "Start");
        const newName = splitFlash.newSplitName || hostSplitName;
        hostState.lastSplitEffect = {
          type: splitFlash.type,
          timestamp: splitFlash.timestamp || Date.now(),
          completedSplitName: completedName,
          newSplitName: newName
        };
      } else if (hostState.lastSplitEffect && (Date.now() - (hostState.lastSplitEffect.timestamp || 0)) > 4200) {
        hostState.lastSplitEffect = null;
      }

      // Calculate in-segment progress ratio
      let ratio = 0;
      if (currentIndex >= 0 && comparisonTimes && currentIndex < comparisonTimes.length) {
        const curTarget = comparisonTimes[currentIndex];
        const prevTarget = currentIndex > 0 ? (comparisonTimes[currentIndex - 1] || 0) : 0;
        const dur = (curTarget && prevTarget) ? (curTarget - prevTarget) : (curTarget || 30);
        
        let lastSplitSec = 0;
        if (completedSplitTimes && currentIndex > 0) {
          for (let k = currentIndex - 1; k >= 0; k--) {
            if (completedSplitTimes[k] !== undefined && completedSplitTimes[k] !== null && completedSplitTimes[k] > 0) {
              lastSplitSec = completedSplitTimes[k];
              break;
            }
          }
          if (lastSplitSec === 0 && prevTarget > 0) {
            lastSplitSec = prevTarget;
          }
        }
        
        const inSeg = Math.max(0, (currentSec || 0) - lastSplitSec);
        ratio = dur > 0 ? Math.max(0, Math.min(1.0, inSeg / dur)) : 0;
      }

      hostState.score = hostState.currentSplitIndex + ratio;

      if (comparisonTimes && currentIndex >= comparisonTimes.length - 1 && ratio >= 1.0) {
        hostState.isFinished = true;
        hostState.currentSplitName = "Finished";
        if (!hostState.finalTimeSec) hostState.finalTimeSec = currentSec;
      }

      entrants.set(hostState.userId, Object.assign({}, hostState));

      // In simulation mode, update simulated competitors synchronously with the active focused timer
      const seProg = getSimEngine();
      if (seProg && seProg.isSimulating()) {
        const isRT = (currentTimingMethod === "RealTime");
        const activeHostSec = isRT ? lastHostRealTimeSec : (lastHostGameTimeSec || hostState.currentTimeSec);
        seProg.tickSimulatedCompetitors(activeHostSec, 0);
      } else if (hostUsername) {
        entrants.forEach((racer) => {
          if (racer.isHost && racer.userId !== hostState.userId) {
            racer.currentTimeSec = hostState.currentTimeSec;
            racer.currentSplitIndex = hostState.currentSplitIndex;
            racer.currentSplitName = hostState.currentSplitName;
            racer.score = hostState.score;
            if (hostState.lastSplitEffect) {
              racer.lastSplitEffect = hostState.lastSplitEffect;
            }
            if (hostState.isFinished) {
              racer.isFinished = true;
              racer.finalTimeSec = hostState.finalTimeSec;
            }
          }
        });
      }

      notifyListeners("progress_update", { runnerId: hostState.userId });
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
          getHostUsername: () => hostUsername,
          notifyListeners,
          getRaceId: () => raceId,
          getWebSocket: () => ws,
          connectToRace,
          disconnectFromRace,
          startSimulation,
          isSimStandby,
          onStop: () => {
            if (heartbeatTimer) {
              clearInterval(heartbeatTimer);
              heartbeatTimer = null;
            }
          }
        });
        if (hostUsername) {
          discoveryEngine.setAutoDetectUsername(hostUsername);
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
    // WEBSOCKET RACE CONNECTION (therun.gg)
    // ============================================================

    async function fetchRaceData(targetRaceId) {
      const cleanId = parseRaceId(targetRaceId || raceId);
      if (!cleanId || typeof fetch !== "function") return null;

      try {
        const raceUrl = `${THERUN_RACE_API}/${encodeURIComponent(cleanId)}`;
        const res = await fetch(raceUrl);
        if (raceId !== cleanId) return null;

        let racePayload = null;
        if (res && res.ok) {
          const json = await res.json();
          racePayload = (json && json.result !== undefined) ? json.result : json;
          if (racePayload) {
            recordWsLog("in", "http_race_snapshot", racePayload);
            handleRaceMessage(racePayload);
          }
        }

        // Only fetch /participants separately if the main race payload didn't already include participants
        if (!racePayload || !Array.isArray(racePayload.participants)) {
          const partUrl = `${THERUN_RACE_API}/${encodeURIComponent(cleanId)}/participants`;
          const pRes = await fetch(partUrl);
          if (raceId !== cleanId) return racePayload;
          if (pRes && pRes.ok) {
            const pJson = await pRes.json();
            const partPayload = (pJson && pJson.result !== undefined) ? pJson.result : pJson;
            if (partPayload) {
              recordWsLog("in", "http_participants_snapshot", partPayload);
              handleRaceMessage(partPayload);
            }
          }
        }

        return racePayload;
      } catch (err) {
        console.warn("[RaceClient] Direct fetch failed (races.therun.gg omits CORS headers for browser fetch; active runs stream via WebSocket):", err);
        return null;
      }
    }

    function connectToRace(targetRaceId) {
      const cleanId = parseRaceId(targetRaceId);
      if (!cleanId) return false;

      if (raceId === cleanId && ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return true;
      }

      disconnectFromRace();
      raceId = cleanId;
      const d = getDiscovery();
      if (d) {
        d.recordConnectAttempt();
      }

      // Immediately fetch race snapshot and participants from the HTTP REST API (6nkfyze0o7)
      fetchRaceData(cleanId);

      try {
        const wsUrl = `${THERUN_WS_BASE}${encodeURIComponent(cleanId)}`;
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          recordWsLog("sys", "ws_connected", { raceId: cleanId, url: wsUrl });
          console.log(`[RaceClient] Connected to live race: ${cleanId}`);
          notifyListeners("race_connected", { raceId: cleanId });
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            const msgType = (msg && (msg.type || (msg.data && msg.data.type) || "message")) || "message";
            recordWsLog("in", msgType, msg, event.data);
            handleRaceMessage(msg);
          } catch (e) {
            recordWsLog("sys", "parse_error", { error: String(e), raw: event.data }, event.data);
            console.warn("[RaceClient] Message parse error:", e);
          }
        };

        ws.onclose = (event) => {
          recordWsLog("sys", "ws_closed", { raceId: cleanId, code: event && event.code, reason: event && event.reason });
          console.log("[RaceClient] Race WebSocket closed");
          if (raceId === cleanId) {
            ws = null;
          }
        };

        ws.onerror = (err) => {
          recordWsLog("sys", "ws_error", { raceId: cleanId });
          console.warn("[RaceClient] WebSocket error:", err);
        };

        notifyListeners("race_connected", { raceId: cleanId });
        return true;
      } catch (err) {
        console.error("[RaceClient] Failed to connect to race WebSocket:", err);
        raceId = null;
      raceStatus = "open";
      countdownTargetMs = null;
      countdownSeconds = null;
      recentRaceEvents.length = 0;
        ws = null;
        return false;
      }
    }

    function disconnectFromRace() {
      if (raceId) {
        recordWsLog("sys", "disconnected", { raceId });
      }
      clearRunStartLookupTimers();
      setStandby(false);
      if (ws) {
        try {
          ws.close();
        } catch (_) {}
        ws = null;
      }
      raceId = null;
      raceStatus = "open";
      countdownTargetMs = null;
      countdownSeconds = null;
      recentRaceEvents.length = 0;
      hostState.username = hostUsername || "You";
      hostState.isHost = true;
      hostState.color = "#38bdf8";

      entrants.clear();
      entrants.set(hostState.userId, Object.assign({}, hostState));
      lastKnownRanks.clear();
      checkpointRankHistory.clear();
      notifyListeners("race_disconnected", null);
    }

    function getProtocolContext() {
      return {
        entrants,
        hostState,
        hostUsername,
        RACER_PALETTE,
        activeSplitsList,
        isLiveRoom: Boolean(ws !== null || (raceId && raceId !== "sim_cup_2026")),
        getRaceStatus: () => raceStatus,
        setRaceStatus: (s) => { raceStatus = s; },
        getCountdownTargetMs: () => countdownTargetMs,
        setCountdownTargetMs: (ms) => { countdownTargetMs = ms; },
        getCountdownSeconds: () => countdownSeconds,
        setCountdownSeconds: (s) => { countdownSeconds = s; },
        lastKnownRanks,
        checkpointRankHistory,
        pushRaceEvent,
        notifyListeners
      };
    }

    function handleRaceMessage(msg) {
      if (window.LiveSplit && window.LiveSplit.RaceProtocol) {
        return window.LiveSplit.RaceProtocol.parseRaceMessage(msg, getProtocolContext());
      }
    }

    function updateEntrantFromTelemetry(data) {
      if (window.LiveSplit && window.LiveSplit.RaceProtocol) {
        return window.LiveSplit.RaceProtocol.updateEntrantFromTelemetry(data, getProtocolContext());
      }
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
      const e = entrants.get(userId);
      if (e) {
        e.isMuted = !!isMuted;
        notifyListeners("entrant_mute_changed", { userId, isMuted: e.isMuted });
      }
    }

    function toggleEntrantMuted(userId) {
      const e = entrants.get(userId);
      if (e) {
        setEntrantMuted(userId, !e.isMuted);
        return e.isMuted;
      }
      return false;
    }

    function areRacePinsVisible() {
      return !!racePinsVisible;
    }

    function setRacePinsVisible(visible) {
      racePinsVisible = !!visible;
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("livesplit_race_pins_visible", racePinsVisible ? "true" : "false");
        }
      } catch (_) {}
      notifyListeners("race_pins_visibility_changed", { visible: racePinsVisible });
      return racePinsVisible;
    }

    function toggleRacePinsVisible() {
      return setRacePinsVisible(!racePinsVisible);
    }

    function reset() {
      const seReset = getSimEngine();
      if (!(seReset && seReset.isSimulating()) && (ws !== null || (raceId && raceId !== "sim_cup_2026"))) {
        hostState.currentTimeSec = 0;
        hostState.currentSplitIndex = 0;
        hostState.currentSplitName = "Start";
        hostState.score = 0;
        hostState.isFinished = false;
        hostState.finalTimeSec = null;
        hostState.isDNF = false;
        hostState.dnfTimeSec = null;
        hostState.splitTimes = [];
        const hostEntry = entrants.get(hostState.userId);
        if (hostEntry) Object.assign(hostEntry, hostState);
        notifyListeners("entrant_updated", null);
        return;
      }
      lastExternalHostUpdate = 0;
      lastHostGameTimeSec = 0;
      lastHostRealTimeSec = 0;
      lastHostCompletedSplitsGT = [];
      lastHostCompletedSplitsRT = [];
      activeComparisonTimesRT = [];
      hostState.currentTimeSec = 0;
      hostState.currentSplitIndex = 0;
      hostState.currentSplitName = "Start";
      hostState.score = 0;
      hostState.isFinished = false;
      hostState.finalTimeSec = null;
      hostState.isDNF = false;
      hostState.dnfTimeSec = null;
      hostState.splitTimes = [];
      hostState.lastSplitEffect = null;
      hostState.hasCrown = false;
      hostState.crownSegmentName = null;
      hostState.crownSegmentTime = null;
      hostState.segmentRibbon = null;
      hostState.ribbonSegmentName = null;
      hostState.ribbonSegmentTime = null;
      hostState.positionDelta = 0;
      hostState.positionDeltaDisplay = "-";

      entrants.forEach((racer) => {
        if (racer.isHost) {
          Object.assign(racer, hostState);
        } else {
          racer.currentTimeSec = 0;
          racer.currentTimeSecGT = 0;
          racer.currentTimeSecRT = 0;
          racer.currentSplitIndex = 0;
          racer.currentSplitName = activeSplitsList[0] || "Split 1";
          racer.splitTimes = [];
          racer.splitTimesGT = [];
          racer.splitTimesRT = [];
          racer.score = 0;
          racer.isFinished = false;
          racer.finalTimeSec = null;
          racer.isDNF = false;
          racer.dnfTimeSec = null;
          racer.lastSplitEffect = null;
          racer.hasCrown = false;
          racer.crownSegmentName = null;
          racer.crownSegmentTime = null;
          racer.segmentRibbon = null;
          racer.ribbonSegmentName = null;
          racer.ribbonSegmentTime = null;
          racer.positionDelta = 0;
          racer.positionDeltaDisplay = "-";
        }
      });

      lastKnownRanks.clear();
      checkpointRankHistory.clear();

      if (seReset && seReset.isSimulating()) {
        seReset.resetSimulation();
      }
      notifyListeners("race_reset", null);
      if (typeof window !== "undefined" && window.LiveSplitLeaderboard && typeof window.LiveSplitLeaderboard.reset === "function") {
        window.LiveSplitLeaderboard.reset();
      }
    }

    return {
      init(opts = {}) {
        if (opts.username) {
          setHostUsername(opts.username);
        }
      },
      parseRaceId,
      isValidRaceCode,
      isValidUsername,
      fetchRaceData,
      connectToRace,
      disconnectFromRace,
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
      setHostUsername,
      getHostUsername,
      getHostState: () => Object.assign({}, hostState),
      setHostDNF,
      isHostDNF,
      handleUndoSplit,
      setEntrantDNF,
      setTimingMethod,
      setExternalHostConnected,
      isExternalHostConnected: () => isExternalLiveSplitConnected,
      getTimingMethod,
      startSimulation,
      stopSimulation,
      isSimulating,
      isConnected: () => Boolean(raceId && !isSimulating()),
      getRaceId: () => raceId,
      getRaceStatus: () => raceStatus,
      getCountdownSec,
      getRecentEvents: () => recentRaceEvents.slice(),
      getLatestEvent: () => (recentRaceEvents.length > 0 ? recentRaceEvents[recentRaceEvents.length - 1] : null),
      updateHostProgress,
      handleRaceMessage,
      getRankedEntrants,
      setEntrantMuted,
      toggleEntrantMuted,
      areRacePinsVisible,
      setRacePinsVisible,
      toggleRacePinsVisible,
      getWebSocketLogs,
      clearWebSocketLogs,
      recordWsLog,
      reset,
      subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
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
