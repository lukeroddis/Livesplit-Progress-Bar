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

  /**
   * Factory to create an isolated Race Client instance.
   */
  function createRaceClient() {
    let raceId = null;
    let ws = null;
    let heartbeatTimer = null;
    let autoDetectUsername = "";
    let isSimulating = false;
    let simulationTimer = null;

    // Entrants map: userId -> Entrant Object
    const entrants = new Map();

    // Event subscribers
    const listeners = new Set();

    // Local host runner state
    let hostState = {
      userId: "you",
      username: "You",
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

    /**
     * Returns all entrants (host + competitors), sorted into F1 standings order.
     */
    function getRankedEntrants() {
      const list = Array.from(entrants.values());
      // Ensure host is in the list
      if (!entrants.has(hostState.userId)) {
        list.push(hostState);
      }

      // Sort criteria:
      // 1. Finished runners ranked first by finalTimeSec ascending (fastest finish wins)
      // 2. Active runners ranked by continuous race score descending (further along split track)
      // 3. Ties broken by currentTimeSec ascending
      list.sort((a, b) => {
        if (a.isFinished && b.isFinished) {
          return (a.finalTimeSec || Infinity) - (b.finalTimeSec || Infinity);
        }
        if (a.isFinished && !b.isFinished) return -1;
        if (!a.isFinished && b.isFinished) return 1;

        const scoreDiff = (b.score || 0) - (a.score || 0);
        if (Math.abs(scoreDiff) > 0.0001) {
          return scoreDiff;
        }
        return (a.currentTimeSec || 0) - (b.currentTimeSec || 0);
      });

      // Calculate leader gap and interval to competitor ahead
      let leaderTime = list.length > 0 ? (list[0].finalTimeSec || list[0].currentTimeSec || 0) : 0;
      let leaderScore = list.length > 0 ? (list[0].score || 0) : 0;

      list.forEach((runner, idx) => {
        runner.rank = idx + 1;

        if (idx === 0) {
          runner.gapToLeaderSec = 0;
          runner.intervalSec = 0;
          runner.gapDisplay = "LEADER";
          runner.intervalDisplay = "--";
        } else {
          const runnerTime = runner.finalTimeSec || runner.currentTimeSec || 0;
          const aheadRunner = list[idx - 1];
          const aheadTime = aheadRunner.finalTimeSec || aheadRunner.currentTimeSec || 0;

          // Estimated gap based on time or score difference
          const gap = Math.max(0, runnerTime - leaderTime);
          const interval = Math.max(0, runnerTime - aheadTime);

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
    function updateHostProgress(currentSec, currentIndex, completedSplitTimes = [], comparisonTimes = []) {
      hostState.currentTimeSec = Math.max(0, currentSec || 0);
      hostState.currentSplitIndex = Math.max(0, currentIndex || 0);
      hostState.splitTimes = completedSplitTimes;

      // Calculate in-segment progress ratio
      let ratio = 0;
      if (currentIndex >= 0 && comparisonTimes && currentIndex < comparisonTimes.length) {
        const curTarget = comparisonTimes[currentIndex];
        const prevTarget = currentIndex > 0 ? (comparisonTimes[currentIndex - 1] || 0) : 0;
        const dur = (curTarget && prevTarget) ? (curTarget - prevTarget) : (curTarget || 30);
        const lastSplitSec = (completedSplitTimes && currentIndex > 0) ? (completedSplitTimes[currentIndex - 1] || 0) : 0;
        const inSeg = Math.max(0, (currentSec || 0) - lastSplitSec);
        ratio = dur > 0 ? Math.max(0, Math.min(1.0, inSeg / dur)) : 0;
      }

      hostState.score = hostState.currentSplitIndex + ratio;

      if (comparisonTimes && currentIndex >= comparisonTimes.length - 1 && ratio >= 1.0) {
        hostState.isFinished = true;
        if (!hostState.finalTimeSec) hostState.finalTimeSec = currentSec;
      }

      entrants.set(hostState.userId, Object.assign({}, hostState));

      // In simulation mode, update simulated competitors synchronously
      if (isSimulating) {
        tickSimulatedCompetitors(currentSec, comparisonTimes);
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
      if (uId === hostState.userId || uId.toLowerCase() === autoDetectUsername.toLowerCase()) {
        return; // Host runner handled locally
      }

      const existing = entrants.get(uId) || {
        userId: uId,
        username: data.user || data.username || uId,
        avatar: data.picture || data.avatar || "",
        color: RACER_PALETTE[entrants.size % RACER_PALETTE.length],
        currentSplitIndex: 0,
        currentSplitName: "",
        currentTimeSec: 0,
        isFinished: false,
        finalTimeSec: null,
        score: 0,
        isMuted: false
      };

      if (typeof data.currentSplitIndex === "number") {
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

      const count = (splitsList && splitsList.length > 0) ? splitsList.length : 8;

      // Create 3 simulated competitors with distinct personalities and paces
      const simConfigs = [
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
        }
      ];

      entrants.clear();
      entrants.set(hostState.userId, Object.assign({}, hostState));

      simConfigs.forEach((cfg) => {
        entrants.set(cfg.id, {
          userId: cfg.id,
          username: cfg.username,
          avatar: cfg.avatar,
          color: cfg.color,
          paceFactor: cfg.paceFactor,
          driftOffset: cfg.driftOffset,
          currentSplitIndex: 0,
          currentSplitName: splitsList[0] || "Split 1",
          currentTimeSec: 0,
          isFinished: false,
          finalTimeSec: null,
          score: 0,
          isMuted: false
        });
      });

      notifyListeners("race_connected", { raceId, isSimulated: true });
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
      if (!isSimulating || !comparisonTimes || comparisonTimes.length === 0) return;

      const totalSplits = comparisonTimes.length;
      const finalTarget = comparisonTimes[totalSplits - 1] || (totalSplits * 30);

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
          racer.finalTimeSec = racer.finalTimeSec || simSec;
          racer.score = totalSplits;
          return;
        }

        // Locate competitor's active split segment based on comparison curves
        let sIdx = 0;
        let sRatio = 0;
        for (let i = 0; i < totalSplits; i++) {
          const tNext = comparisonTimes[i] || ((i + 1) * 30);
          const tPrev = i > 0 ? (comparisonTimes[i - 1] || (i * 30)) : 0;
          if (simSec < tNext) {
            sIdx = i;
            const dur = Math.max(1, tNext - tPrev);
            sRatio = Math.max(0, Math.min(1.0, (simSec - tPrev) / dur));
            break;
          }
        }

        racer.currentSplitIndex = sIdx;
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

    return {
      init(opts = {}) {
        if (opts.username) {
          startAutoDetect(opts.username);
        }
      },
      parseRaceId,
      connectToRace,
      disconnectFromRace,
      startAutoDetect,
      stopAutoDetect,
      startSimulation,
      stopSimulation,
      isSimulating: () => isSimulating,
      isConnected: () => ws !== null && ws.readyState === WebSocket.OPEN,
      getRaceId: () => raceId,
      updateHostProgress,
      getRankedEntrants,
      setEntrantMuted,
      toggleEntrantMuted,
      subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      }
    };
  }

  // Export to namespace
  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.RaceClient = {
    createRaceClient,
    instance: createRaceClient()
  };
  window.createLiveSplitRaceClient = createRaceClient;
  window.LiveSplitRaceClient = window.LiveSplit.RaceClient.instance;

})();
