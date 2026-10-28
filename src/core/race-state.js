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

  /**
   * @typedef {"open"|"starting"|"in_progress"|"finished"} RaceStatus
   */

  /**
   * A runner in the race: the host (createHostState) or an entrant from therun.gg or the
   * simulation. Entrants also carry per-method copies (checkpointTimesGT/RT, splitTimesGT/RT,
   * currentTimeSecGT/RT), PB checkpoints and simulation pacing fields.
   * @typedef {Object} Runner
   * @property {string} userId - "you" for the host
   * @property {string} username
   * @property {string} avatar - Avatar URL ("" when none)
   * @property {string} color - CSS colour for pins and the leaderboard
   * @property {boolean} [isHost]
   * @property {boolean} isMuted - Hidden from the track pins
   * @property {number[]} splitTimes - Cumulative split times recorded so far (seconds)
   * @property {number} currentTimeSec
   * @property {number} currentSplitIndex
   * @property {string} currentSplitName
   * @property {number} score - Race progress: completed splits + fraction of the current segment
   * @property {number} [liveProgressSplit] - Live races: split the per-frame segment progress belongs to
   * @property {number} [liveProgressRatio] - Live races: furthest elapsed / expected ratio reached in that split (max 0.99)
   * @property {boolean} isFinished
   * @property {number|null} finalTimeSec
   * @property {boolean} isDNF
   * @property {number|null} dnfTimeSec
   * @property {string} [status] - Lobby status ("joined", "ready", "started")
   * @property {boolean} [isReady]
   * @property {Object|null} [lastSplitEffect] - Pending leaderboard split glow
   * @property {boolean} [hasCrown] - Fastest on the last segment
   * @property {number} [positionDelta] - Places gained (+) or lost (-) at the last split
   */

  /**
   * A line in the race event feed (lobby banner, WS log).
   * @typedef {Object} RaceEvent
   * @property {string} type - "join" | "leave" | "ready" | "unready" | "countdown" | "starting" | "started" | "gold" | "canceled"
   * @property {string} text
   * @property {number} timestamp - Date.now()
   * @property {string} [user]
   */

  /**
   * Per-client race state (ctx.raceState). Times are seconds.
   * @typedef {Object} RaceState
   * @property {string|null} raceId - therun.gg room id, or RaceSimulation.SIM_RACE_ID
   * @property {WebSocket|null} ws - Room socket (null for the simulation)
   * @property {number|null} heartbeatTimer
   * @property {number|null} reconnectTimer - Pending reopen of a room socket the server closed
   * @property {number} reconnectAttempts - Reopens since the room socket last connected (backoff)
   * @property {boolean} isExternalLiveSplitConnected - The overlay is feeding host progress from LiveSplit
   * @property {boolean} racePinsVisible - Global race pin toggle (persisted)
   * @property {string} hostUsername - therun.gg username used to match the host entrant
   * @property {"GameTime"|"RealTime"} currentTimingMethod
   * @property {string[]} activeSplitsList - Course split names
   * @property {Array<number|null>} activeComparisonTimes - Course targets (cumulative), GameTime
   * @property {Array<number|null>} activeComparisonTimesRT
   * @property {number} lastExternalHostUpdate - Date.now() of the last LiveSplit host update
   * @property {number} lastHostGameTimeSec
   * @property {number} lastHostRealTimeSec
   * @property {number[]} lastHostCompletedSplitsGT
   * @property {number[]} lastHostCompletedSplitsRT
   * @property {RaceStatus} raceStatus
   * @property {number|null} countdownTargetMs - Date.now() target of the start countdown
   * @property {number|null} countdownSeconds - 3, 2, 1, 0 (GO!) or null
   * @property {RaceEvent[]} recentRaceEvents - Last 20 events
   * @property {Runner} hostState
   * @property {Map<string, Runner>} entrants - Other runners by userId
   * @property {Map<string, number>} lastKnownRanks - userId -> rank at the previous standings update
   * @property {Map<number, Map<string, number>>} checkpointRankHistory - split index -> (userId -> rank there)
   * @property {Set<function(string, *): void>} listeners - Race client event subscribers (event, data)
   */

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
    dnfTimeSec: null,
    liveProgressSplit: -1,
    liveProgressRatio: 0
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

  /** @returns {Runner} */
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

  /** @returns {RaceState} */
  function createRaceState() {
    return {
      // therun.gg room connection
      raceId: null,
      ws: null,
      heartbeatTimer: null,
      reconnectTimer: null,
      reconnectAttempts: 0,
      isExternalLiveSplitConnected: false,
      racePinsVisible: loadRacePinsVisible(),

      // Host identity, timing method and course
      hostUsername: "",
      currentTimingMethod: "GameTime",
      activeSplitsList: [],
      activeComparisonTimes: [],
      activeComparisonTimesRT: [],

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
