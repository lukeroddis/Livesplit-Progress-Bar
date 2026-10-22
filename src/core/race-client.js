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
  const THERUN_WS_BASE = "wss://fh76djw1t9.execute-api.eu-west-1.amazonaws.com/prod?race=";

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

  // Preset virtual competitors for realistic simulation mode (9 competitors + 1 host = 10 racers total)
  // Balanced around Host as median pace (P5/P6): 4 faster rivals ahead (-0.5% to -5.0%), 5 rivals behind (+0.8% to +6.5%)
  // Over a 3.5h run, this produces the requested +/- 10 min spread; over a 15m run, it scales adaptively to +/- 45-60s.
  const SIMULATED_COMPETITORS = [
    {
      id: "sim_speeddemon",
      username: "SpeedDemon",
      avatar: "⚡",
      color: "#06b6d4",
      paceFactor: 0.950, // P1 contender (-5.0% pace, ~10.2m ahead in 3.5h)
      driftOffset: -1.8
    },
    {
      id: "sim_turboblaze",
      username: "TurboBlaze",
      avatar: "🔥",
      color: "#ef4444",
      paceFactor: 0.965, // P2 contender (-3.5% pace, ~7.1m ahead in 3.5h)
      driftOffset: -0.9
    },
    {
      id: "sim_pixelknight",
      username: "PixelKnight",
      avatar: "🛡️",
      color: "#10b981",
      paceFactor: 0.980, // P3 contender (-2.0% pace, ~4.1m ahead in 3.5h)
      driftOffset: -0.4
    },
    {
      id: "sim_apex",
      username: "ApexRunner",
      avatar: "🏎️",
      color: "#f59e0b",
      paceFactor: 0.995, // Direct rival (-0.5% pace, ~1.0m ahead in 3.5h)
      driftOffset: 0.2
    },
    // [Host / You: 1.000 baseline (Average pace)]
    {
      id: "sim_frostbyte",
      username: "FrostByte",
      avatar: "❄️",
      color: "#38bdf8",
      paceFactor: 1.008, // Close pursuer (+0.8% pace, ~1.6m behind in 3.5h)
      driftOffset: 0.8
    },
    {
      id: "sim_echoglide",
      username: "EchoGlide",
      avatar: "🌀",
      color: "#3b82f6",
      paceFactor: 1.020, // Midfield chaser (+2.0% pace, ~4.1m behind in 3.5h)
      driftOffset: 1.4
    },
    {
      id: "sim_vipersprint",
      username: "ViperSprint",
      avatar: "🐍",
      color: "#84cc16",
      paceFactor: 1.035, // Dynamic overtaker (+3.5% pace, ~7.1m behind in 3.5h)
      driftOffset: -2.3
    },
    {
      id: "sim_shadow",
      username: "ShadowPacer",
      avatar: "👤",
      color: "#a855f7",
      paceFactor: 1.050, // Conservative pacer (+5.0% pace, ~10.2m behind in 3.5h)
      driftOffset: 2.5
    },
    {
      id: "sim_novashift",
      username: "NovaShift",
      avatar: "✨",
      color: "#ec4899",
      paceFactor: 1.065, // Late charger (+6.5% pace, ~13.2m behind in 3.5h)
      driftOffset: 3.1
    }
  ];

  /**
   * Safely loads the stored therun username from local storage.
   */
  function loadStoredUsername() {
    try {
      if (typeof localStorage !== "undefined") {
        return (localStorage.getItem("therun_username") || "").trim();
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
    let heartbeatTimer = null;
    let hostUsername = loadStoredUsername();
    let autoDetectUsername = hostUsername;
    let isSimulating = false;
    let simulationTimer = null;
    let activeSplitsList = [];
    let activeComparisonTimes = [];
    let activeComparisonTimesRT = [];
    let simulationCourseTargets = [];
    const lastKnownRanks = new Map();
    let lastExternalHostUpdate = 0;

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
      score: 0,
      isMuted: false
    };

    function setHostUsername(name) {
      hostUsername = (name || "").trim();
      autoDetectUsername = hostUsername;
      hostState.username = hostUsername || "You";

      if (isSimulating) {
        const hostEntrant = entrants.get(hostState.userId);
        if (hostEntrant) {
          hostEntrant.username = hostState.username;
        }
      } else {
        // In live race, update isHost on entrants matching hostUsername
        entrants.forEach((entrant) => {
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
     * Normalizes a race identifier or URL (e.g. "https://therun.gg/races/f0ub" -> "f0ub")
     */
    function parseRaceId(input) {
      if (!input || typeof input !== "string") return null;
      const trimmed = input.trim();
      const match = trimmed.match(/(?:therun\.gg\/races\/|racetime\.gg\/[^/]+\/)?([a-zA-Z0-9_-]+)\/?$/i);
      return match ? match[1] : trimmed;
    }

    function getCourseRefTime(runner) {
      if (runner.isFinished && typeof runner.finalTimeSec === "number") {
        return runner.finalTimeSec;
      }
      const score = Math.max(0, runner.score || 0);
      const sIdx = Math.floor(score);
      const sRatio = Math.max(0, Math.min(1.0, score - sIdx));
      const comp = (activeComparisonTimesRT && activeComparisonTimesRT.length > 0)
        ? activeComparisonTimesRT
        : ((activeComparisonTimes && activeComparisonTimes.length > 0)
          ? activeComparisonTimes
          : ((simulationCourseTargets && simulationCourseTargets.length > 0)
            ? simulationCourseTargets
            : [30, 60, 90, 120, 150, 180, 210, 240]));
      const tPrev = sIdx > 0 ? (comp[sIdx - 1] || (sIdx * 30)) : 0;
      const tNext = (sIdx < comp.length) ? (comp[sIdx] || ((sIdx + 1) * 30)) : (tPrev + 30);
      return tPrev + sRatio * (tNext - tPrev);
    }

    /**
     * Returns all entrants (host + competitors), sorted into F1 standings order.
     */
    function getRankedEntrants() {
      let list = Array.from(entrants.values());

      if (isSimulating) {
        // In simulation mode, ensure host runner is present
        if (!list.some(r => r.userId === hostState.userId)) {
          list.push(hostState);
        }
      } else if (ws !== null || (raceId && raceId !== "sim_cup_2026")) {
        // In live race:
        // If user has not set a username in settings, display the race entrants with NO host runner
        if (!hostUsername) {
          list = list.filter(r => r.userId !== hostState.userId);
        } else {
          // If user HAS set a username in settings, check if one of the live race entrants matched
          const hasMatched = list.some(r => r.isHost && r.userId !== hostState.userId);
          if (hasMatched) {
            list = list.filter(r => r.userId !== hostState.userId);
          }
        }
      } else {
        // Idle/preview state: ensure host is in the list
        if (!list.some(r => r.userId === hostState.userId)) {
          list.push(hostState);
        }
      }

      // Sort criteria:
      // 1. Finished runners ranked first by finalTimeSec ascending (fastest finish wins)
      // 2. Active runners ranked by continuous race score descending (further along split track)
      // 3. Ties broken by currentTimeSec ascending
      // Incumbency bonus (~0.012 per rank held, equivalent to ~0.36s of track time) provides
      // realistic racing overtake stability so neck-and-neck competitors don't jitter or oscillate,
      // while scalar scoring strictly preserves mathematical transitivity (zero Timsort cycles).
      // Leaderboard sorting rules:
      // 1. Finished runners ranked first by finalTimeSec ascending (fastest finish wins)
      // 2. Active runners ranked by currentSplitIndex descending (highest milestone reached)
      // 3. Active runners on the SAME split checkpoint: leaderboard positioning updates on the
      //    occasion of splitting, NOT based on predicted mid-split interpolation curves.
      //    Ties are broken by comparing cumulative split times at the last completed split checkpoint!
      // 4. Stable rank fallback to prevent mid-split swapping or jitter.
      list.forEach((r) => {
        r._effectiveScore = r.score || 0;
      });

      list.sort((a, b) => {
        if (a.isFinished && b.isFinished) {
          return (a.finalTimeSec || Infinity) - (b.finalTimeSec || Infinity);
        }
        if (a.isFinished && !b.isFinished) return -1;
        if (!a.isFinished && b.isFinished) return 1;

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

        // On the first split, before anyone splits, it is blank for everyone
        if (countA === 0 && countB === 0) {
          if ((aheadRunner.currentSplitIndex || 0) === 0 && (runner.currentSplitIndex || 0) === 0 && !aheadRunner.isFinished && !runner.isFinished) {
            return null;
          }
          return Math.max(0, getCourseRefTime(aheadRunner) - getCourseRefTime(runner));
        }

        const currentIdxB = Math.max(0, runner.currentSplitIndex || 0);

        // If aheadRunner has completed split currentIdxB (countA > currentIdxB),
        // but runner has NOT completed split currentIdxB yet (countB <= currentIdxB):
        // The delta starts at the last completed split gap, and increments upwards as runner's
        // time exceeds aheadRunner's split milestone.
        if (countA > currentIdxB && countB <= currentIdxB) {
          const timeAAtSplit = splitsA[currentIdxB];
          const timeBNow = runner.currentTimeSec || 0;

          if (typeof timeAAtSplit === "number") {
            if (currentIdxB === 0) {
              // First split: live incrementing delta starting from when aheadRunner split
              return Math.max(0, timeBNow - timeAAtSplit);
            } else {
              // Subsequent split: previous completed split gap + time accumulating since aheadRunner split
              const prevA = splitsA[currentIdxB - 1];
              const prevB = splitsB[currentIdxB - 1];
              const prevGap = (typeof prevA === "number" && typeof prevB === "number")
                ? Math.max(0, prevB - prevA)
                : 0;
              return prevGap + Math.max(0, timeBNow - timeAAtSplit);
            }
          }
        }

        // Both runners have completed split currentIdxB (or last common split):
        // Fixed gap based on the last completed split milestone
        const lastCommonIdx = Math.min(countA, countB) - 1;
        if (lastCommonIdx >= 0) {
          const timeA = splitsA[lastCommonIdx];
          const timeB = splitsB[lastCommonIdx];
          if (typeof timeA === "number" && typeof timeB === "number") {
            return Math.max(0, timeB - timeA);
          }
        }

        // If aheadRunner has finished but runner hasn't reached final split yet
        if (aheadRunner.isFinished && typeof aheadRunner.finalTimeSec === "number") {
          const lastB = countB > 0 ? splitsB[countB - 1] : 0;
          const lastA = countB > 0 && splitsA.length >= countB ? splitsA[countB - 1] : 0;
          const prevGap = Math.max(0, lastB - lastA);
          return prevGap + Math.max(0, (runner.currentTimeSec || 0) - aheadRunner.finalTimeSec);
        }

        return null;
      }

      list.forEach((runner, idx) => {
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

          if (runner.checkpointTimes && runner.checkpointTimes.length > sIdx) {
            const prevT = sIdx > 0 ? (runner.checkpointTimes[sIdx - 1] || 0) : 0;
            segSec = Math.max(0.1, (runner.checkpointTimes[sIdx] || 0) - prevT);
          } else {
            const comp = (activeComparisonTimesRT && activeComparisonTimesRT.length > 0)
              ? activeComparisonTimesRT
              : ((activeComparisonTimes && activeComparisonTimes.length > 0)
                ? activeComparisonTimes
                : ((simulationCourseTargets && simulationCourseTargets.length > 0)
                  ? simulationCourseTargets
                  : [30, 60, 90, 120, 150, 180, 210, 240]));
            const prevT = sIdx > 0 ? (comp[sIdx - 1] || (sIdx * 30)) : 0;
            const nextT = (sIdx < comp.length) ? (comp[sIdx] || ((sIdx + 1) * 30)) : (prevT + 30);
            segSec = Math.max(0.1, nextT - prevT);
          }

          if (sIdx > 0 && normSplits.length >= sIdx && typeof normSplits[sIdx - 1] === "number") {
            prevSplitTime = normSplits[sIdx - 1];
          } else if (sIdx > 0 && runner.checkpointTimes && typeof runner.checkpointTimes[sIdx - 1] === "number") {
            prevSplitTime = runner.checkpointTimes[sIdx - 1];
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

      return list;
    }

    function formatGapTime(sec) {
      if (sec === null || sec === undefined || isNaN(sec)) return "--";
      if (sec < 60) {
        return `${sec.toFixed(1)}s`;
      }
      const m = Math.floor(sec / 60);
      const s = (sec % 60).toFixed(1);
      return `${m}:${s.padStart(4, "0")}`;
    }

    /**
     * Updates the host runner's in-run progress.
     */
    function updateHostProgress(currentSec, currentIndex, completedSplitTimes = [], comparisonTimes = [], currentSplitName = "", splitsList = [], splitFlash = null, isExternal = true, realTimeSec = null, comparisonTimesRT = [], completedSplitTimesRT = []) {
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

      // Live race clock strictly runs on Real Time (RTA) so loading screens (which pause Game Time)
      // do not freeze the live race or simulated competitors
      const raceClockSec = (typeof realTimeSec === "number" && realTimeSec > 0)
        ? realTimeSec
        : Math.max(0, currentSec || 0);

      hostState.currentTimeSec = raceClockSec;
      hostState.currentSplitIndex = Math.max(0, currentIndex || 0);

      const normCompletedRT = normalizeSplitTimes(completedSplitTimesRT);
      hostState.splitTimes = normCompletedRT.length > 0
        ? normCompletedRT
        : normalizeSplitTimes(completedSplitTimes);

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
      } else if (hostState.lastSplitEffect && (Date.now() - (hostState.lastSplitEffect.timestamp || 0)) > 2200) {
        hostState.lastSplitEffect = null;
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

      // In simulation mode, update simulated competitors synchronously with real-time race clock
      if (isSimulating) {
        tickSimulatedCompetitors(raceClockSec);
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
    // ZERO-CLICK THERUN.GG AUTO-DETECTION HEARTBEAT
    // ============================================================

    function startAutoDetect(username) {
      if (!username || typeof username !== "string") return;
      autoDetectUsername = username.trim();
      stopAutoDetect();

      // Immediately poll once, then schedule recurring heartbeat
      pollUserStatus();
      heartbeatTimer = setInterval(pollUserStatus, 7000);
    }

    function stopAutoDetect() {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }

    async function pollUserStatus() {
      if (!autoDetectUsername || isSimulating) return;

      try {
        const res = await fetch(`${THERUN_LIVE_API}/${encodeURIComponent(autoDetectUsername)}`);
        if (!res.ok) return;

        const data = await res.json();
        if (data && data.raceId) {
          if (raceId !== data.raceId) {
            console.log(`[RaceClient] Detected raceId from therun.gg: ${data.raceId}`);
            connectToRace(data.raceId);
          }
        } else if (raceId && !data?.raceId) {
          // Runner left race or race concluded
          console.log("[RaceClient] Race status cleared on therun.gg. Disconnecting.");
          disconnectFromRace();
        }
      } catch (err) {
        // Silent network failure guard (offline / rate limit)
      }
    }

    // ============================================================
    // WEBSOCKET RACE CONNECTION (therun.gg)
    // ============================================================

    function connectToRace(targetRaceId) {
      const cleanId = parseRaceId(targetRaceId);
      if (!cleanId) return false;

      if (raceId === cleanId && ws && ws.readyState === WebSocket.OPEN) {
        return true;
      }

      disconnectFromRace();
      raceId = cleanId;

      try {
        const wsUrl = `${THERUN_WS_BASE}${encodeURIComponent(cleanId)}`;
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          console.log(`[RaceClient] Connected to live race: ${cleanId}`);
          notifyListeners("race_connected", { raceId: cleanId });
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            handleRaceMessage(msg);
          } catch (e) {
            console.warn("[RaceClient] Message parse error:", e);
          }
        };

        ws.onclose = () => {
          console.log("[RaceClient] Race WebSocket closed");
          notifyListeners("race_disconnected", { raceId: cleanId });
        };

        ws.onerror = (err) => {
          console.warn("[RaceClient] WebSocket error:", err);
        };

        return true;
      } catch (err) {
        console.error("[RaceClient] Failed to connect to race WebSocket:", err);
        return false;
      }
    }

    function disconnectFromRace() {
      if (ws) {
        try {
          ws.close();
        } catch (_) {}
        ws = null;
      }
      raceId = null;
      const stored = loadStoredUsername();
      if (stored) {
        hostUsername = stored;
      }
      hostState.username = hostUsername || "You";
      hostState.isHost = true;
      hostState.color = "#38bdf8";

      entrants.clear();
      entrants.set(hostState.userId, Object.assign({}, hostState));
      notifyListeners("race_disconnected", null);
    }

    function handleRaceMessage(msg) {
      if (!msg) return;

      // Handle full entrants snapshot or incremental runner update
      if (Array.isArray(msg.entrants) || Array.isArray(msg)) {
        const list = Array.isArray(msg.entrants) ? msg.entrants : msg;
        list.forEach(updateEntrantFromTelemetry);
      } else if (msg.user || msg.username || msg.userId) {
        updateEntrantFromTelemetry(msg);
      }

      notifyListeners("entrants_update", null);
    }

    function updateEntrantFromTelemetry(data) {
      const uId = data.userId || data.login || data.user || `racer_${entrants.size + 1}`;
      if (uId === hostState.userId) {
        return; // Standalone host state handled locally
      }

      const rawName = data.user || data.username || data.login || uId;
      const isMatchedHost = !!(hostUsername && (
        String(rawName).trim().toLowerCase() === hostUsername.toLowerCase() ||
        String(uId).trim().toLowerCase() === hostUsername.toLowerCase()
      ));

      const existing = entrants.get(uId) || {
        userId: uId,
        username: rawName,
        avatar: data.picture || data.avatar || "",
        color: isMatchedHost ? "#38bdf8" : RACER_PALETTE[entrants.size % RACER_PALETTE.length],
        isHost: isMatchedHost,
        currentSplitIndex: 0,
        currentSplitName: "",
        currentTimeSec: 0,
        isFinished: false,
        finalTimeSec: null,
        score: 0,
        isMuted: false
      };

      existing.username = rawName;
      existing.isHost = isMatchedHost;
      if (isMatchedHost) {
        existing.color = "#38bdf8";
      }

      if (typeof data.currentSplitIndex === "number") {
        if (data.currentSplitIndex > existing.currentSplitIndex) {
          // Completed a split! Determine split type from telemetry
          let flashType = "green";
          if (data.isGold === true || data.gold === true || data.split?.isGold === true) {
            flashType = "gold";
          } else if (typeof data.delta === "number") {
            flashType = data.delta <= 0 ? "green" : "red";
          } else if (typeof data.delta === "string") {
            flashType = data.delta.trim().startsWith("+") ? "red" : "green";
          } else if (data.gainedTime === false) {
            flashType = "red";
          }
          const prevSplitName = existing.currentSplitName
            || (activeSplitsList && activeSplitsList[existing.currentSplitIndex])
            || `Split ${existing.currentSplitIndex + 1}`;
          const nextSplitName = data.currentSplitName
            || (activeSplitsList && activeSplitsList[data.currentSplitIndex])
            || `Split ${data.currentSplitIndex + 1}`;
          existing.lastSplitEffect = {
            type: flashType,
            timestamp: Date.now(),
            completedSplitName: prevSplitName,
            newSplitName: nextSplitName
          };
        }
        existing.currentSplitIndex = data.currentSplitIndex;
      }
      if (data.currentSplitName) {
        existing.currentSplitName = data.currentSplitName;
      }
      if (typeof data.currentTime === "number") {
        // therun.gg transmits milliseconds
        existing.currentTimeSec = data.currentTime > 50000 ? (data.currentTime / 1000) : data.currentTime;
      }
      if (data.picture) {
        existing.avatar = data.picture;
      }
      if (data.hasEnded || data.isFinished) {
        existing.isFinished = true;
        existing.finalTimeSec = existing.currentTimeSec;
      }

      // Simple score estimation for live competitor: split index + 0.5 (or progress if available)
      existing.score = existing.currentSplitIndex + (data.runPercentage ? (data.runPercentage / 100) : 0.5);

      entrants.set(uId, existing);
    }

    // ============================================================
    // LIVE RACE SIMULATION / TEST MODE
    // ============================================================

    /**
     * Starts realistic live race simulation with 3 virtual competitors.
     */
    function startSimulation(splitsList = [], comparisonTimes = [], comparisonTimesRT = []) {
      stopSimulation();
      isSimulating = true;
      raceId = "sim_cup_2026";

      activeSplitsList = (Array.isArray(splitsList) && splitsList.length > 0)
        ? [...splitsList]
        : ["Split 1", "Split 2", "Split 3", "Split 4", "Split 5", "Split 6", "Split 7", "Finished"];

      const fallbackTargets = [30, 60, 90, 120, 150, 180, 210, 240];
      if (Array.isArray(comparisonTimes) && comparisonTimes.length > 0) {
        simulationCourseTargets = [...comparisonTimes];
        activeComparisonTimes = [...comparisonTimes];
      } else {
        simulationCourseTargets = [...fallbackTargets];
        activeComparisonTimes = [...fallbackTargets];
      }

      if (Array.isArray(comparisonTimesRT) && comparisonTimesRT.length > 0) {
        activeComparisonTimesRT = [...comparisonTimesRT];
      } else {
        activeComparisonTimesRT = [...simulationCourseTargets];
      }

      while (simulationCourseTargets.length < activeSplitsList.length) {
        const lastT = simulationCourseTargets[simulationCourseTargets.length - 1] || 0;
        simulationCourseTargets.push(lastT + 30);
      }

      const stored = loadStoredUsername();
      if (stored) {
        hostUsername = stored;
      }
      hostState.username = hostUsername || "You";
      hostState.isHost = true;
      hostState.color = "#38bdf8";
      hostState.currentTimeSec = 0;
      hostState.currentSplitIndex = 0;
      hostState.currentSplitName = activeSplitsList[0] || "Split 1";
      hostState.splitTimes = [];
      hostState.isFinished = false;
      hostState.finalTimeSec = null;
      hostState.score = 0;
      hostState.lastSplitEffect = null;

      entrants.clear();
      entrants.set(hostState.userId, Object.assign({}, hostState));

      SIMULATED_COMPETITORS.forEach((cfg) => {
        const checkpointTimes = [];
        let cumTime = 0;
        for (let k = 0; k < simulationCourseTargets.length; k++) {
          const prevT = k > 0 ? simulationCourseTargets[k - 1] : 0;
          const baseSegDur = Math.max(1, simulationCourseTargets[k] - prevT);
          // Substantial segment swing (-12% to +14%) reflecting mistakes, bad RNG, and gold splits:
          const seed = Math.sin((k + 1) * 12.9898 + (cfg.driftOffset * 78.233)) * 43758.5453;
          const pseudoRand = (seed - Math.floor(seed)) * 2.0 - 1.0; // range -1.0 to +1.0
          const wave = Math.sin((k + 1) * 2.1 + cfg.driftOffset);
          const swingPercent = (wave * 0.08) + (pseudoRand * 0.06);
          const segDur = Math.max(0.5, baseSegDur * (cfg.paceFactor + swingPercent));
          cumTime += segDur;
          checkpointTimes.push(cumTime);
        }

        entrants.set(cfg.id, {
          userId: cfg.id,
          username: cfg.username,
          avatar: cfg.avatar,
          color: cfg.color,
          paceFactor: cfg.paceFactor,
          driftOffset: cfg.driftOffset,
          checkpointTimes,
          currentSplitIndex: 0,
          currentSplitName: activeSplitsList[0] || "Split 1",
          currentTimeSec: 0,
          splitTimes: [],
          isFinished: false,
          finalTimeSec: null,
          score: 0,
          isMuted: false,
          lastSplitEffect: null
        });
      });

      notifyListeners("race_connected", { raceId, isSimulated: true });

      let simVirtualSec = hostState.currentTimeSec || 0;

      function advanceVirtualHost(baseSec) {
        simVirtualSec = baseSec + 0.05;
        let curIdx = 0;
        for (let i = 0; i < simulationCourseTargets.length; i++) {
          if (simVirtualSec < simulationCourseTargets[i]) {
            curIdx = i;
            break;
          }
          curIdx = i + 1;
        }
        curIdx = Math.min(curIdx, simulationCourseTargets.length);
        let hostFlash = null;
        if (curIdx > hostState.currentSplitIndex && hostState.currentSplitIndex >= 0) {
          if (!Array.isArray(hostState.splitTimes)) hostState.splitTimes = [];
          for (let k = hostState.currentSplitIndex; k < curIdx; k++) {
            hostState.splitTimes[k] = simulationCourseTargets[k] || ((k + 1) * 30);
          }
          const prevSplitName = hostState.currentSplitName
            || (activeSplitsList && activeSplitsList[hostState.currentSplitIndex])
            || `Split ${hostState.currentSplitIndex + 1}`;
          const nextSplitName = (activeSplitsList && activeSplitsList[curIdx])
            ? activeSplitsList[curIdx]
            : (curIdx >= simulationCourseTargets.length ? "Finished" : `Split ${curIdx + 1}`);
          hostFlash = {
            type: "gold",
            timestamp: Date.now(),
            completedSplitName: prevSplitName,
            newSplitName: nextSplitName
          };
        }
        const sName = (activeSplitsList && activeSplitsList[curIdx]) ? activeSplitsList[curIdx] : `Split ${curIdx + 1}`;
        updateHostProgress(simVirtualSec, curIdx, hostState.splitTimes, simulationCourseTargets, sName, activeSplitsList, hostFlash, false, simVirtualSec, activeComparisonTimesRT.length > 0 ? activeComparisonTimesRT : simulationCourseTargets, hostState.splitTimes);
      }

      simulationTimer = setInterval(() => {
        if (!isSimulating) return;

        const isExternalHostRunning = hostState.currentTimeSec > 0 && (Date.now() - lastExternalHostUpdate < 1500);

        if (hostState.currentTimeSec > 0) {
          if (isExternalHostRunning && lastExternalHostUpdate > 0) {
            // LiveSplit is actively driving the run: keep competitors synchronized to host run time
            tickSimulatedCompetitors(hostState.currentTimeSec);
          } else {
            advanceVirtualHost(Math.max(simVirtualSec, hostState.currentTimeSec));
          }
        } else {
          advanceVirtualHost(simVirtualSec);
        }
        notifyListeners("entrant_updated", null);
        if (typeof window !== "undefined" && typeof window.updateGhostRunner === "function") {
          window.updateGhostRunner(hostState.currentTimeSec || simVirtualSec);
        }
      }, 50);
    }

    function stopSimulation() {
      if (simulationTimer) {
        clearInterval(simulationTimer);
        simulationTimer = null;
      }
      if (isSimulating) {
        isSimulating = false;
        raceId = null;
        hostState.currentTimeSec = 0;
        hostState.currentSplitIndex = 0;
        hostState.currentSplitName = "Start";
        hostState.splitTimes = [];
        hostState.isFinished = false;
        hostState.finalTimeSec = null;
        hostState.score = 0;
        hostState.lastSplitEffect = null;
        entrants.clear();
        entrants.set(hostState.userId, Object.assign({}, hostState));
        notifyListeners("race_disconnected", null);
      }
    }

    /**
     * Ticks simulated competitors along the track synchronized to host elapsed seconds.
     */
    function tickSimulatedCompetitors(hostSec) {
      if (!isSimulating) return;
      const totalSplits = simulationCourseTargets.length;
      const finalCourseTarget = simulationCourseTargets[totalSplits - 1] || (totalSplits * 30);

      entrants.forEach((racer) => {
        if (racer.isHost) return;

        // In a live speedrun race, all competitors share the elapsed race timer
        racer.currentTimeSec = Math.max(0, hostSec || 0);

        const checkTimes = racer.checkpointTimes || simulationCourseTargets;
        const finalTarget = checkTimes[checkTimes.length - 1] || finalCourseTarget;

        // Check if finished
        if (racer.currentTimeSec >= finalTarget) {
          if (!racer.isFinished) {
            racer.isFinished = true;
            racer.finalTimeSec = racer.finalTimeSec || finalTarget;
            racer.currentSplitIndex = totalSplits - 1;
            racer.currentSplitName = (activeSplitsList && activeSplitsList[totalSplits - 1])
              ? activeSplitsList[totalSplits - 1]
              : "Finished";
            racer.score = totalSplits;
            if (!Array.isArray(racer.splitTimes)) racer.splitTimes = [];
            for (let k = 0; k < totalSplits; k++) {
              if (!racer.splitTimes[k]) {
                racer.splitTimes[k] = checkTimes[k] || ((k + 1) * 30);
              }
            }
          }
          return;
        }

        // Determine current split and in-segment progress ratio
        let sIdx = 0;
        let sRatio = 0;
        for (let i = 0; i < totalSplits; i++) {
          const tNext = checkTimes[i] || ((i + 1) * 30);
          const tPrev = i > 0 ? (checkTimes[i - 1] || (i * 30)) : 0;
          if (racer.currentTimeSec < tNext) {
            sIdx = i;
            const dur = Math.max(0.1, tNext - tPrev);
            sRatio = Math.max(0, Math.min(1.0, (racer.currentTimeSec - tPrev) / dur));
            break;
          }
        }

        if (sIdx > racer.currentSplitIndex) {
          if (!Array.isArray(racer.splitTimes)) racer.splitTimes = [];
          for (let k = racer.currentSplitIndex; k < sIdx; k++) {
            racer.splitTimes[k] = checkTimes[k] || ((k + 1) * 30);
          }
          // Completed a split in simulation: determine split glow type
          const lastK = sIdx - 1;
          const actualSeg = (checkTimes[lastK] || ((lastK + 1) * 30)) - (lastK > 0 ? (checkTimes[lastK - 1] || (lastK * 30)) : 0);
          const baseSeg = (simulationCourseTargets[lastK] || ((lastK + 1) * 30)) - (lastK > 0 ? (simulationCourseTargets[lastK - 1] || (lastK * 30)) : 0);

          let flashType = "green";
          if (actualSeg < baseSeg - 0.4) {
            flashType = "gold";
          } else if (actualSeg > baseSeg + 0.4) {
            flashType = "red";
          } else {
            flashType = "green";
          }

          const prevSplitName = racer.currentSplitName
            || (activeSplitsList && activeSplitsList[racer.currentSplitIndex])
            || `Split ${racer.currentSplitIndex + 1}`;
          const nextSplitName = (activeSplitsList && activeSplitsList[sIdx])
            ? activeSplitsList[sIdx]
            : `Split ${sIdx + 1}`;
          racer.lastSplitEffect = {
            type: flashType,
            timestamp: Date.now(),
            completedSplitName: prevSplitName,
            newSplitName: nextSplitName
          };
        } else if (racer.lastSplitEffect && (Date.now() - (racer.lastSplitEffect.timestamp || 0)) > 2200) {
          racer.lastSplitEffect = null;
        }

        racer.currentSplitIndex = sIdx;
        racer.currentSplitName = (activeSplitsList && activeSplitsList[sIdx]) ? activeSplitsList[sIdx] : `Split ${sIdx + 1}`;
        racer.score = sIdx + sRatio;
      });
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

    function reset() {
      lastExternalHostUpdate = 0;
      activeComparisonTimesRT = [];
      hostState.currentTimeSec = 0;
      hostState.currentSplitIndex = 0;
      hostState.currentSplitName = "Start";
      hostState.score = 0;
      hostState.isFinished = false;
      hostState.finalTimeSec = null;
      hostState.splitTimes = [];
      hostState.lastSplitEffect = null;

      entrants.forEach((racer) => {
        if (racer.isHost) {
          Object.assign(racer, hostState);
        } else {
          racer.currentTimeSec = 0;
          racer.currentSplitIndex = 0;
          racer.currentSplitName = activeSplitsList[0] || "Split 1";
          racer.splitTimes = [];
          racer.score = 0;
          racer.isFinished = false;
          racer.finalTimeSec = null;
          racer.lastSplitEffect = null;
        }
      });

      lastKnownRanks.clear();
      notifyListeners("race_reset", null);
      if (typeof window !== "undefined" && window.LiveSplitLeaderboard && typeof window.LiveSplitLeaderboard.reset === "function") {
        window.LiveSplitLeaderboard.reset();
      }
    }

    return {
      init(opts = {}) {
        if (opts.username) {
          setHostUsername(opts.username);
          startAutoDetect(opts.username);
        }
      },
      parseRaceId,
      connectToRace,
      disconnectFromRace,
      startAutoDetect,
      stopAutoDetect,
      setHostUsername,
      getHostUsername,
      startSimulation,
      stopSimulation,
      isSimulating: () => isSimulating,
      isConnected: () => ws !== null && ws.readyState === WebSocket.OPEN,
      getRaceId: () => raceId,
      updateHostProgress,
      getRankedEntrants,
      setEntrantMuted,
      toggleEntrantMuted,
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

})();
