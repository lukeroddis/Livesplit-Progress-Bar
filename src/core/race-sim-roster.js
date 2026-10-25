/**
 * src/core/race-sim-roster.js - Simulated Race Competitors
 *
 * The nine preset rivals for the local race simulation and a pure builder that
 * turns one preset into a race entrant: per-split checkpoint and PB times for
 * both timing methods, from the course targets, the rival's pace factor and a
 * seeded (deterministic) per-split swing of roughly -12% to +14%.
 */

(function () {
  "use strict";

  // Preset virtual competitors for realistic simulation mode (9 competitors + 1 host = 10 racers total)
  // Balanced around Host as median pace (P5/P6): 4 faster rivals ahead (-0.5% to -5.0%), 5 rivals behind (+0.8% to +6.5%)
  // Over a 3.5h run, this produces the requested +/- 10 min spread; over a 15m run, it scales adaptively to +/- 45-60s.
  const SIMULATED_COMPETITORS = Object.freeze([
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
  ]);

  /**
   * @param {Object} cfg - One SIMULATED_COMPETITORS preset
   * @param {Object} course - { courseTargets, courseTargetsRT, splitsList, isRT, withLobby }
   * @returns {Object} Race entrant
   */
  function buildCompetitorEntrant(cfg, course) {
    const { courseTargets, courseTargetsRT, splitsList, isRT, withLobby = false } = course;
    const checkpointTimesGT = [];
    const pbCheckpointTimesGT = [];
    const checkpointTimesRT = [];
    const pbCheckpointTimesRT = [];
    let cumTimeGT = 0, cumPbGT = 0;
    let cumTimeRT = 0, cumPbRT = 0;

    for (let k = 0; k < courseTargets.length; k++) {
      const prevT_GT = k > 0 ? courseTargets[k - 1] : 0;
      const baseSegGT = Math.max(1, courseTargets[k] - prevT_GT);

      const prevT_RT = k > 0 ? courseTargetsRT[k - 1] : 0;
      const baseSegRT = Math.max(1, courseTargetsRT[k - 1] ? courseTargetsRT[k] - prevT_RT : courseTargetsRT[k]);

      // Expected Personal Best segment duration
      const pbSegGT = Math.max(0.5, baseSegGT * cfg.paceFactor);
      cumPbGT += pbSegGT;
      pbCheckpointTimesGT.push(cumPbGT);

      const pbSegRT = Math.max(0.5, baseSegRT * cfg.paceFactor);
      cumPbRT += pbSegRT;
      pbCheckpointTimesRT.push(cumPbRT);

      // Actual simulated segment duration with seeded variance / swing (-12% to +14%)
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
      currentSplitName: splitsList[0] || "Split 1",
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

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.RaceSimRoster = {
    SIMULATED_COMPETITORS,
    buildCompetitorEntrant
  };
})();
