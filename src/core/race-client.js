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
    const CONNECT_COOLDOWN_MS = 5000;
    let raceId = null;
    let ws = null;
    const MAX_WS_DEBUG_LOGS = 150;
    const wsDebugLogs = [];
    let wsLogCounter = 0;

    function recordWsLog(direction, type, data, raw) {
      const entry = {
        id: ++wsLogCounter,
        time: new Date().toLocaleTimeString(),
        timestamp: Date.now(),
        direction: direction || "in",
        type: type || "message",
        user: (data && (data.user || data.username || (data.data && (data.data.user || data.data.username)))) || "",
        data: data,
        raw: raw || (typeof data === "string" ? data : JSON.stringify(data))
      };
      wsDebugLogs.unshift(entry);
      if (wsDebugLogs.length > MAX_WS_DEBUG_LOGS) {
        wsDebugLogs.pop();
      }
      try {
        console.log(
          `%c[TheRun WS ${direction.toUpperCase()}] %c${entry.time} %c[${entry.type}]`,
          direction === "in" ? "color: #38bdf8; font-weight: bold;" : "color: #4ade80; font-weight: bold;",
          "color: #94a3b8;",
          "color: #c084fc; font-weight: 600;",
          data
        );
      } catch (_) {}
      notifyListeners("ws_log", entry);
    }
    let heartbeatTimer = null;
    let lastConnectAttemptMs = 0;
    let isConnectInFlight = false;
    let isExternalLiveSplitConnected = false;

    function setExternalHostConnected(connected) {
      isExternalLiveSplitConnected = Boolean(connected);
    }
    let isStandby = false;
    let runStartLookupTimers = [];
    let racePinsVisible = (function () {
      try {
        if (typeof localStorage !== "undefined") {
          return localStorage.getItem("livesplit_race_pins_visible") !== "false";
        }
      } catch (_) {}
      return true;
    })();
    let hostUsername = "";
    let autoDetectUsername = "";
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
      if (!times) return [];
      if (Array.isArray(times)) {
        return times
          .map(t => (typeof t === "number" ? t : parseFloat(t)))
          .filter(t => typeof t === "number" && !isNaN(t));
      }
      if (typeof times === "object") {
        const keys = Object.keys(times)
          .map(k => Number(k))
          .filter(k => !isNaN(k) && k >= 0)
          .sort((a, b) => a - b);
        if (keys.length === 0) return [];
        const maxIdx = keys[keys.length - 1];
        const arr = [];
        for (let i = 0; i <= maxIdx; i++) {
          const val = times[i];
          if (typeof val === "number" && !isNaN(val)) {
            arr[i] = val;
          } else if (typeof val === "string" && !isNaN(parseFloat(val))) {
            arr[i] = parseFloat(val);
          }
        }
        return arr;
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
        autoDetectUsername = hostUsername;
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
      if (runner.isFinished && typeof runner.finalTimeSec === "number") {
        return runner.finalTimeSec;
      }
      const score = Math.max(0, runner.score || 0);
      const sIdx = Math.floor(score);
      const sRatio = Math.max(0, Math.min(1.0, score - sIdx));
      const comp = getActiveComparisonTargets();
      const tPrev = sIdx > 0 ? (comp[sIdx - 1] || (sIdx * 30)) : 0;
      const tNext = (sIdx < comp.length) ? (comp[sIdx] || ((sIdx + 1) * 30)) : (tPrev + 30);
      return tPrev + sRatio * (tNext - tPrev);
    }

    /**
     * Calculates the milestone-based gap between two competitors.
     * Evaluated against checkpoint split times rather than interpolated curve approximations.
     */
    function calculateMilestoneGap(runner, aheadRunner) {
      if (!runner || !aheadRunner) return null;

      // Both runners finished: final delta between their finish times
      if (runner.isFinished && aheadRunner.isFinished) {
        const timeB = typeof runner.finalTimeSec === "number" ? runner.finalTimeSec : (runner.currentTimeSec || 0);
        const timeA = typeof aheadRunner.finalTimeSec === "number" ? aheadRunner.finalTimeSec : (aheadRunner.currentTimeSec || 0);
        return Math.max(0, timeB - timeA);
      }

      const splitsB = normalizeSplitTimes(runner.splitTimes);
      const splitsA = normalizeSplitTimes(aheadRunner.splitTimes);

      const countB = splitsB.length;
      const countA = splitsA.length;
      const curIdxA = Math.max(0, aheadRunner.currentSplitIndex || 0);
      const curIdxB = Math.max(0, runner.currentSplitIndex || 0);

      // 1. If aheadRunner has completed a split that runner has not completed yet
      if (countA > curIdxB && countB <= curIdxB) {
        const timeAAtSplit = splitsA[curIdxB];
        const timeBNow = runner.currentTimeSec || 0;

        if (typeof timeAAtSplit === "number") {
          const prevA = curIdxB > 0 ? splitsA[curIdxB - 1] : 0;
          const prevB = curIdxB > 0 ? (splitsB[curIdxB - 1] || prevA) : 0;
          const prevGap = (typeof prevA === "number" && typeof prevB === "number")
            ? Math.max(0, prevB - prevA)
            : 0;
          if (curIdxB === 0) {
            return Math.max(0, timeBNow - timeAAtSplit);
          } else {
            return prevGap + Math.max(0, timeBNow - timeAAtSplit);
          }
        }
      }

      // 2. Both runners have completed split checkpoints: compare at last common split
      const lastCommonIdx = Math.min(countA, countB) - 1;
      if (lastCommonIdx >= 0) {
        const timeA = splitsA[lastCommonIdx];
        const timeB = splitsB[lastCommonIdx];
        if (typeof timeA === "number" && typeof timeB === "number") {
          const splitDiff = timeB - timeA;
          // If aheadRunner has advanced to a higher split, add the elapsed time aheadRunner has been in the higher split
          if (curIdxA > curIdxB) {
            const timeSinceA = Math.max(0, (aheadRunner.currentTimeSec || 0) - timeA);
            return Math.max(0, splitDiff + timeSinceA);
          }
          return Math.max(0, splitDiff);
        }
      }

      // 3. Fallback: compare LiveSplit PB deltas from therun.gg telemetry if available
      if (typeof runner.deltaSec === "number" && typeof aheadRunner.deltaSec === "number") {
        return Math.max(0, runner.deltaSec - aheadRunner.deltaSec);
      }

      // 4. On first split before anyone splits:
      if (countA === 0 && countB === 0) {
        if (curIdxA === 0 && curIdxB === 0 && !aheadRunner.isFinished && !runner.isFinished) {
          if (typeof runner.deltaSec === "number" && typeof aheadRunner.deltaSec === "number") {
            return Math.max(0, runner.deltaSec - aheadRunner.deltaSec);
          }
          return null;
        }
        return Math.max(0, getCourseRefTime(aheadRunner) - getCourseRefTime(runner));
      }

      // 5. Fallback: compare current running times if both running
      if (typeof runner.currentTimeSec === "number" && typeof aheadRunner.currentTimeSec === "number" && aheadRunner.currentTimeSec > 0) {
        return Math.max(0, runner.currentTimeSec - aheadRunner.currentTimeSec);
      }

      return null;
    }

    /**
     * Returns the number of splits a runner has completed.
     */
    function getCompletedSplitCount(runner) {
      if (!runner) return 0;
      const normSplits = normalizeSplitTimes(runner.splitTimes);
      const sIdx = Math.max(0, runner.currentSplitIndex || 0);
      if (runner.isDNF) {
        return Math.max(normSplits.length, sIdx);
      }
      if (runner.isFinished) {
        if (normSplits.length > 0) return Math.max(normSplits.length, sIdx);
        if (activeSplitsList && activeSplitsList.length > 0) return Math.max(activeSplitsList.length, sIdx);
        return Math.max(1, sIdx);
      }
      return sIdx;
    }

    /**
     * Returns the cumulative split time (in seconds) recorded by a runner at checkpoint index c.
     */
    function getSplitCheckpointTime(runner, c) {
      if (!runner || c < 0) return null;
      const normSplits = normalizeSplitTimes(runner.splitTimes);
      if (typeof normSplits[c] === "number" && !isNaN(normSplits[c]) && normSplits[c] > 0) {
        return normSplits[c];
      }
      if (Array.isArray(runner.splits) && runner.splits[c] && typeof runner.splits[c].splitTime === "number" && runner.splits[c].splitTime > 0) {
        const st = runner.splits[c].splitTime;
        return st > 500 ? (st / 1000) : st;
      }
      if (runner.isFinished && typeof runner.finalTimeSec === "number" && runner.finalTimeSec > 0) {
        const totalCompleted = getCompletedSplitCount(runner);
        if (c === totalCompleted - 1) {
          return runner.finalTimeSec;
        }
      }
      return null;
    }

    /**
     * Returns all entrants (host + competitors), sorted into F1 standings order.
     */
    function getRankedEntrants() {
      let list = Array.from(entrants.values());

      const seRank = getSimEngine();
      if (seRank && seRank.isSimulating()) {
        // In simulation mode, ensure host runner is present
        if (!list.some(r => r.userId === hostState.userId)) {
          list.push(hostState);
        }
      } else if (ws !== null || (raceId && raceId !== "sim_cup_2026")) {
        // In live race: only display actual therun.gg race participants (never the synthetic local_host placeholder)
        list = list.filter(r => r.userId !== hostState.userId);

        // Advance live active runners smoothly with real wall clock time between websocket split packets
        const nowMs = Date.now();
        list.forEach((racer) => {
          const isActivelyRacing = !racer.isFinished && !racer.isDNF &&
            (racer.status === "started" || racer.status === "progress" || racer.status === "in_progress" ||
             ((racer.currentTimeSec > 0 || racer.currentSplitIndex > 0) && racer.status !== "ready" && racer.status !== "joined"));
          if (isActivelyRacing) {
            if (racer.splitStartedAt && racer.splitStartedAt > 0) {
              const startMs = racer.splitStartedAt > 1e11 ? racer.splitStartedAt : (racer.splitStartedAt * 1000);
              const inSplitSec = Math.max(0, (nowMs - startMs) / 1000);
              const baseT = (racer.currentSplitIndex > 0 && Array.isArray(racer.splitTimes) && typeof racer.splitTimes[racer.currentSplitIndex - 1] === "number")
                ? racer.splitTimes[racer.currentSplitIndex - 1]
                : (racer.reportedTimeSec || 0);
              racer.currentTimeSec = Math.max(racer.reportedTimeSec || 0, baseT + inSplitSec);
            } else if (racer.lastUpdateTimestamp && racer.lastUpdateTimestamp > 0) {
              const elapsedSec = Math.max(0, (nowMs - racer.lastUpdateTimestamp) / 1000);
              if (elapsedSec > 0 && elapsedSec < 7200) {
                racer.currentTimeSec = (racer.reportedTimeSec || 0) + elapsedSec;
              }
            }
          }
        });
      } else {
        // Idle/preview state: ensure host is in the list
        if (!list.some(r => r.userId === hostState.userId)) {
          list.push(hostState);
        }
      }

      // Leaderboard sorting rules:
      // 1. Finished runners ranked first by finalTimeSec ascending (fastest finish wins)
      // 2. Active runners ranked by currentSplitIndex descending (highest milestone reached)
      // 3. Active runners on the SAME split checkpoint: leaderboard positioning updates on the
      //    occasion of splitting, NOT based on predicted mid-split interpolation curves.
      //    Ties are broken by comparing cumulative split times at the last completed split checkpoint!
      // 4. Stable rank fallback to prevent mid-split swapping or jitter.
      list.sort((a, b) => {
        if (a.isFinished && b.isFinished) {
          return (a.finalTimeSec || Infinity) - (b.finalTimeSec || Infinity);
        }
        if (a.isFinished && !b.isFinished) return -1;
        if (!a.isFinished && b.isFinished) return 1;

        // DNF runners ranked at the bottom of the standings
        if (a.isDNF && !b.isDNF) return 1;
        if (!a.isDNF && b.isDNF) return -1;
        if (a.isDNF && b.isDNF) {
          const sA = a.currentSplitIndex || 0;
          const sB = b.currentSplitIndex || 0;
          if (sB !== sA) return sB - sA;
          return (b.dnfTimeSec || 0) - (a.dnfTimeSec || 0);
        }

        // Checkpoint rule: in speedrun races, any runner on a higher split checkpoint is physically ahead!
        const splitIdxA = a.currentSplitIndex || 0;
        const splitIdxB = b.currentSplitIndex || 0;
        if (splitIdxB !== splitIdxA) {
          return splitIdxB - splitIdxA;
        }

        // Both runners are on the same split checkpoint.
        // Standings update strictly upon splitting: compare cumulative time at the most recently completed common split.
        const splitsA = normalizeSplitTimes(a.splitTimes);
        const splitsB = normalizeSplitTimes(b.splitTimes);
        const lastCompletedIdx = splitIdxA - 1;

        if (lastCompletedIdx >= 0) {
          for (let k = lastCompletedIdx; k >= 0; k--) {
            const tA = splitsA[k];
            const tB = splitsB[k];
            if (typeof tA === "number" && typeof tB === "number" && !isNaN(tA) && !isNaN(tB)) {
              const diff = tA - tB;
              if (Math.abs(diff) > 0.001) {
                return diff; // lower cumulative split time crossed earlier -> ranked ahead
              }
            }
          }
        }

        // Fallback for Split 0 (before anyone has split) or identical cumulative split times:
        // Preserve stable rank to avoid mid-split swapping or delta glitches
        const rankA = lastKnownRanks.get(a.userId);
        const rankB = lastKnownRanks.get(b.userId);
        if (rankA !== undefined && rankB !== undefined && rankA !== rankB) {
          return rankA - rankB;
        }

        // Initial stable order fallback (e.g. before any ranks are recorded):
        // Simulated competitors: paceFactor provides seeded ordering (host = 1.000)
        const paceA = typeof a.paceFactor === "number" ? a.paceFactor : (a.isHost ? 1.000 : 1.0);
        const paceB = typeof b.paceFactor === "number" ? b.paceFactor : (b.isHost ? 1.000 : 1.0);
        if (Math.abs(paceA - paceB) > 0.0001) {
          return paceA - paceB;
        }

        return String(a.userId || "").localeCompare(String(b.userId || ""));
      });

      list.forEach((r, idx) => lastKnownRanks.set(r.userId, idx + 1));

      // Calculate leader gap and interval to competitor ahead based on checkpoint milestones
      const leader = list[0];

      list.forEach((runner, idx) => {
        if (runner.isDNF) {
          runner.rank = "DNF";
          runner.gapToLeaderSec = null;
          runner.intervalSec = null;
          runner.gapDisplay = "DNF";
          runner.intervalDisplay = "--";
          runner.expectedType = "DNF";
          runner.expectedSegmentSec = null;
          runner.expectedSegmentDisplay = "--";
          runner.elapsedSegmentSec = null;
          runner.elapsedSegmentDisplay = "--";
          return;
        }

        runner.rank = idx + 1;

        // Calculate expected segment duration and elapsed segment time for current split
        const sIdx = Math.max(0, runner.currentSplitIndex || 0);
        let elapsedSegSec = 0;
        if (runner.isFinished) {
          runner.expectedType = "FIN";
          const finSec = typeof runner.finalTimeSec === "number" ? runner.finalTimeSec : (runner.currentTimeSec || 0);
          runner.expectedSegmentSec = finSec;
          runner.expectedSegmentDisplay = formatGapTime(finSec).replace(/^\+/, "");
          elapsedSegSec = finSec;
        } else {
          runner.expectedType = "EXP";
          let segSec = 30.0;
          let prevSplitTime = 0;
          const normSplits = normalizeSplitTimes(runner.splitTimes);

          const isRT = (currentTimingMethod === "RealTime");
          const activePb = isRT
            ? (runner.pbCheckpointTimesRT || runner.pbCheckpointTimes)
            : (runner.pbCheckpointTimesGT || runner.pbCheckpointTimes);

          // Check if runner has therun.gg statistical model prediction for this split segment
          const splitObj = (Array.isArray(runner.splits) && runner.splits[sIdx]) ? runner.splits[sIdx] : null;
          let predictedSegSec = (typeof runner.timeToNextSplit === "number" && runner.timeToNextSplit > 0.05) ? runner.timeToNextSplit : null;
          if (splitObj) {
            // Priority 1: therun.gg statistical model / machine learning single split prediction
            if (typeof splitObj.predictedSingleTime === "number" && splitObj.predictedSingleTime > 0) {
              predictedSegSec = splitObj.predictedSingleTime > 500 ? (splitObj.predictedSingleTime / 1000) : splitObj.predictedSingleTime;
            }
            // Priority 2: therun.gg historical rolling window average segment duration
            else if (splitObj.single && splitObj.single.averageTime && parseFloat(splitObj.single.averageTime) > 0) {
              const avgMs = parseFloat(splitObj.single.averageTime);
              predictedSegSec = avgMs > 500 ? (avgMs / 1000) : avgMs;
            }
            // Priority 3: Balanced PB comparison segment difference
            else if (splitObj.comparisons && typeof splitObj.comparisons["Balanced PB"] === "number") {
              const bPb = splitObj.comparisons["Balanced PB"];
              const prevBPb = (sIdx > 0 && runner.splits[sIdx - 1]?.comparisons?.["Balanced PB"]) || 0;
              const diffMs = bPb - prevBPb;
              if (diffMs > 0) {
                predictedSegSec = diffMs > 500 ? (diffMs / 1000) : diffMs;
              }
            }
          }

          if (predictedSegSec !== null && predictedSegSec > 0.05) {
            segSec = predictedSegSec;
            runner.hasStatisticalPrediction = true;
          } else if (activePb && activePb.length > sIdx) {
            const prevPb = sIdx > 0 ? (activePb[sIdx - 1] || 0) : 0;
            segSec = Math.max(0.1, (activePb[sIdx] || 0) - prevPb);
            runner.hasStatisticalPrediction = false;
          } else {
            const comp = getActiveComparisonTargets();
            const prevT = sIdx > 0 ? (comp[sIdx - 1] || (sIdx * 30)) : 0;
            const nextT = (sIdx < comp.length) ? (comp[sIdx] || ((sIdx + 1) * 30)) : (prevT + 30);
            const pace = typeof runner.paceFactor === "number" ? runner.paceFactor : 1.0;
            segSec = Math.max(0.1, (nextT - prevT) * pace);
            runner.hasStatisticalPrediction = false;
          }

          if (sIdx > 0 && normSplits.length >= sIdx && typeof normSplits[sIdx - 1] === "number") {
            prevSplitTime = normSplits[sIdx - 1];
          } else if (sIdx > 0 && runner.checkpointTimes && typeof runner.checkpointTimes[sIdx - 1] === "number") {
            prevSplitTime = runner.checkpointTimes[sIdx - 1];
          } else if (sIdx > 0 && Array.isArray(runner.splits) && runner.splits[sIdx - 1] && typeof runner.splits[sIdx - 1].splitTime === "number") {
            const st = runner.splits[sIdx - 1].splitTime;
            prevSplitTime = st > 500 ? (st / 1000) : st;
          } else if (sIdx > 0 && simulationCourseTargets && typeof simulationCourseTargets[sIdx - 1] === "number") {
            prevSplitTime = simulationCourseTargets[sIdx - 1];
          }

          elapsedSegSec = Math.max(0, (runner.currentTimeSec || 0) - prevSplitTime);
          runner.expectedSegmentSec = segSec;
          runner.expectedSegmentDisplay = formatGapTime(segSec).replace(/^\+/, "");
        }
        runner.elapsedSegmentSec = elapsedSegSec;
        runner.elapsedSegmentDisplay = formatGapTime(elapsedSegSec).replace(/^\+/, "");

        if (idx === 0) {
          runner.gapToLeaderSec = 0;
          runner.intervalSec = 0;
          runner.gapDisplay = "LEADER";
          runner.intervalDisplay = "--";
        } else {
          const aheadRunner = list[idx - 1];
          const gap = calculateMilestoneGap(runner, leader);
          const interval = calculateMilestoneGap(runner, aheadRunner);

          runner.gapToLeaderSec = gap;
          runner.intervalSec = interval;

          if (gap !== null) {
            runner.gapDisplay = `+${formatGapTime(gap)}`;
          } else {
            runner.gapDisplay = "--";
          }

          if (interval !== null) {
            runner.intervalDisplay = `+${formatGapTime(interval)}`;
          } else {
            runner.intervalDisplay = "--";
          }
        }
      });

      // -------------------------------------------------------------
      // Fastest Segment Ribbons (Gold / Silver / Bronze on Leader's previous completed split)
      // -------------------------------------------------------------
      const ribbonAwards = new Map(); // userId -> { tier: "gold"|"silver"|"bronze", segDuration }
      let targetSegmentName = "";

      if (leader && !leader.isDNF) {
        const leaderSplitsLen = normalizeSplitTimes(leader.splitTimes).length;
        const totalCourseSplits = activeSplitsList.length > 0 ? activeSplitsList.length : (leaderSplitsLen > 0 ? leaderSplitsLen : 8);
        const leaderSplitIdx = leader.isFinished
          ? (totalCourseSplits - 1)
          : (leader.currentSplitIndex || 0);
        // The split in contention: whichever split the leader is on, it is the previous split
        const targetSplitIdx = leader.isFinished ? leaderSplitIdx : (leaderSplitIdx - 1);

        if (targetSplitIdx >= 0) {
          targetSegmentName = (activeSplitsList && activeSplitsList[targetSplitIdx])
            ? activeSplitsList[targetSplitIdx]
            : `Split ${targetSplitIdx + 1}`;

          const segmentContenders = [];

          list.forEach((racer) => {
            if (racer.isDNF) return;
            const hasCompletedTarget = (racer.isFinished || ((racer.currentSplitIndex || 0) > targetSplitIdx));
            if (!hasCompletedTarget) return;

            const splits = normalizeSplitTimes(racer.splitTimes);
            const tSplit = splits[targetSplitIdx];
            if (typeof tSplit !== "number" || isNaN(tSplit) || tSplit <= 0) return;

            let tPrev = 0;
            if (targetSplitIdx > 0) {
              if (typeof splits[targetSplitIdx - 1] === "number" && splits[targetSplitIdx - 1] > 0) {
                tPrev = splits[targetSplitIdx - 1];
              } else if (racer.checkpointTimes && typeof racer.checkpointTimes[targetSplitIdx - 1] === "number") {
                tPrev = racer.checkpointTimes[targetSplitIdx - 1];
              } else {
                const comp = getActiveComparisonTargets();
                if (comp && typeof comp[targetSplitIdx - 1] === "number") {
                  tPrev = comp[targetSplitIdx - 1];
                }
              }
            }

            const segDuration = tSplit - tPrev;
            if (segDuration > 0) {
              segmentContenders.push({
                userId: racer.userId,
                segDuration,
                rank: typeof racer.rank === "number" ? racer.rank : 9999
              });
            }
          });

          segmentContenders.sort((a, b) => {
            const diff = a.segDuration - b.segDuration;
            if (Math.abs(diff) > 0.001) return diff;
            return a.rank - b.rank;
          });

          const tiers = ["gold", "silver", "bronze"];
          for (let i = 0; i < Math.min(3, segmentContenders.length); i++) {
            ribbonAwards.set(segmentContenders[i].userId, {
              tier: tiers[i],
              segDuration: segmentContenders[i].segDuration
            });
          }
        }
      }

      list.forEach((runner) => {
        const award = ribbonAwards.get(runner.userId) || null;
        runner.segmentRibbon = award ? award.tier : null;
        runner.ribbonSegmentName = award ? targetSegmentName : null;
        runner.ribbonSegmentTime = award ? award.segDuration : null;

        runner.hasCrown = (runner.segmentRibbon === "gold");
        runner.crownSegmentName = runner.hasCrown ? targetSegmentName : null;
        runner.crownSegmentTime = runner.hasCrown ? award.segDuration : null;
      });

      // -------------------------------------------------------------
      // Split-over-Split Position Delta with Live Overtake Awareness
      // -------------------------------------------------------------
      let maxCompletedSplits = 0;
      list.forEach((r) => {
        const count = getCompletedSplitCount(r);
        if (count > maxCompletedSplits) {
          maxCompletedSplits = count;
        }
      });

      // Prune stale checkpoint history above maxCompletedSplits
      Array.from(checkpointRankHistory.keys()).forEach((c) => {
        if (c >= maxCompletedSplits) {
          checkpointRankHistory.delete(c);
        }
      });

      for (let c = 0; c < maxCompletedSplits; c++) {
        if (!checkpointRankHistory.has(c)) {
          checkpointRankHistory.set(c, new Map());
        }
        const histMap = checkpointRankHistory.get(c);

        // Remove entrants who have not completed checkpoint c (e.g. after undo split)
        Array.from(histMap.keys()).forEach((uId) => {
          const r = list.find(item => item.userId === uId);
          if (!r || getCompletedSplitCount(r) <= c) {
            histMap.delete(uId);
          }
        });

        const completedAtC = list.filter(r => getCompletedSplitCount(r) > c);
        completedAtC.sort((a, b) => {
          const tA = getSplitCheckpointTime(a, c);
          const tB = getSplitCheckpointTime(b, c);
          if (tA !== null && tB !== null) {
            const diff = tA - tB;
            if (Math.abs(diff) > 0.001) return diff;
          }
          const prevOrderA = histMap.get(a.userId);
          const prevOrderB = histMap.get(b.userId);
          if (prevOrderA !== undefined && prevOrderB === undefined) return -1;
          if (prevOrderA === undefined && prevOrderB !== undefined) return 1;
          if (prevOrderA !== undefined && prevOrderB !== undefined && prevOrderA !== prevOrderB) {
            return prevOrderA - prevOrderB;
          }
          const rankA = typeof a.rank === "number" ? a.rank : 9999;
          const rankB = typeof b.rank === "number" ? b.rank : 9999;
          return rankA - rankB;
        });

        completedAtC.forEach((r, idx) => {
          histMap.set(r.userId, idx + 1);
        });
      }

      list.forEach((runner) => {
        if (runner.isDNF || typeof runner.rank !== "number") {
          runner.positionDelta = 0;
          runner.positionDeltaDisplay = "-";
          return;
        }

        const completedCount = getCompletedSplitCount(runner);
        let posDelta = 0;

        if (completedCount === 0) {
          // Split 1 in progress: baseline checkpoint not yet established
          posDelta = 0;
        } else if (completedCount === 1) {
          // Completed Split 1 (checkpoint 0), currently running Split 2:
          // Baseline is Split 1 rank; shows 0 unless overtaken mid-Split 2 (or promoted by DNF)
          const rankAt0 = checkpointRankHistory.get(0)?.get(runner.userId) ?? runner.rank;
          if (runner.rank !== rankAt0) {
            posDelta = rankAt0 - runner.rank;
          } else {
            posDelta = 0;
          }
        } else {
          // Completed Split 2+ (completedCount >= 2):
          const prevSplitRank = checkpointRankHistory.get(completedCount - 2)?.get(runner.userId) ?? runner.rank;
          const lastSplitRank = checkpointRankHistory.get(completedCount - 1)?.get(runner.userId) ?? runner.rank;

          if (!runner.isFinished && runner.rank !== lastSplitRank) {
            // Live Overtake Awareness (Option B):
            // Another racer has already completed the current split ahead of this runner
            // (or a runner ahead DNF'd), shifting this runner's live leaderboard position!
            posDelta = lastSplitRank - runner.rank;
          } else {
            // Split-over-Split delta comparing the last completed split against the previous split
            posDelta = prevSplitRank - lastSplitRank;
          }
        }

        runner.positionDelta = posDelta;
        if (posDelta > 0) {
          runner.positionDeltaDisplay = `+${posDelta}`;
        } else if (posDelta < 0) {
          runner.positionDeltaDisplay = `${posDelta}`;
        } else {
          runner.positionDeltaDisplay = "-";
        }
      });

      return list;
    }

    function formatGapTime(sec) {
      if (sec === null || sec === undefined || isNaN(sec)) return "--";
      const clamped = Math.max(0, sec);
      const totalSec = Math.floor(clamped);
      if (totalSec < 60) {
        const subMin = Math.min(59.9, Math.round(clamped * 10) / 10);
        return `${subMin.toFixed(1)}s`;
      }
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      const sPad = s < 10 ? `0${s}` : `${s}`;
      if (h > 0) {
        const mPad = m < 10 ? `0${m}` : `${m}`;
        return `${h}:${mPad}:${sPad}`;
      }
      return `${m}:${sPad}`;
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
    // SINGLE-SHOT THERUN.GG RACE LOOKUP WITH 5S COOLDOWN GUARD
    // ============================================================

    function getConnectCooldownRemainingMs() {
      if (lastConnectAttemptMs <= 0) return 0;
      return Math.max(0, CONNECT_COOLDOWN_MS - (Date.now() - lastConnectAttemptMs));
    }

    function clearRunStartLookupTimers() {
      if (runStartLookupTimers.length > 0) {
        runStartLookupTimers.forEach((t) => clearTimeout(t));
        runStartLookupTimers = [];
      }
    }

    function setStandby(val) {
      const next = !!val;
      const se = getSimEngine();
      if (!next && se) {
        se.clearStandby();
      }
      if (isStandby !== next) {
        isStandby = next;
        notifyListeners("race_standby_changed", { isStandby, isSimStandby: isSimStandby(), username: autoDetectUsername || hostUsername });
      }
      return isStandby;
    }

    function armSimulationStandby(splitsList = [], comparisonTimes = [], comparisonTimesRT = []) {
      clearRunStartLookupTimers();
      if (ws) {
        disconnectFromRace();
      }
      const se = getSimEngine();
      if (se) {
        return se.armSimulationStandby(splitsList, comparisonTimes, comparisonTimesRT);
      }
      return { status: "sim_standby", isStandby: true, isSimStandby: true };
    }

    function resetConnectCooldown() {
      lastConnectAttemptMs = 0;
      isConnectInFlight = false;
      clearRunStartLookupTimers();
    }

    function startAutoDetect(username) {
      if (!username || typeof username !== "string") return Promise.resolve({ status: "idle" });
      autoDetectUsername = username.trim();
      stopAutoDetect();

      // Single-shot lookup (no recurring background polling loop)
      return pollUserStatus(autoDetectUsername);
    }

    function stopAutoDetect() {
      clearRunStartLookupTimers();
      setStandby(false);
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }

    async function pollUserStatus(usernameOverride, ignoreCooldown = false) {
      const targetUser = (typeof usernameOverride === "string" ? usernameOverride : (autoDetectUsername || hostUsername || "")).trim();
      const sePoll = getSimEngine();
      if (!targetUser || (sePoll && sePoll.isSimulating())) {
        return { status: "idle", remainingMs: 0 };
      }
      if (!isValidUsername(targetUser)) {
        return { status: "invalid_username", remainingMs: 0 };
      }
      autoDetectUsername = targetUser;

      if (isConnectInFlight) {
        return { status: "in_flight", remainingMs: getConnectCooldownRemainingMs() };
      }

      const cooldownRem = getConnectCooldownRemainingMs();
      if (!ignoreCooldown && cooldownRem > 0) {
        return { status: "cooldown", remainingMs: cooldownRem };
      }

      isConnectInFlight = true;
      if (!ignoreCooldown) {
        lastConnectAttemptMs = Date.now();
      }

      try {
        const res = await fetch(`${THERUN_LIVE_API}/${encodeURIComponent(targetUser)}`);
        if (!res.ok) {
          return { status: "error", remainingMs: CONNECT_COOLDOWN_MS };
        }

        const data = await res.json();
        if (data && data.raceId) {
          clearRunStartLookupTimers();
          setStandby(false);
          if (raceId !== data.raceId || !ws || ws.readyState !== WebSocket.OPEN) {
            console.log(`[RaceClient] Detected raceId from therun.gg: ${data.raceId} (reconnecting=${!ws || ws.readyState !== WebSocket.OPEN})`);
            connectToRace(data.raceId);
          }
          return { status: "connected", raceId: data.raceId, remainingMs: 0 };
        } else if (raceId && !data?.raceId) {
          // Runner left race or race concluded
          console.log("[RaceClient] Race status cleared on therun.gg. Disconnecting.");
          disconnectFromRace();
          return { status: "no_race", remainingMs: CONNECT_COOLDOWN_MS };
        }
        // Lobby Standby: user is not in an active race yet; arm standby for automatic lookup when LiveSplit timer starts
        setStandby(true);
        return { status: "no_race", isStandby: true, remainingMs: CONNECT_COOLDOWN_MS };
      } catch (err) {
        // Silent network failure guard (offline / rate limit)
        return { status: "error", remainingMs: CONNECT_COOLDOWN_MS };
      } finally {
        isConnectInFlight = false;
      }
    }

    /**
     * Triggered when the local LiveSplit timer transitions from NotRunning (-1) to Running (0).
     * Performs an event-driven single-shot lookup (plus one delayed retry if needed) so runners in a lobby
     * never need to take their hands off the controller to click Connect after the countdown ends.
     */
    function handleHostRunStarted(opts = {}) {
      const seStart = getSimEngine();
      if (seStart && seStart.isSimulating()) {
        seStart.handleHostRunStarted(opts);
        return Promise.resolve({ status: "simulating" });
      }
      if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve({ status: "already_connected", raceId });

      if (seStart && seStart.isSimStandby()) {
        clearRunStartLookupTimers();
        const simDelayMs = typeof opts.initialDelayMs === "number" ? Math.max(0, opts.initialDelayMs) : 0;
        const launchSim = () => {
          if (!seStart.isSimStandby()) return { status: "cancelled" };
          const cfg = seStart.getPendingSimConfig() || {};
          startSimulation(cfg.splitsList || [], cfg.comparisonTimes || [], cfg.comparisonTimesRT || []);
          return { status: "connected", raceId, isSimulated: true };
        };
        if (simDelayMs === 0) {
          return Promise.resolve(launchSim());
        }
        return new Promise((resolve) => {
          const tSim = setTimeout(() => {
            resolve(launchSim());
          }, simDelayMs);
          runStartLookupTimers.push(tSim);
        });
      }

      const targetUser = (autoDetectUsername || hostUsername || "").trim();
      if (!isValidUsername(targetUser)) {
        return Promise.resolve({ status: "idle" });
      }

      clearRunStartLookupTimers();
      const initialDelayMs = typeof opts.initialDelayMs === "number" ? Math.max(0, opts.initialDelayMs) : 2000;
      const retryDelayMs = typeof opts.retryDelayMs === "number" ? Math.max(0, opts.retryDelayMs) : 3500;

      const executeLookupWithSingleRetry = async () => {
        const seEx = getSimEngine();
        if ((seEx && seEx.isSimulating()) || (ws && ws.readyState === WebSocket.OPEN)) {
          return { status: "connected", raceId };
        }
        const firstRes = await pollUserStatus(targetUser, true);
        if (firstRes && firstRes.status === "connected") {
          return firstRes;
        }
        if (retryDelayMs <= 0) {
          return firstRes;
        }
        return new Promise((resolve) => {
          const t2 = setTimeout(async () => {
            const seRetry = getSimEngine();
            if ((seRetry && seRetry.isSimulating()) || (ws && ws.readyState === WebSocket.OPEN)) {
              resolve({ status: "connected", raceId });
              return;
            }
            const secondRes = await pollUserStatus(targetUser, true);
            resolve(secondRes);
          }, retryDelayMs);
          runStartLookupTimers.push(t2);
        });
      };

      if (initialDelayMs === 0) {
        return executeLookupWithSingleRetry();
      }

      return new Promise((resolve) => {
        const t1 = setTimeout(async () => {
          const res = await executeLookupWithSingleRetry();
          resolve(res);
        }, initialDelayMs);
        runStartLookupTimers.push(t1);
      });
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
      lastConnectAttemptMs = Date.now();

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

    function handleRaceMessage(msg) {
      if (!msg) return;

      // Ignore chat messages on the race websocket
      // Ignore pure chat messages on the race websocket
      if (msg.type === "chat" || (msg.type === "message" && typeof msg.message === "string" && !msg.data && !msg.user && !msg.username && !msg.userId && !msg.participants && !msg.countdown && !msg.startTime)) {
        return;
      }

      const payload = (msg.result !== undefined && msg.result !== null)
        ? msg.result
        : ((msg.data !== undefined && msg.data !== null) ? msg.data : msg);

      if (!payload) return;

      // Extract inner data and raw message type across single or doubly-nested envelopes
      let rawMsgType = String(msg.type || msg.action || msg.event || "").toLowerCase().trim();
      let innerData = payload;
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        if (payload.type && typeof payload.type === "string") {
          rawMsgType = String(payload.type).toLowerCase().trim();
        }
        if (payload.data !== undefined && payload.data !== null && typeof payload.data === "object" && !Array.isArray(payload.data)) {
          innerData = payload.data;
          if (innerData.type && typeof innerData.type === "string") {
            rawMsgType = String(innerData.type).toLowerCase().trim();
          }
          if (innerData.data !== undefined && innerData.data !== null && typeof innerData.data === "object" && !Array.isArray(innerData.data)) {
            innerData = innerData.data;
          }
        }
      }

      // 1. Process Race-Level Status, Countdown, and Start Times
      const rawStatus = (innerData && (innerData.raceStatus || innerData.status || innerData.state)) ||
        (payload && (payload.raceStatus || payload.status || payload.state)) ||
        (payload && payload.race && (payload.race.raceStatus || payload.race.status || payload.race.state)) ||
        msg.status || msg.raceStatus || msg.state;

      let detectedCountdown = null;
      if (typeof innerData.countdown === "number" && !isNaN(innerData.countdown)) {
        detectedCountdown = innerData.countdown;
      } else if (typeof innerData.countdownSeconds === "number" && !isNaN(innerData.countdownSeconds)) {
        if (rawStatus === "starting" || rawStatus === "countdown") {
          detectedCountdown = innerData.countdownSeconds;
        }
      } else if (typeof payload.countdown === "number" && !isNaN(payload.countdown)) {
        detectedCountdown = payload.countdown;
      } else if (typeof payload.countdownSeconds === "number" && !isNaN(payload.countdownSeconds)) {
        if (rawStatus === "starting" || rawStatus === "countdown") {
          detectedCountdown = payload.countdownSeconds;
        }
      } else if (typeof msg.countdown === "number" && !isNaN(msg.countdown)) {
        detectedCountdown = msg.countdown;
      } else if ((rawMsgType === "countdown" || rawMsgType === "starting") && typeof msg.value === "number") {
        detectedCountdown = msg.value;
      } else if ((rawMsgType === "countdown" || rawMsgType === "starting") && typeof msg.seconds === "number") {
        detectedCountdown = msg.seconds;
      }

      const rawStartTime = (innerData && (innerData.startTime || innerData.startDate || innerData.start_time)) ||
        (payload && (payload.startTime || payload.startDate || payload.start_time)) ||
        (payload && payload.race && (payload.race.startTime || payload.race.startDate || payload.race.start_time)) ||
        msg.startTime || msg.startDate || msg.start_time;

      if (detectedCountdown !== null) {
        if (detectedCountdown > 0) {
          countdownTargetMs = Date.now() + (detectedCountdown * 1000);
          countdownSeconds = Math.ceil(detectedCountdown);
          raceStatus = "starting";
          pushRaceEvent({
            type: "countdown",
            text: `Race starting in ${countdownSeconds}s`,
            timestamp: Date.now()
          });
        } else {
          countdownTargetMs = null;
          countdownSeconds = 0;
          raceStatus = "in_progress";
          pushRaceEvent({
            type: "started",
            text: "Race started! Good luck!",
            timestamp: Date.now()
          });
        }
      } else if (rawStartTime) {
        let sMs = 0;
        if (typeof rawStartTime === "number") {
          sMs = rawStartTime > 1e11 ? rawStartTime : (rawStartTime * 1000);
        } else if (typeof rawStartTime === "string") {
          const parsed = Date.parse(rawStartTime);
          if (!isNaN(parsed)) sMs = parsed;
        }
        if (sMs > Date.now()) {
          countdownTargetMs = sMs;
          raceStatus = "starting";
          const remSec = Math.ceil((sMs - Date.now()) / 1000);
          pushRaceEvent({
            type: "countdown",
            text: `Race starting in ${remSec}s`,
            timestamp: Date.now()
          });
        } else if (sMs > 0 && Date.now() >= sMs && raceStatus === "starting") {
          countdownTargetMs = null;
          countdownSeconds = 0;
          raceStatus = "in_progress";
          pushRaceEvent({
            type: "started",
            text: "Race started! Good luck!",
            timestamp: Date.now()
          });
        }
      }

      if (rawStatus && typeof rawStatus === "string") {
        const s = rawStatus.toLowerCase().trim();
        if (s === "starting" || s === "countdown") {
          raceStatus = "starting";
        } else if (s === "started" || s === "in_progress" || s === "progress") {
          raceStatus = "in_progress";
          countdownTargetMs = null;
          countdownSeconds = null;
        } else if (s === "finished" || s === "confirmed") {
          raceStatus = "finished";
          countdownTargetMs = null;
          countdownSeconds = null;
        } else if (s === "pending" || s === "open" || s === "lobby" || s === "ready" || s === "waiting") {
          if (raceStatus !== "starting") {
            raceStatus = "open";
          }
        }
      }

      const raceMsgType = rawMsgType;
      const raceMsgData = (innerData && typeof innerData === "object")
        ? innerData
        : ((payload && typeof payload === "object") ? payload : null);

      if (raceMsgType === "race-starting" || raceMsgType === "race_starting") {
        raceStatus = "starting";
      } else if (raceMsgType === "race-start-canceled" || raceMsgType === "race_start_canceled") {
        raceStatus = "open";
        countdownTargetMs = null;
        countdownSeconds = null;
        pushRaceEvent({
          type: "canceled",
          text: "Race countdown canceled",
          timestamp: Date.now()
        });
      } else if (raceMsgType === "race-started" || raceMsgType === "race_started") {
        raceStatus = "in_progress";
        countdownTargetMs = null;
        countdownSeconds = 0;
        pushRaceEvent({
          type: "started",
          text: "Race started! Good luck!",
          timestamp: Date.now()
        });
      } else if (raceMsgType === "race-finish" || raceMsgType === "race-abort") {
        raceStatus = "finished";
        countdownTargetMs = null;
        countdownSeconds = null;
      } else if (raceMsgType === "participant-ready") {
        const u = raceMsgData?.user || payload.user;
        if (u) updateEntrantFromTelemetry({ user: u, status: "ready" });
      } else if (raceMsgType === "participant-unready") {
        const u = raceMsgData?.user || payload.user;
        if (u) updateEntrantFromTelemetry({ user: u, status: "joined" });
      } else if (raceMsgType === "participant-join") {
        const u = raceMsgData?.user || payload.user;
        if (u) updateEntrantFromTelemetry({ user: u, status: "joined" });
      } else if (raceMsgType === "participant-unjoin") {
        const u = raceMsgData?.user || payload.user;
        if (u) updateEntrantFromTelemetry({ user: u, status: "unjoined" });
      } else if (raceMsgType === "participant-abandon") {
        const u = raceMsgData?.user || payload.user;
        if (u) updateEntrantFromTelemetry({ user: u, status: "abandoned" });
      } else if (raceMsgType === "participant-split" && raceMsgData) {
        updateEntrantFromTelemetry({
          user: raceMsgData.user,
          currentSplitName: raceMsgData.splitName,
          currentTime: raceMsgData.time,
          runPercentage: raceMsgData.percentage
        });
      }

      if (rawMsgType === "race_started" || rawMsgType === "start" || rawMsgType === "go") {
        raceStatus = "in_progress";
        countdownTargetMs = null;
        countdownSeconds = 0;
        pushRaceEvent({
          type: "started",
          text: "Race started! Good luck!",
          timestamp: Date.now()
        });
      }

      // Handle full authoritative entrants/participants snapshot or incremental runner update
      const participantsList = (innerData && Array.isArray(innerData.participants)) ? innerData.participants
        : ((payload && Array.isArray(payload.participants)) ? payload.participants
        : ((innerData && Array.isArray(innerData.entrants)) ? innerData.entrants
        : ((payload && Array.isArray(payload.entrants)) ? payload.entrants
        : (Array.isArray(innerData) ? innerData : (Array.isArray(payload) ? payload : null)))));

      if (Array.isArray(participantsList)) {
        // In live room: authoritative snapshot from therun.gg prunes anyone who left the race
        const activeUsers = new Set(participantsList.map(p => String(p.user || p.username || p.userId || "").toLowerCase().trim()).filter(Boolean));
        if (ws !== null || (raceId && raceId !== "sim_cup_2026")) {
          for (const [id, e] of entrants.entries()) {
            if (e.isHost || id === hostState.userId) continue;
            const u = String(e.username || e.userId || "").toLowerCase().trim();
            if (u && !activeUsers.has(u) && !activeUsers.has(id.toLowerCase())) {
              entrants.delete(id);
              lastKnownRanks.delete(id);
            }
          }
        }
        participantsList.forEach(updateEntrantFromTelemetry);
      } else if (innerData.participant && typeof innerData.participant === "object") {
        updateEntrantFromTelemetry(innerData.participant);
      } else if (payload.participant && typeof payload.participant === "object") {
        updateEntrantFromTelemetry(payload.participant);
      } else if (innerData.user || innerData.username || innerData.userId) {
        updateEntrantFromTelemetry(innerData);
      } else if (payload.user || payload.username || payload.userId) {
        updateEntrantFromTelemetry(payload);
      } else if (msg.user || msg.username || msg.userId) {
        updateEntrantFromTelemetry(msg);
      }

      notifyListeners("entrants_update", null);
    }

    function updateEntrantFromTelemetry(data) {
      if (!data || typeof data !== "object") return;
      const live = (data.liveData && typeof data.liveData === "object")
        ? data.liveData
        : ((data.run && typeof data.run === "object") ? data.run : null);

      const uId = data.userId || data.login || data.user || (live && (live.userId || live.login || live.user)) || `racer_${entrants.size + 1}`;
      if (uId === hostState.userId) {
        return; // Standalone host state handled locally
      }

      const rawSplitName = (live && live.currentSplitName) || data.currentSplitName || "";
      const rawName = data.user || data.username || data.login || (live && (live.user || live.username || live.login)) || uId;
      let statusStr = "";
      if (data.status !== undefined && data.status !== null) {
        statusStr = String(data.status?.value || data.status?.name || data.status?.text || data.status || "").toLowerCase().trim();
      }
      if (!statusStr) {
        if (data.ready === true || data.isReady === true || (live && (live.ready === true || live.isReady === true))) {
          statusStr = "ready";
        } else if (data.ready === false || data.isReady === false || (live && (live.ready === false || live.isReady === false))) {
          statusStr = "joined";
        } else if (data.action) {
          const act = String(data.action).toLowerCase().trim();
          if (act === "ready") statusStr = "ready";
          else if (act === "unready" || act === "not_ready" || act === "notready") statusStr = "joined";
          else if (act === "joined" || act === "join") statusStr = "joined";
          else if (act === "leave" || act === "left" || act === "unjoin") statusStr = "unjoined";
        } else if (data.type) {
          const t = String(data.type).toLowerCase().trim();
          if (t === "ready") statusStr = "ready";
          else if (t === "unready" || t === "not_ready" || t === "notready") statusStr = "joined";
          else if (t === "joined" || t === "join") statusStr = "joined";
          else if (t === "leave" || t === "left" || t === "unjoin") statusStr = "unjoined";
        }
      }
      if (statusStr === "unready" || statusStr === "not_ready" || statusStr === "notready") {
        statusStr = "joined";
      }

      // Look up entrant by uId or matching username to avoid duplicate entries across event types
      let existing = entrants.get(uId);
      if (!existing && rawName) {
        for (const [id, e] of entrants.entries()) {
          if (e.username && String(e.username).toLowerCase() === String(rawName).toLowerCase()) {
            existing = e;
            break;
          }
        }
      }
      if (statusStr === "unjoined" || statusStr === "left" || statusStr === "removed") {
        const targetId = existing ? existing.userId : uId;
        entrants.delete(targetId);
        pushRaceEvent({
          type: "leave",
          user: rawName,
          text: `${rawName} left the race`,
          timestamp: Date.now()
        });
        lastKnownRanks.delete(uId);
        return;
      }


      const isMatchedHost = !!(hostUsername && (
        String(rawName).trim().toLowerCase() === hostUsername.toLowerCase() ||
        String(uId).trim().toLowerCase() === hostUsername.toLowerCase()
      ));

      const rawPic = data.picture || data.avatar || (live && (live.picture || live.avatar)) || "";

      if (!existing) {
        existing = {
          userId: uId,
          username: rawName,
          avatar: rawPic,
          color: isMatchedHost ? "#38bdf8" : RACER_PALETTE[entrants.size % RACER_PALETTE.length],
          isHost: isMatchedHost,
          currentSplitIndex: 0,
          currentSplitName: rawSplitName || "Split 1",
          currentTimeSec: 0,
          splitTimes: [],
          isFinished: false,
          finalTimeSec: null,
          score: 0,
          isMuted: false,
          status: statusStr || "joined",
          isReady: (statusStr === "ready")
        };
        entrants.set(uId, existing);
        pushRaceEvent({
          type: "join",
          user: rawName,
          text: `${rawName} joined the race`,
          timestamp: Date.now()
        });
      } else if (statusStr && existing.status && existing.status !== statusStr) {
        if (statusStr === "ready") {
          pushRaceEvent({
            type: "ready",
            user: rawName,
            text: `${rawName} is Ready`,
            timestamp: Date.now()
          });
        } else if (statusStr === "joined") {
          pushRaceEvent({
            type: "unready",
            user: rawName,
            text: `${rawName} unreadied (Joined)`,
            timestamp: Date.now()
          });
        }
      }

      existing.username = rawName;
      existing.isHost = isMatchedHost;
      if (isMatchedHost) {
        existing.color = "#38bdf8";
      }
      if (rawPic) {
        existing.avatar = rawPic;
      }

      const rawCurrentTime = (live && typeof live.currentTime === "number")
        ? live.currentTime
        : (typeof data.currentTime === "number" ? data.currentTime : (typeof data.time === "number" ? data.time : null));
      if (typeof rawCurrentTime === "number") {
        // therun.gg transmits milliseconds
        existing.currentTimeSec = rawCurrentTime > 500 ? (rawCurrentTime / 1000) : rawCurrentTime;
      } else if (typeof data.currentTimeSec === "number") {
        existing.currentTimeSec = data.currentTimeSec;
      }
      existing.reportedTimeSec = existing.currentTimeSec;
      existing.lastUpdateTimestamp = Date.now();
      if (live && typeof live.timeToNextSplit === "number" && live.timeToNextSplit > 0) {
        existing.timeToNextSplit = live.timeToNextSplit > 500 ? (live.timeToNextSplit / 1000) : live.timeToNextSplit;
      }
      if (live && typeof live.streaming === "boolean") {
        existing.isStreaming = live.streaming;
      }

      if (live && typeof live.splitStartedAt === "number" && live.splitStartedAt > 0) {
        existing.splitStartedAt = live.splitStartedAt;
      }
      if (data.status) {
        existing.status = statusStr;
        existing.isReady = (statusStr === "ready");
      }

      const rawDelta = (live && live.delta !== undefined) ? live.delta : data.delta;
      if (typeof rawDelta === "number") {
        existing.delta = rawDelta;
        existing.deltaSec = Math.abs(rawDelta) > 500 ? (rawDelta / 1000) : rawDelta;
      } else if (typeof rawDelta === "string" && !isNaN(parseFloat(rawDelta))) {
        const p = parseFloat(rawDelta);
        existing.delta = p;
        existing.deltaSec = Math.abs(p) > 500 ? (p / 1000) : p;
      }

      const rawSplitTimes = (live && Array.isArray(live.splitTimes)) ? live.splitTimes : data.splitTimes;
      const rawSplitPreds = (live && Array.isArray(live.splitPredictions)) ? live.splitPredictions : data.splitPredictions;
      if (Array.isArray(rawSplitTimes)) {
        existing.splitTimes = normalizeSplitTimes(rawSplitTimes);
      } else if (existing.isFinished && Array.isArray(rawSplitPreds) && rawSplitPreds.length > 0) {
        // Finished race snapshot (like tzsm): splitPredictions contains final checkpoint times
        const extracted = Array.isArray(existing.splitTimes) ? existing.splitTimes.slice() : [];
        rawSplitPreds.forEach((sp) => {
          if (sp && typeof sp.splitIndex === "number" && sp.splitIndex >= 1 && sp.currentTime !== undefined && sp.currentTime !== null) {
            const t = Number(sp.currentTime);
            if (!isNaN(t) && t > 0) {
              extracted[sp.splitIndex - 1] = t > 500 ? (t / 1000) : t;
            }
          }
        });
        existing.splitTimes = extracted;
      }

      const rawSplitIdx = (live && typeof live.currentSplitIndex === "number")
        ? live.currentSplitIndex
        : data.currentSplitIndex;
      // rawSplitName declared at top of updateEntrantFromTelemetry
      const rawIsGold = (live && (live.isGold === true || live.gold === true || live.split?.isGold === true)) ||
        data.isGold === true || data.gold === true || data.split?.isGold === true;

      if (typeof rawSplitIdx === "number" && rawSplitIdx >= 0) {
        if (!Array.isArray(existing.splitTimes)) {
          existing.splitTimes = [];
        }
        if (rawSplitIdx > existing.currentSplitIndex) {
          // Completed a split! Determine split type from telemetry
          let flashType = "green";
          if (rawIsGold) {
            flashType = "gold";
          } else if (typeof rawDelta === "number") {
            flashType = rawDelta <= 0 ? "green" : "red";
          } else if (typeof rawDelta === "string") {
            flashType = rawDelta.trim().startsWith("+") ? "red" : "green";
          } else if (data.gainedTime === false || (live && live.gainedTime === false)) {
            flashType = "red";
          }
          const prevSplitName = existing.currentSplitName
            || (activeSplitsList && activeSplitsList[existing.currentSplitIndex])
            || `Split ${existing.currentSplitIndex + 1}`;
          const nextSplitName = rawSplitName
            || (activeSplitsList && activeSplitsList[rawSplitIdx])
            || `Split ${rawSplitIdx + 1}`;
          existing.lastSplitEffect = {
            type: flashType,
            timestamp: Date.now(),
            completedSplitName: prevSplitName,
            newSplitName: nextSplitName
          };
          if (existing.currentTimeSec > 0) {
            existing.splitTimes[rawSplitIdx - 1] = existing.currentTimeSec;
          }
        } else if (rawSplitIdx < existing.currentSplitIndex) {
          if (Array.isArray(existing.splitTimes)) {
            existing.splitTimes = existing.splitTimes.slice(0, Math.max(0, rawSplitIdx));
          }
          checkpointRankHistory.forEach((histMap, c) => {
            if (c >= rawSplitIdx) {
              histMap.delete(uId);
            }
          });
        }
        existing.currentSplitIndex = rawSplitIdx;
      }

      if (rawSplitName) {
        existing.currentSplitName = rawSplitName;
      } else if (!existing.currentSplitName) {
        existing.currentSplitName = "Split 1";
      }
      const rawSplits = (live && (Array.isArray(live.splits) ? live.splits : (live.runData && Array.isArray(live.runData.splits) ? live.runData.splits : null)))
        || (Array.isArray(data.splits) ? data.splits : null);
      if (Array.isArray(rawSplits)) {
        existing.splits = rawSplits;
        if (!Array.isArray(rawSplitTimes) && (!Array.isArray(rawSplitPreds) || rawSplitPreds.length === 0)) {
          const extracted = [];
          rawSplits.forEach((s, idx) => {
            if (s && typeof s.splitTime === "number" && !isNaN(s.splitTime) && s.splitTime > 0) {
              extracted[idx] = s.splitTime > 500 ? (s.splitTime / 1000) : s.splitTime;
            }
          });
          if (extracted.length > 0 && (!Array.isArray(existing.splitTimes) || existing.splitTimes.length === 0 || existing.isFinished)) {
            existing.splitTimes = extracted;
          }
        }
      }

      const rawMonteCarlo = (live && live.monteCarloPrediction) || data.monteCarloPrediction;
      if (rawMonteCarlo) {
        existing.monteCarloPrediction = rawMonteCarlo;
      }

      const rawPred = (live && typeof live.currentPrediction === "number")
        ? live.currentPrediction
        : ((live && typeof live.estimatedFinishTime === "number")
          ? live.estimatedFinishTime
          : (typeof data.currentPrediction === "number"
            ? data.currentPrediction
            : (typeof data.estimatedFinishTime === "number" ? data.estimatedFinishTime : null)));
      if (typeof rawPred === "number" && rawPred > 0) {
        existing.currentPrediction = rawPred > 500 ? (rawPred / 1000) : rawPred;
      }
      if (data.pb !== undefined && data.pb !== null && !isNaN(Number(data.pb)) && Number(data.pb) > 0) {
        const pbVal = Number(data.pb);
        existing.pbSec = pbVal > 500 ? (pbVal / 1000) : pbVal;
      }

      const rawFinalTime = (data.finalTime !== undefined && data.finalTime !== null && !isNaN(Number(data.finalTime)) && Number(data.finalTime) > 0)
        ? Number(data.finalTime)
        : ((live && typeof live.finalTime === "number" && live.finalTime > 0) ? live.finalTime : null);

      const isDnf = data.isDNF === true ||
                    data.dnf === true ||
                    data.forfeited === true ||
                    data.isForfeit === true ||
                    data.disqualified === true ||
                    statusStr === "forfeited" ||
                    statusStr === "abandoned" ||
                    statusStr === "dnf" ||
                    statusStr === "quit" ||
                    (data.hasEnded === true && !data.isFinished && !existing.isFinished && statusStr !== "finished" && statusStr !== "confirmed" && rawFinalTime === null);
      const isFin = !isDnf && (
        statusStr === "finished" ||
        statusStr === "confirmed" ||
        data.isFinished === true ||
        (live && live.runFinished === true) ||
        data.hasEnded === true ||
        rawFinalTime !== null
      );

      if (isDnf) {
        existing.isDNF = true;
        existing.isFinished = false;
        if (!existing.dnfTimeSec) existing.dnfTimeSec = existing.currentTimeSec || 0;
        existing.currentSplitName = "DNF";
      } else if (isFin) {
        existing.isFinished = true;
        existing.isDNF = false;
        if (rawFinalTime !== null) {
          existing.finalTimeSec = rawFinalTime > 500 ? (rawFinalTime / 1000) : rawFinalTime;
          existing.currentTimeSec = existing.finalTimeSec;
        } else if (!existing.finalTimeSec) {
          existing.finalTimeSec = existing.currentTimeSec;
        }
        existing.currentSplitName = "Finished";
      }

      const rawRunPct = (live && typeof live.runPercentage === "number")
        ? live.runPercentage
        : ((live && typeof live.runPercentageTime === "number")
          ? live.runPercentageTime
          : ((live && typeof live.runPercentageSplits === "number")
            ? live.runPercentageSplits
            : (typeof data.runPercentage === "number" ? data.runPercentage : null)));
      let normRunPct = rawRunPct !== null
        ? (rawRunPct > 1 ? (rawRunPct / 100) : rawRunPct)
        : 0;

      if (!normRunPct && live && typeof live.estimatedFinishTime === "number" && live.estimatedFinishTime > 0 && typeof live.currentTime === "number" && live.currentTime > 0) {
        normRunPct = Math.min(0.999, live.currentTime / live.estimatedFinishTime);
      }
      if (existing.isFinished) {
        normRunPct = 1.0;
      }

      const totalSplits = (live && typeof live.totalSplits === "number" && live.totalSplits > 0)
        ? live.totalSplits
        : ((Array.isArray(existing.splits) && existing.splits.length > 0) ? existing.splits.length : (Array.isArray(data.splits) ? data.splits.length : 0));
      existing.totalSplits = totalSplits;
      existing.runPercentage = normRunPct;

      // Calculate within-split ratio for current split
      let inSegRatio = null;
      if (normRunPct > 0 && totalSplits > 0) {
        const withinFromOverall = (normRunPct * totalSplits) - existing.currentSplitIndex;
        if (withinFromOverall >= 0 && withinFromOverall <= 1.0) {
          inSegRatio = withinFromOverall;
        }
      }

      // High-precision dead-reckoning progress calculation using predicted single duration or PB
      if (typeof rawCurrentTime === "number" && !existing.isFinished && !existing.isDNF) {
        const curSec = existing.currentTimeSec || 0;
        const curIdx = existing.currentSplitIndex || 0;
        let prevTimeSec = 0;
        const prevSplit = (curIdx > 0 && Array.isArray(existing.splits) && existing.splits[curIdx - 1]) ? existing.splits[curIdx - 1] : null;
        if (prevSplit && typeof prevSplit.splitTime === "number") {
          prevTimeSec = prevSplit.splitTime > 500 ? (prevSplit.splitTime / 1000) : prevSplit.splitTime;
        } else if (prevSplit && typeof prevSplit.pbSplitTime === "number") {
          prevTimeSec = prevSplit.pbSplitTime > 500 ? (prevSplit.pbSplitTime / 1000) : prevSplit.pbSplitTime;
        }

        const elapsedInSeg = Math.max(0, curSec - prevTimeSec);
        const curSplit = (Array.isArray(existing.splits) && existing.splits[curIdx]) ? existing.splits[curIdx] : null;
        let expectedDur = 30.0;
        if (curSplit && typeof curSplit.predictedSingleTime === "number" && curSplit.predictedSingleTime > 0) {
          expectedDur = curSplit.predictedSingleTime > 500 ? (curSplit.predictedSingleTime / 1000) : curSplit.predictedSingleTime;
        } else if (curSplit && curSplit.single && parseFloat(curSplit.single.averageTime) > 0) {
          const avg = parseFloat(curSplit.single.averageTime);
          expectedDur = avg > 500 ? (avg / 1000) : avg;
        } else if (curSplit && typeof curSplit.pbSplitTime === "number") {
          const pbCur = curSplit.pbSplitTime > 500 ? (curSplit.pbSplitTime / 1000) : curSplit.pbSplitTime;
          expectedDur = Math.max(0.5, pbCur - prevTimeSec);
        }
        const deadReckonRatio = Math.max(0, Math.min(0.99, elapsedInSeg / Math.max(0.5, expectedDur)));
        if (inSegRatio === null || Math.abs(deadReckonRatio - inSegRatio) > 0.05) {
          inSegRatio = deadReckonRatio;
        }
      }

      if (inSegRatio === null) {
        inSegRatio = 0.5;
      }

      existing.score = existing.isFinished
        ? (activeSplitsList ? activeSplitsList.length : existing.currentSplitIndex + 1)
        : existing.currentSplitIndex + inSegRatio;

      if (existing.isDNF && existing.dnfScore === undefined) {
        existing.dnfScore = existing.score;
      }

      entrants.set(uId, existing);
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
      isStandby: () => isStandby,
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
      getWebSocketLogs: () => wsDebugLogs.slice(),
      clearWebSocketLogs: () => {
        wsDebugLogs.length = 0;
        notifyListeners("ws_logs_cleared", null);
      },
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
