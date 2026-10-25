/**
 * src/core/race-simulation.js - Local Virtual Speedrun Race Simulation Engine
 * 
 * Manages virtual offline race simulation mechanics:
 * - 9 preset virtual competitors with realistic pacing and drift curves
 * - Progressive lobby joins and ready-up sequences (1-by-1 over 5s/10s)
 * - 3-second pre-race countdown state machine (3, 2, 1, GO!)
 * - Virtual clock progression synchronized to LiveSplit or standalone ticks
 * - Dynamic checkpoint splitting, variance curves, and split pulse effects
 */

(function () {
  "use strict";

  // Room id the local simulation reports while running (never a real therun.gg code)
  const SIM_RACE_ID = "sim_cup_2026";

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
   * Factory creating an isolated simulation engine connected to RaceClient state.
   * 
   * @param {Object} ctx - Adapter context connecting to RaceClient state & event callbacks
   * @returns {Object} Simulation controller API
   */
  function createRaceSimulation(ctx) {
    let isSimulating = false;
    let isSimStandby = false;
    let pendingSimConfig = null;
    let simulationTimer = null;
    let simLobbyTimers = [];
    let simHasLobby = false;
    let simProgressiveLobby = false;
    let simVirtualSec = 0;
    let lastSimTickTimestamp = 0;

    let activeSplitsList = [];
    let activeComparisonTimes = [];
    let activeComparisonTimesRT = [];
    let simulationCourseTargets = [];
    let simulationCourseTargetsRT = [];

    const setCountdownTargetMs = (ms) => {
      if (ctx && typeof ctx.setCountdownTargetMs === "function") ctx.setCountdownTargetMs(ms);
    };
    const setCountdownSeconds = (sec) => {
      if (ctx && typeof ctx.setCountdownSeconds === "function") ctx.setCountdownSeconds(sec);
    };
    const getCountdownSeconds = () => {
      return (ctx && typeof ctx.getCountdownSeconds === "function") ? ctx.getCountdownSeconds() : null;
    };
    const setStatus = (st) => {
      if (ctx && typeof ctx.setStatus === "function") ctx.setStatus(st);
    };
    const getStatus = () => {
      return (ctx && typeof ctx.getStatus === "function") ? ctx.getStatus() : "open";
    };
    const pushRaceEvent = (evt) => {
      if (ctx && typeof ctx.pushRaceEvent === "function") ctx.pushRaceEvent(evt);
    };
    const notifyListeners = (evt, payload) => {
      if (ctx && typeof ctx.notifyListeners === "function") ctx.notifyListeners(evt, payload);
    };
    const getTimingMethod = () => {
      return (ctx && typeof ctx.getTimingMethod === "function") ? ctx.getTimingMethod() : "GameTime";
    };
    const getEntrants = () => {
      return (ctx && typeof ctx.getEntrants === "function") ? ctx.getEntrants() : new Map();
    };
    const getHostState = () => {
      return (ctx && typeof ctx.getHostState === "function") ? ctx.getHostState() : {};
    };
    const getLastHostGameTimeSec = () => {
      return (ctx && typeof ctx.getLastHostGameTimeSec === "function") ? ctx.getLastHostGameTimeSec() : 0;
    };
    const getLastHostRealTimeSec = () => {
      return (ctx && typeof ctx.getLastHostRealTimeSec === "function") ? ctx.getLastHostRealTimeSec() : 0;
    };
    const setRaceId = (id) => {
      if (ctx && typeof ctx.setRaceId === "function") ctx.setRaceId(id);
    };

    function clearSimLobbyTimers() {
      if (Array.isArray(simLobbyTimers)) {
        simLobbyTimers.forEach(t => clearTimeout(t));
        simLobbyTimers.length = 0;
      }
    }

    /**
     * Builds entrant object for a simulated competitor.
     */
    function createSimulatedCompetitorEntrant(cfg, withLobby = false) {
      const isRT = (getTimingMethod() === "RealTime");
      const checkpointTimesGT = [];
      const pbCheckpointTimesGT = [];
      const checkpointTimesRT = [];
      const pbCheckpointTimesRT = [];
      let cumTimeGT = 0, cumPbGT = 0;
      let cumTimeRT = 0, cumPbRT = 0;

      for (let k = 0; k < simulationCourseTargets.length; k++) {
        const prevT_GT = k > 0 ? simulationCourseTargets[k - 1] : 0;
        const baseSegGT = Math.max(1, simulationCourseTargets[k] - prevT_GT);

        const prevT_RT = k > 0 ? simulationCourseTargetsRT[k - 1] : 0;
        const baseSegRT = Math.max(1, simulationCourseTargetsRT[k - 1] ? simulationCourseTargetsRT[k] - prevT_RT : simulationCourseTargetsRT[k]);

        // Expected Personal Best segment duration
        const pbSegGT = Math.max(0.5, baseSegGT * cfg.paceFactor);
        cumPbGT += pbSegGT;
        pbCheckpointTimesGT.push(cumPbGT);

        const pbSegRT = Math.max(0.5, baseSegRT * cfg.paceFactor);
        cumPbRT += pbSegRT;
        pbCheckpointTimesRT.push(cumPbRT);

        // Actual simulated segment duration with variance / swing (-12% to +14%)
        const seed = Math.sin((k + 1) * 12.9898 + (cfg.driftOffset * 78.233)) * 43758.5453;
        const pseudoRand = (seed - Math.floor(seed)) * 2.0 - 1.0;
        const wave = Math.sin((k + 1) * 2.1 + cfg.driftOffset);
        const swingPercent = (wave * 0.08) + (pseudoRand * 0.06);

        const segDurGT = Math.max(0.5, baseSegGT * (cfg.paceFactor + swingPercent));
        cumTimeGT += segDurGT;
        checkpointTimesGT.push(cumTimeGT);

        const segDurRT = Math.max(0.5, baseSegRT * (cfg.paceFactor + swingPercent));
        cumTimeRT += segDurRT;
        checkpointTimesRT.push(cumTimeRT);
      }

      return {
        userId: cfg.id,
        username: cfg.username,
        avatar: cfg.avatar,
        color: cfg.color,
        paceFactor: cfg.paceFactor,
        driftOffset: cfg.driftOffset,
        checkpointTimesGT,
        checkpointTimesRT,
        pbCheckpointTimesGT,
        pbCheckpointTimesRT,
        checkpointTimes: isRT ? checkpointTimesRT : checkpointTimesGT,
        pbCheckpointTimes: isRT ? pbCheckpointTimesRT : pbCheckpointTimesGT,
        currentSplitIndex: 0,
        currentSplitName: activeSplitsList[0] || "Split 1",
        currentTimeSec: 0,
        currentTimeSecGT: 0,
        currentTimeSecRT: 0,
        splitTimes: [],
        splitTimesGT: [],
        splitTimesRT: [],
        isFinished: false,
        finalTimeSec: null,
        isDNF: false,
        dnfTimeSec: null,
        score: 0,
        isMuted: false,
        lastSplitEffect: null,
        pbSec: isRT ? (pbCheckpointTimesRT[pbCheckpointTimesRT.length - 1] || 0) : (pbCheckpointTimesGT[pbCheckpointTimesGT.length - 1] || 0),
        status: withLobby ? "joined" : "started",
        isReady: !withLobby
      };
    }

    /**
     * Schedules the 3-second pre-race countdown and transition to in_progress (GO!).
     */
    function scheduleSimCountdown() {
      const raceStatus = getStatus();
      if (!isSimulating || (raceStatus !== "open" && raceStatus !== "lobby")) return;
      setStatus("starting");
      setCountdownTargetMs(Date.now() + 3000);
      setCountdownSeconds(3);
      pushRaceEvent({
        type: "starting",
        text: "Race countdown: 3s!",
        timestamp: Date.now()
      });
      notifyListeners("race_countdown", { countdown: 3 });

      const t4_2 = setTimeout(() => {
        if (!isSimulating || getStatus() !== "starting") return;
        setCountdownSeconds(2);
        notifyListeners("race_countdown", { countdown: 2 });
      }, 1000);
      simLobbyTimers.push(t4_2);

      const t4_1 = setTimeout(() => {
        if (!isSimulating || getStatus() !== "starting") return;
        setCountdownSeconds(1);
        notifyListeners("race_countdown", { countdown: 1 });
      }, 2000);
      simLobbyTimers.push(t4_1);

      const t4_go = setTimeout(() => {
        if (!isSimulating) return;
        setStatus("in_progress");
        setCountdownSeconds(0);
        setCountdownTargetMs(null);
        const entrants = getEntrants();
        SIMULATED_COMPETITORS.forEach(cfg => {
          if (!entrants.has(cfg.id)) {
            entrants.set(cfg.id, createSimulatedCompetitorEntrant(cfg, false));
          }
        });
        entrants.forEach(e => {
          e.status = "started";
          e.isReady = true;
        });
        pushRaceEvent({
          type: "started",
          text: "Race started! Good luck!",
          timestamp: Date.now()
        });
        notifyListeners("race_started", null);
        const t4_clear = setTimeout(() => {
          if (!isSimulating) return;
          if (getCountdownSeconds() === 0) {
            setCountdownSeconds(null);
            notifyListeners("entrant_updated", null);
          }
        }, 1500);
        simLobbyTimers.push(t4_clear);
      }, 3000);
      simLobbyTimers.push(t4_go);
    }

    /**
     * Starts realistic live race simulation lobby sequence.
     */
    function startSimLobbySequence(isProgressive = true) {
      clearSimLobbyTimers();
      setStatus("open");
      setCountdownTargetMs(null);
      setCountdownSeconds(null);
      if (ctx.recentRaceEvents) ctx.recentRaceEvents.length = 0;

      const hostState = getHostState();
      const entrants = getEntrants();

      if (!isProgressive) {
        pushRaceEvent({
          type: "join",
          user: hostState.username || "You",
          text: `Race lobby opened (${entrants.size} runners)`,
          timestamp: Date.now()
        });

        const t1 = setTimeout(() => {
          const status = getStatus();
          if (!isSimulating || (status !== "open" && status !== "lobby")) return;
          const e1 = entrants.get("sim_speeddemon");
          const e2 = entrants.get("sim_pixelknight");
          if (e1) { e1.status = "ready"; e1.isReady = true; }
          if (e2) { e2.status = "ready"; e2.isReady = true; }
          pushRaceEvent({
            type: "ready",
            user: "SpeedDemon",
            text: "SpeedDemon is Ready",
            timestamp: Date.now()
          });
          notifyListeners("entrant_updated", null);
        }, 500);
        simLobbyTimers.push(t1);

        const t2 = setTimeout(() => {
          const status = getStatus();
          if (!isSimulating || (status !== "open" && status !== "lobby")) return;
          ["sim_turboblaze", "sim_apex", "sim_frostbyte"].forEach(id => {
            const e = entrants.get(id);
            if (e) { e.status = "ready"; e.isReady = true; }
          });
          pushRaceEvent({
            type: "ready",
            user: "TurboBlaze",
            text: "TurboBlaze is Ready",
            timestamp: Date.now()
          });
          notifyListeners("entrant_updated", null);
        }, 1100);
        simLobbyTimers.push(t2);

        const t3 = setTimeout(() => {
          const status = getStatus();
          if (!isSimulating || (status !== "open" && status !== "lobby")) return;
          entrants.forEach(e => {
            e.status = "ready";
            e.isReady = true;
          });
          pushRaceEvent({
            type: "ready",
            user: "ShadowPacer",
            text: "All runners are ready!",
            timestamp: Date.now()
          });
          notifyListeners("entrant_updated", null);
        }, 1700);
        simLobbyTimers.push(t3);

        const t4 = setTimeout(() => {
          scheduleSimCountdown();
        }, 2300);
        simLobbyTimers.push(t4);
        return;
      }

      pushRaceEvent({
        type: "join",
        user: hostState.username || "You",
        text: "Race lobby opened",
        timestamp: Date.now()
      });
      notifyListeners("entrant_updated", null);

      // Join Schedule (9 competitors joining one by one over ~5 seconds)
      const joinDelays = [500, 1000, 1600, 2100, 2700, 3200, 3800, 4400, 5000];
      SIMULATED_COMPETITORS.forEach((cfg, idx) => {
        const delay = joinDelays[idx] || ((idx + 1) * 550);
        const tJoin = setTimeout(() => {
          const status = getStatus();
          if (!isSimulating || (status !== "open" && status !== "lobby")) return;
          if (!entrants.has(cfg.id)) {
            const entrant = createSimulatedCompetitorEntrant(cfg, true);
            entrant.status = "joined";
            entrant.isReady = false;
            entrants.set(cfg.id, entrant);
          }
          pushRaceEvent({
            type: "join",
            user: cfg.username,
            text: `${cfg.username} joined the race`,
            timestamp: Date.now()
          });
          notifyListeners("entrant_updated", null);
        }, delay);
        simLobbyTimers.push(tJoin);
      });

      // Ready-Up Schedule (9 competitors readying up one by one over subsequent ~5 seconds: 5.5s to 10.0s)
      const readyDelays = [5500, 6000, 6600, 7100, 7700, 8200, 8800, 9400, 10000];
      SIMULATED_COMPETITORS.forEach((cfg, idx) => {
        const delay = readyDelays[idx] || (5500 + (idx * 500));
        const isLast = (idx === SIMULATED_COMPETITORS.length - 1);
        const tReady = setTimeout(() => {
          const status = getStatus();
          if (!isSimulating || (status !== "open" && status !== "lobby")) return;
          let entrant = entrants.get(cfg.id);
          if (!entrant) {
            entrant = createSimulatedCompetitorEntrant(cfg, true);
            entrants.set(cfg.id, entrant);
          }
          entrant.status = "ready";
          entrant.isReady = true;
          pushRaceEvent({
            type: "ready",
            user: cfg.username,
            text: isLast ? `All runners are ready! (${entrants.size}/${entrants.size})` : `${cfg.username} is Ready`,
            timestamp: Date.now()
          });
          notifyListeners("entrant_updated", null);
        }, delay);
        simLobbyTimers.push(tReady);
      });

      // Countdown Schedule (starts at 10.5s after all runners are ready)
      const tCountdown = setTimeout(() => {
        scheduleSimCountdown();
      }, 10500);
      simLobbyTimers.push(tCountdown);
    }

    /**
     * Ticks simulated competitors along the track synchronized to host elapsed seconds.
     */
    function tickSimulatedCompetitors(hostSec, dt = 0.05) {
      if (!isSimulating) return;
      if (getStatus() !== "in_progress") return;
      const isRT = (getTimingMethod() === "RealTime");
      const activeTargets = isRT
        ? (simulationCourseTargetsRT.length > 0 ? simulationCourseTargetsRT : simulationCourseTargets)
        : simulationCourseTargets;
      const totalSplits = activeTargets.length;
      const finalCourseTarget = activeTargets[totalSplits - 1] || (totalSplits * 30);
      const entrants = getEntrants();
      const lastHostGameTimeSec = getLastHostGameTimeSec();
      const lastHostRealTimeSec = getLastHostRealTimeSec();

      entrants.forEach((racer) => {
        if (racer.isHost) return;

        // In simulation mode, competitors advance on the active focused timer (GameTime or RealTime)
        if (typeof hostSec === "number" && hostSec >= 0) {
          racer.currentTimeSec = hostSec;
          if (isRT) {
            racer.currentTimeSecRT = hostSec;
            racer.currentTimeSecGT = lastHostGameTimeSec > 0 ? lastHostGameTimeSec : hostSec;
          } else {
            racer.currentTimeSecGT = hostSec;
            racer.currentTimeSecRT = lastHostRealTimeSec > 0 ? lastHostRealTimeSec : hostSec;
          }
        } else {
          const advSec = Math.max(0, (racer.currentTimeSec || 0) + (dt || 0.05));
          racer.currentTimeSec = advSec;
          if (isRT) {
            racer.currentTimeSecRT = advSec;
            racer.currentTimeSecGT = lastHostGameTimeSec > 0 ? lastHostGameTimeSec : advSec;
          } else {
            racer.currentTimeSecGT = advSec;
            racer.currentTimeSecRT = lastHostRealTimeSec > 0 ? lastHostRealTimeSec : advSec;
          }
        }

        const checkTimes = racer.checkpointTimes || (isRT ? racer.checkpointTimesRT : racer.checkpointTimesGT) || activeTargets;
        const pbTimes = racer.pbCheckpointTimes || (isRT ? racer.pbCheckpointTimesRT : racer.pbCheckpointTimesGT) || activeTargets;
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
            if (isRT) racer.splitTimesRT = [...racer.splitTimes];
            else racer.splitTimesGT = [...racer.splitTimes];
          }
          return;
        }

        // Determine current split checkpoint based on actual completion times
        let sIdx = 0;
        for (let i = 0; i < totalSplits; i++) {
          if (racer.currentTimeSec < checkTimes[i]) {
            sIdx = i;
            break;
          }
          sIdx = i + 1;
        }
        sIdx = Math.min(sIdx, totalSplits - 1);

        if (sIdx > racer.currentSplitIndex) {
          if (!Array.isArray(racer.splitTimes)) racer.splitTimes = [];
          for (let k = racer.currentSplitIndex; k < sIdx; k++) {
            racer.splitTimes[k] = checkTimes[k] || ((k + 1) * 30);
          }
          if (isRT) racer.splitTimesRT = [...racer.splitTimes];
          else racer.splitTimesGT = [...racer.splitTimes];

          // Completed a split in simulation: determine split glow type by comparing actual vs expected PB segment duration
          const lastK = sIdx - 1;
          const actualSeg = (checkTimes[lastK] || ((lastK + 1) * 30)) - (lastK > 0 ? (checkTimes[lastK - 1] || (lastK * 30)) : 0);
          const pbSeg = (pbTimes[lastK] || ((lastK + 1) * 30)) - (lastK > 0 ? (pbTimes[lastK - 1] || (lastK * 30)) : 0);

          let flashType = "green";
          if (actualSeg < pbSeg - 0.4) {
            flashType = "gold";
          } else if (actualSeg > pbSeg + 0.4) {
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
        } else if (racer.lastSplitEffect && (Date.now() - (racer.lastSplitEffect.timestamp || 0)) > 4200) {
          racer.lastSplitEffect = null;
        }

        racer.currentSplitIndex = sIdx;
        racer.currentSplitName = (activeSplitsList && activeSplitsList[sIdx]) ? activeSplitsList[sIdx] : `Split ${sIdx + 1}`;

        const actualPrevSplitTime = sIdx > 0 ? (checkTimes[sIdx - 1] || 0) : 0;
        const elapsedInSegment = Math.max(0, racer.currentTimeSec - actualPrevSplitTime);

        const pbPrev = sIdx > 0 ? (pbTimes[sIdx - 1] || 0) : 0;
        const pbNext = pbTimes[sIdx] || ((sIdx + 1) * 30);
        const expectedDuration = Math.max(0.5, pbNext - pbPrev);

        const sRatio = Math.max(0, Math.min(1.0, elapsedInSegment / expectedDuration));
        racer.score = sIdx + sRatio;
      });
    }

    function advanceVirtualHost(baseSec) {
      if (getStatus() !== "in_progress") return;
      const hostState = getHostState();
      if (hostState.isDNF) return;
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
      ctx.updateHostProgress(
        simVirtualSec,
        curIdx,
        hostState.splitTimes,
        simulationCourseTargets,
        sName,
        activeSplitsList,
        hostFlash,
        false,
        simVirtualSec,
        activeComparisonTimesRT.length > 0 ? activeComparisonTimesRT : simulationCourseTargets,
        hostState.splitTimes
      );
    }

    function startSimulation(splitsList = [], comparisonTimes = [], comparisonTimesRT = [], opts = {}) {
      if (ctx.clearRunStartLookupTimers) ctx.clearRunStartLookupTimers();
      clearSimLobbyTimers();
      if (ctx.setStandby) ctx.setStandby(false);
      stopSimulation();

      isSimulating = true;
      setRaceId(SIM_RACE_ID);

      const withLobby = !!(opts && opts.withLobby);
      const isProgressive = withLobby && (opts.progressive !== false) && !opts.immediate && !opts.immediateEntrants;
      simHasLobby = withLobby;
      simProgressiveLobby = isProgressive;
      setStatus(withLobby ? "open" : "in_progress");
      setCountdownTargetMs(null);
      setCountdownSeconds(null);
      if (ctx.recentRaceEvents) ctx.recentRaceEvents.length = 0;

      const hostState = getHostState();
      const lastExternalHostUpdate = ctx.getLastExternalHostUpdate ? ctx.getLastExternalHostUpdate() : 0;
      const preserveLiveHost = !withLobby && (lastExternalHostUpdate > 0 && hostState.currentTimeSec > 0);
      if (!preserveLiveHost && ctx.setLastHostTimes) {
        ctx.setLastHostTimes(0, 0);
      }

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
        simulationCourseTargetsRT = [...comparisonTimesRT];
        activeComparisonTimesRT = [...comparisonTimesRT];
      } else {
        simulationCourseTargetsRT = [...simulationCourseTargets];
        activeComparisonTimesRT = [...simulationCourseTargets];
      }

      while (simulationCourseTargets.length < activeSplitsList.length) {
        const lastT = simulationCourseTargets[simulationCourseTargets.length - 1] || 0;
        simulationCourseTargets.push(lastT + 30);
      }
      while (simulationCourseTargetsRT.length < activeSplitsList.length) {
        const lastT = simulationCourseTargetsRT[simulationCourseTargetsRT.length - 1] || 0;
        simulationCourseTargetsRT.push(lastT + 30);
      }

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
        hostState.currentSplitName = activeSplitsList[0] || "Split 1";
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

      const entrants = getEntrants();
      entrants.clear();
      entrants.set(hostState.userId, Object.assign({}, hostState));
      if (ctx.lastKnownRanks) ctx.lastKnownRanks.clear();
      if (ctx.checkpointRankHistory) ctx.checkpointRankHistory.clear();

      const isRT = (getTimingMethod() === "RealTime");

      if (!withLobby || !isProgressive) {
        SIMULATED_COMPETITORS.forEach((cfg) => {
          entrants.set(cfg.id, createSimulatedCompetitorEntrant(cfg, withLobby));
        });
      }

      if (preserveLiveHost) {
        const lastHostRealTimeSec = getLastHostRealTimeSec();
        const lastHostGameTimeSec = getLastHostGameTimeSec();
        const activeHostSec = isRT ? (lastHostRealTimeSec || hostState.currentTimeSec) : (lastHostGameTimeSec || hostState.currentTimeSec);
        tickSimulatedCompetitors(activeHostSec, 0);
      }

      notifyListeners("race_connected", { raceId: SIM_RACE_ID, isSimulated: true });

      if (withLobby) {
        startSimLobbySequence(isProgressive);
      }

      simVirtualSec = hostState.currentTimeSec || 0;

      lastSimTickTimestamp = Date.now();
      simulationTimer = setInterval(() => {
        if (!isSimulating) return;

        const now = Date.now();
        const dt = Math.min(0.2, Math.max(0.01, (now - (lastSimTickTimestamp || now)) / 1000));
        lastSimTickTimestamp = now;

        if (getStatus() !== "in_progress") {
          notifyListeners("entrant_updated", null);
          return;
        }

        const isExtConnected = ctx.isExternalHostConnected ? ctx.isExternalHostConnected() : false;
        const lastHostRealTimeSec = getLastHostRealTimeSec ? getLastHostRealTimeSec() : 0;
        const lastHostGameTimeSec = getLastHostGameTimeSec ? getLastHostGameTimeSec() : 0;

        if (hostState.isDNF) {
          // Host has forfeited / DNF'd: competitors continue running to finish line
          simVirtualSec += dt;
          tickSimulatedCompetitors(simVirtualSec, dt);
        } else if (isExtConnected) {
          if (hostState.currentTimeSec > 0) {
            const isRTActive = (getTimingMethod() === "RealTime");
            const activeHostSec = isRTActive ? (lastHostRealTimeSec || hostState.currentTimeSec) : (lastHostGameTimeSec || hostState.currentTimeSec);
            tickSimulatedCompetitors(activeHostSec, dt);
          } else if (lastHostRealTimeSec > 0) {
            const isRTActive = (getTimingMethod() === "RealTime");
            const activeHostSec = isRTActive ? lastHostRealTimeSec : (lastHostGameTimeSec || lastHostRealTimeSec);
            tickSimulatedCompetitors(activeHostSec, dt);
          } else {
            simVirtualSec = 0;
            if (ctx.checkpointRankHistory) ctx.checkpointRankHistory.clear();
            entrants.forEach((racer) => {
              if (racer.isHost) return;
              racer.currentTimeSecGT = 0;
              racer.currentTimeSecRT = 0;
              racer.currentTimeSec = 0;
              racer.currentSplitIndex = 0;
              racer.currentSplitName = (activeSplitsList && activeSplitsList[0]) ? activeSplitsList[0] : "Split 1";
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
      simHasLobby = false;
      simProgressiveLobby = false;
      if (ctx.clearRunStartLookupTimers) ctx.clearRunStartLookupTimers();
      clearSimLobbyTimers();
      if (ctx.setStandby) ctx.setStandby(false);
      if (simulationTimer) {
        clearInterval(simulationTimer);
        simulationTimer = null;
      }
      simVirtualSec = 0;
      if (isSimulating) {
        isSimulating = false;
        setRaceId(null);
        setStatus("open");
        setCountdownTargetMs(null);
        setCountdownSeconds(null);
        if (ctx.recentRaceEvents) ctx.recentRaceEvents.length = 0;

        const hostState = getHostState();
        hostState.currentTimeSec = 0;
        hostState.currentSplitIndex = 0;
        hostState.currentSplitName = "Start";
        hostState.splitTimes = [];
        hostState.isFinished = false;
        hostState.finalTimeSec = null;
        hostState.score = 0;
        hostState.lastSplitEffect = null;

        const entrants = getEntrants();
        entrants.clear();
        entrants.set(hostState.userId, Object.assign({}, hostState));
        if (ctx.lastKnownRanks) ctx.lastKnownRanks.clear();
        if (ctx.checkpointRankHistory) ctx.checkpointRankHistory.clear();
        notifyListeners("race_disconnected", null);
      }
    }

    function armSimulationStandby(splitsList = [], comparisonTimes = [], comparisonTimesRT = []) {
      if (ctx.clearRunStartLookupTimers) ctx.clearRunStartLookupTimers();
      if (isSimulating) {
        stopSimulation();
      }
      pendingSimConfig = {
        splitsList: Array.isArray(splitsList) ? [...splitsList] : [],
        comparisonTimes: Array.isArray(comparisonTimes) ? [...comparisonTimes] : [],
        comparisonTimesRT: Array.isArray(comparisonTimesRT) ? [...comparisonTimesRT] : []
      };
      isSimStandby = true;
      if (ctx.setStandby) ctx.setStandby(true);
      notifyListeners("race_standby_changed", { isStandby: true, isSimStandby: true });
      return { status: "sim_standby", isStandby: true, isSimStandby: true };
    }

    function handleHostRunStarted(opts = {}) {
      if (!isSimulating) return false;
      if (getStatus() !== "in_progress") {
        clearSimLobbyTimers();
        setStatus("in_progress");
        setCountdownSeconds(0);
        setCountdownTargetMs(null);
        const entrants = getEntrants();
        SIMULATED_COMPETITORS.forEach(cfg => {
          if (!entrants.has(cfg.id)) {
            entrants.set(cfg.id, createSimulatedCompetitorEntrant(cfg, false));
          }
        });
        entrants.forEach(e => {
          e.status = "started";
          e.isReady = true;
        });
        pushRaceEvent({
          type: "started",
          text: "Race started! Good luck!",
          timestamp: Date.now()
        });
        notifyListeners("race_started", null);
      }
      return true;
    }

    function handleUndoSplit(targetIdx) {
      if (!isSimulating) return;
      if (targetIdx < simulationCourseTargets.length) {
        const prevTarget = targetIdx > 0 ? (simulationCourseTargets[targetIdx - 1] || 0) : 0;
        if (simVirtualSec > (simulationCourseTargets[targetIdx] || prevTarget + 30)) {
          simVirtualSec = prevTarget;
        }
      }
    }

    function onTimingMethodChanged(isRT) {
      if (!isSimulating) return;
      const entrants = getEntrants();
      entrants.forEach((racer) => {
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

    function resetSimulation() {
      if (!isSimulating) return;
      simHasLobby = true;
      clearSimLobbyTimers();
      setStatus("open");
      setCountdownTargetMs(null);
      setCountdownSeconds(null);
      const hostState = getHostState();
      hostState.status = "ready";
      hostState.isReady = true;
      const entrants = getEntrants();

      if (simProgressiveLobby) {
        entrants.clear();
        entrants.set(hostState.userId, Object.assign({}, hostState));
        startSimLobbySequence(true);
      } else {
        entrants.forEach((racer) => {
          if (!racer.isHost) {
            racer.status = "joined";
            racer.isReady = false;
          }
        });
        startSimLobbySequence(false);
      }
    }

    return {
      SIMULATED_COMPETITORS,
      startSimulation,
      stopSimulation,
      isSimulating: () => isSimulating,
      armSimulationStandby,
      isSimStandby: () => isSimStandby,
      getPendingSimConfig: () => pendingSimConfig,
      clearStandby: () => {
        isSimStandby = false;
        pendingSimConfig = null;
      },
      tickSimulatedCompetitors,
      handleHostRunStarted,
      handleUndoSplit,
      onTimingMethodChanged,
      resetSimulation,
      getSimVirtualSec: () => simVirtualSec,
      setSimVirtualSec: (sec) => { simVirtualSec = sec; },
      getCourseTargets: () => simulationCourseTargets.slice(),
      getCourseTargetsRT: () => simulationCourseTargetsRT.slice()
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
