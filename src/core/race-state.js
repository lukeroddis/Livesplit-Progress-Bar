/**
 * src/core/race-state.js - Race Client State, Host Defaults & Runner Resets
 *
 * One mutable state object per race client (connection, host telemetry
 * history, race status, entrants and rank history), the host runner's default
 * fields, and the shared resets applied to runners between runs. The race
 * client's controllers receive this object instead of sharing closure variables.
 */

(function () {
  "use strict";

  const STORAGE_KEYS = window.LiveSplit.Storage.KEYS;

  const HOST_USER_ID = "you";
  const HOST_COLOR = "#38bdf8";

  // Per-run progress cleared on reset (splitTimes is reset to a fresh array separately)
  const RUN_PROGRESS_DEFAULTS = Object.freeze({
    currentTimeSec: 0,
    currentSplitIndex: 0,
    currentSplitName: "Start",
    score: 0,
    isFinished: false,
    finalTimeSec: null,
    isDNF: false,
    dnfTimeSec: null
  });

  // Leaderboard decorations earned during a run (split glow, crowns, ribbons, position deltas)
  const LEADERBOARD_EFFECT_DEFAULTS = Object.freeze({
    lastSplitEffect: null,
    hasCrown: false,
    crownSegmentName: null,
    crownSegmentTime: null,
    segmentRibbon: null,
    ribbonSegmentName: null,
    ribbonSegmentTime: null,
    positionDelta: 0,
    positionDeltaDisplay: "-"
  });

  function createHostState(username) {
    return Object.assign({
      userId: HOST_USER_ID,
      username: username || "You",
      isHost: true,
      avatar: "",
      color: HOST_COLOR,
      splitTimes: [],
      isMuted: false
    }, RUN_PROGRESS_DEFAULTS);
  }

  function resetRunProgress(runner) {
    Object.assign(runner, RUN_PROGRESS_DEFAULTS);
    runner.splitTimes = [];
  }

  function resetLeaderboardEffects(runner) {
    Object.assign(runner, LEADERBOARD_EFFECT_DEFAULTS);
  }

  function loadRacePinsVisible() {
    try {
      if (typeof localStorage !== "undefined") {
        return localStorage.getItem(STORAGE_KEYS.RACE_PINS_VISIBLE) !== "false";
      }
    } catch (_) {}
    return true;
  }

  function createRaceState() {
    return {
      // therun.gg room connection
      raceId: null,
      ws: null,
      heartbeatTimer: null,
      isExternalLiveSplitConnected: false,
      racePinsVisible: loadRacePinsVisible(),

      // Host identity, timing method and course
      hostUsername: "",
      currentTimingMethod: "GameTime",
      activeSplitsList: [],
      activeComparisonTimes: [],
      activeComparisonTimesRT: [],
      simulationCourseTargets: [],
      simulationCourseTargetsRT: [],

      // Last host telemetry received from LiveSplit
      lastExternalHostUpdate: 0,
      lastHostGameTimeSec: 0,
      lastHostRealTimeSec: 0,
      lastHostCompletedSplitsGT: [],
      lastHostCompletedSplitsRT: [],

      // Race status, countdown and event feed
      raceStatus: "open", // "open" | "starting" | "in_progress" | "finished"
      countdownTargetMs: null,
      countdownSeconds: null,
      recentRaceEvents: [],

      // Runners and standings history
      hostState: createHostState(""),
      entrants: new Map(),
      lastKnownRanks: new Map(),
      checkpointRankHistory: new Map(),
      listeners: new Set()
    };
  }

  /**
   * True while connected to (or joining) a real therun.gg room rather than the local simulation.
   */
  function isLiveRoom(raceState) {
    const simId = window.LiveSplit.RaceSimulation.SIM_RACE_ID;
    return Boolean(raceState.ws !== null || (raceState.raceId && raceState.raceId !== simId));
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.RaceState = {
    HOST_USER_ID,
    HOST_COLOR,
    createRaceState,
    createHostState,
    resetRunProgress,
    resetLeaderboardEffects,
    isLiveRoom
  };
})();
