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
  const SIMULATED_COMPETITORS = [
    {
      id: "sim_speeddemon",
      username: "SpeedDemon",
      avatar: "⚡",
      color: "#06b6d4",
      paceFactor: 0.96, // Fast, aggressive pace
      driftOffset: -1.8
    },
    {
      id: "sim_apex",
      username: "ApexRunner",
      avatar: "🏎️",
      color: "#f59e0b",
      paceFactor: 1.00, // Neck-and-neck rival (frequent overtakes)
      driftOffset: 0.2
    },
    {
      id: "sim_shadow",
      username: "ShadowPacer",
      avatar: "👤",
      color: "#a855f7",
      paceFactor: 1.04, // Conservative steady runner
      driftOffset: 2.5
    },
    {
      id: "sim_turboblaze",
      username: "TurboBlaze",
      avatar: "🔥",
      color: "#ef4444",
      paceFactor: 0.98, // Fast starter
      driftOffset: -0.9
    },
    {
      id: "sim_echoglide",
      username: "EchoGlide",
      avatar: "🌀",
      color: "#3b82f6",
      paceFactor: 1.02, // Consistent pacer
      driftOffset: 1.4
    },
    {
      id: "sim_pixelknight",
      username: "PixelKnight",
      avatar: "🛡️",
      color: "#10b981",
      paceFactor: 0.99, // Tactical contender
      driftOffset: -0.4
    },
    {
      id: "sim_novashift",
      username: "NovaShift",
      avatar: "✨",
      color: "#ec4899",
      paceFactor: 1.05, // Late-run charger
      driftOffset: 3.1
    },
    {
      id: "sim_frostbyte",
      username: "FrostByte",
      avatar: "❄️",
      color: "#38bdf8",
      paceFactor: 1.01, // Tight pack runner
      driftOffset: 0.8
    },
    {
      id: "sim_vipersprint",
      username: "ViperSprint",
      avatar: "🐍",
      color: "#84cc16",
      paceFactor: 1.03, // Dynamic overtaker
      driftOffset: -2.3
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
    const lastKnownRanks = new Map();
    let lastExternalHostUpdate = 0;

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
      const comp = (activeComparisonTimes && activeComparisonTimes.length > 0)
        ? activeComparisonTimes
        : [30, 60, 90, 120, 150, 180, 210, 240];
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
      list.forEach((r) => {
        const prevRank = lastKnownRanks.get(r.userId);
        const incumbency = (prevRank !== undefined) ? ((10 - prevRank) * 0.012) : 0;
        r._effectiveScore = (r.score || 0) + incumbency;
      });

      list.sort((a, b) => {
        if (a.isFinished && b.isFinished) {
          return (a.finalTimeSec || Infinity) - (b.finalTimeSec || Infinity);
        }
        if (a.isFinished && !b.isFinished) return -1;
        if (!a.isFinished && b.isFinished) return 1;

        // Checkpoint rule: in speedrun races, any runner on a later split checkpoint is definitively ahead!
        const splitIdxA = a.currentSplitIndex || 0;
        const splitIdxB = b.currentSplitIndex || 0;
        if (splitIdxB !== splitIdxA) {
          return splitIdxB - splitIdxA;
        }

        const scoreA = a._effectiveScore !== undefined ? a._effectiveScore : (a.score || 0);
        const scoreB = b._effectiveScore !== undefined ? b._effectiveScore : (b.score || 0);
        const diff = scoreB - scoreA;
        if (Math.abs(diff) > 0.0001) {
          return diff;
        }

        const timeDiff = (a.currentTimeSec || 0) - (b.currentTimeSec || 0);
        if (Math.abs(timeDiff) > 0.001) {
          return timeDiff;
        }

        return String(a.userId || "").localeCompare(String(b.userId || ""));
      });

      list.forEach((r, idx) => lastKnownRanks.set(r.userId, idx + 1));

      // Calculate leader gap and interval to competitor ahead based on track course reference time
      const comp = (activeComparisonTimes && activeComparisonTimes.length > 0)
        ? activeComparisonTimes
        : [30, 60, 90, 120, 150, 180, 210, 240];
      const finalTargetSec = comp[comp.length - 1] || (comp.length * 30);

      const leader = list[0];
      const leaderRefTime = leader ? getCourseRefTime(leader) : 0;

      list.forEach((runner, idx) => {
        runner.rank = idx + 1;

        if (idx === 0) {
          runner.gapToLeaderSec = 0;
          runner.intervalSec = 0;
          runner.gapDisplay = "LEADER";
          runner.intervalDisplay = "--";
        } else {
          const runnerRefTime = getCourseRefTime(runner);
          const aheadRunner = list[idx - 1];
          const aheadRefTime = getCourseRefTime(aheadRunner);

          let gap = 0;
          if (runner.isFinished && leader.isFinished) {
            gap = Math.max(0, runner.finalTimeSec - leader.finalTimeSec);
          } else if (!runner.isFinished && leader.isFinished) {
            gap = Math.max(0, (finalTargetSec - runnerRefTime) + Math.max(0, leader.finalTimeSec - finalTargetSec));
          } else {
            gap = Math.max(0, leaderRefTime - runnerRefTime);
          }

          let interval = 0;
          if (runner.isFinished && aheadRunner.isFinished) {
            interval = Math.max(0, runner.finalTimeSec - aheadRunner.finalTimeSec);
          } else if (!runner.isFinished && aheadRunner.isFinished) {
            interval = Math.max(0, (finalTargetSec - runnerRefTime) + Math.max(0, aheadRunner.finalTimeSec - finalTargetSec));
          } else {
            interval = Math.max(0, aheadRefTime - runnerRefTime);
          }

          runner.gapToLeaderSec = gap;
          runner.intervalSec = interval;

          runner.gapDisplay = `+${formatGapTime(gap)}`;
          runner.intervalDisplay = `+${formatGapTime(interval)}`;
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
    function updateHostProgress(currentSec, currentIndex, completedSplitTimes = [], comparisonTimes = [], currentSplitName = "", splitsList = [], splitFlash = null, isExternal = true) {
      if (isExternal) {
        lastExternalHostUpdate = Date.now();
      }
      if (Array.isArray(splitsList) && splitsList.length > 0) {
        activeSplitsList = splitsList;
      }
      if (Array.isArray(comparisonTimes) && comparisonTimes.length > 0) {
        activeComparisonTimes = comparisonTimes;
      }
      hostState.currentTimeSec = Math.max(0, currentSec || 0);
      hostState.currentSplitIndex = Math.max(0, currentIndex || 0);
      hostState.splitTimes = completedSplitTimes;

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

      // In simulation mode, update simulated competitors synchronously
      if (isSimulating) {
        tickSimulatedCompetitors(currentSec, comparisonTimes);
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
    function startSimulation(splitsList = [], comparisonTimes = []) {
      stopSimulation();
      isSimulating = true;
      raceId = "sim_cup_2026";

      activeSplitsList = (Array.isArray(splitsList) && splitsList.length > 0)
        ? [...splitsList]
        : ["Split 1", "Split 2", "Split 3", "Split 4", "Split 5", "Split 6", "Split 7", "Finished"];

      if (Array.isArray(comparisonTimes) && comparisonTimes.length > 0) {
        activeComparisonTimes = comparisonTimes;
      }

      const stored = loadStoredUsername();
      if (stored) {
        hostUsername = stored;
      }
      hostState.username = hostUsername || "You";
      hostState.isHost = true;
      hostState.color = "#38bdf8";

      entrants.clear();
      entrants.set(hostState.userId, Object.assign({}, hostState));

      SIMULATED_COMPETITORS.forEach((cfg) => {
        entrants.set(cfg.id, {
          userId: cfg.id,
          username: cfg.username,
          avatar: cfg.avatar,
          color: cfg.color,
          paceFactor: cfg.paceFactor,
          driftOffset: cfg.driftOffset,
          currentSplitIndex: 0,
          currentSplitName: activeSplitsList[0] || "Split 1",
          currentTimeSec: 0,
          isFinished: false,
          finalTimeSec: null,
          score: 0,
          isMuted: false
        });
      });

      notifyListeners("race_connected", { raceId, isSimulated: true });

      let simVirtualSec = hostState.currentTimeSec || 0;

      function advanceVirtualHost(baseSec, compList) {
        simVirtualSec = baseSec + 0.05;
        const curIdx = Math.floor(simVirtualSec / 30);
        let hostFlash = null;
        if (curIdx > hostState.currentSplitIndex && hostState.currentSplitIndex >= 0) {
          const prevSplitName = hostState.currentSplitName
            || (activeSplitsList && activeSplitsList[hostState.currentSplitIndex])
            || `Split ${hostState.currentSplitIndex + 1}`;
          const nextSplitName = (activeSplitsList && activeSplitsList[curIdx])
            ? activeSplitsList[curIdx]
            : (compList && curIdx >= compList.length ? "Finished" : `Split ${curIdx + 1}`);
          hostFlash = {
            type: "gold",
            timestamp: Date.now(),
            completedSplitName: prevSplitName,
            newSplitName: nextSplitName
          };
        }
        const sName = (activeSplitsList && activeSplitsList[curIdx]) ? activeSplitsList[curIdx] : `Split ${curIdx + 1}`;
        updateHostProgress(simVirtualSec, curIdx, [], compList, sName, activeSplitsList, hostFlash, false);
        tickSimulatedCompetitors(simVirtualSec, compList);
      }

      simulationTimer = setInterval(() => {
        if (!isSimulating) return;
        const compList = (comparisonTimes && comparisonTimes.length > 0)
          ? comparisonTimes
          : [30, 60, 90, 120, 150, 180, 210, 240];

        const isExternalHostRunning = hostState.currentTimeSec > 0 && (Date.now() - lastExternalHostUpdate < 1500);

        if (hostState.currentTimeSec > 0) {
          if (isExternalHostRunning && lastExternalHostUpdate > 0) {
            // LiveSplit is actively driving the run: keep competitors synchronized to host run time
            tickSimulatedCompetitors(hostState.currentTimeSec, compList);
          } else {
            advanceVirtualHost(Math.max(simVirtualSec, hostState.currentTimeSec), compList);
          }
        } else {
          advanceVirtualHost(simVirtualSec, compList);
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
        entrants.clear();
        entrants.set(hostState.userId, Object.assign({}, hostState));
        notifyListeners("race_disconnected", null);
      }
    }

    /**
     * Ticks simulated competitors along the track synchronized to host elapsed seconds.
     */
    function tickSimulatedCompetitors(hostSec, comparisonTimes = []) {
      if (!isSimulating) return;
      const effectiveComp = (comparisonTimes && comparisonTimes.length > 0)
        ? comparisonTimes
        : [30, 60, 90, 120, 150, 180, 210, 240];

      const totalSplits = effectiveComp.length;
      const finalTarget = effectiveComp[totalSplits - 1] || (totalSplits * 30);

      entrants.forEach((racer) => {
        if (racer.isHost) return;

        // Dynamic time oscillation to simulate mistakes, recovery, and overtakes
        const wave = Math.sin((hostSec * 0.15) + racer.driftOffset) * 2.2;
        const simSec = Math.max(0, (hostSec * racer.paceFactor) + wave);
        racer.currentTimeSec = simSec;

        // Check if finished
        if (simSec >= finalTarget) {
          racer.isFinished = true;
          racer.currentSplitIndex = totalSplits - 1;
          racer.currentSplitName = (activeSplitsList && activeSplitsList[totalSplits - 1]) ? activeSplitsList[totalSplits - 1] : "Finished";
          racer.finalTimeSec = racer.finalTimeSec || simSec;
          racer.score = totalSplits;
          return;
        }

        // Locate competitor's active split segment based on comparison curves
        let sIdx = 0;
        let sRatio = 0;
        for (let i = 0; i < totalSplits; i++) {
          const tNext = effectiveComp[i] || ((i + 1) * 30);
          const tPrev = i > 0 ? (effectiveComp[i - 1] || (i * 30)) : 0;
          if (simSec < tNext) {
            sIdx = i;
            const dur = Math.max(1, tNext - tPrev);
            sRatio = Math.max(0, Math.min(1.0, (simSec - tPrev) / dur));
            break;
          }
        }

        if (sIdx > racer.currentSplitIndex) {
          // Completed a split in simulation!
          let flashType = "green";
          // High pace / positive wave -> Gold split
          if (wave > 1.2 || (racer.paceFactor >= 1.02 && wave > 0.3)) {
            flashType = "gold";
          } else if (wave < -0.6 || racer.paceFactor < 0.98) {
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
