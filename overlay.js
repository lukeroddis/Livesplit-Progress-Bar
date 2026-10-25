// safeStorage is provided by src/core/storage.js (window.safeStorage).

function getRaceClient() {
  return window.LiveSplit && window.LiveSplit.RaceClient
    ? (window.LiveSplit.RaceClient.instance || window.LiveSplit.RaceClient)
    : window.LiveSplitRaceClient;
}

const APP_VERSION = "v1.0.3";
const WS_URL = "ws://localhost:16834/livesplit";

// Generic fallback splits used if no .lss is loaded
const DEFAULT_SPLITS = [
  "Split 1", "Split 2", "Split 3", "Split 4", "Split 5",
  "Split 6", "Split 7", "Split 8", "Split 9", "Finish"
];
const DEFAULT_TARGETS = [30, 60, 90, 120, 150, 180, 210, 240, 270, 300];
const DEFAULT_BESTS = [30, 30, 30, 30, 30, 30, 30, 30, 30, 30];

// Run & comparison state shared with the extracted controllers (src/core/overlay-state.js)
const state = window.LiveSplit.OverlayState.createOverlayState();

let isPolling = false;

const IN_RUN_STATE_KEY = "livesplit_in_run_state";

function saveInRunState() {
  try {
    const snapshot = {
      currentIndex: state.currentIndex,
      lockedDeltas: state.lockedDeltas,
      completedSplitTimes: state.completedSplitTimes,
      completedSplitTimesRT: state.completedSplitTimesRT,
      completedSplitTimesGT: state.completedSplitTimesGT,
      lastSplitRecordedSec: state.lastSplitRecordedSec,
      previousDeltaSeconds: state.previousDeltaSeconds,
      lastElapsedSec: state.lastElapsedSec,
      splitsCount: state.splitsList.length,
      game: localStorage.getItem("livesplit_game") || "",
      category: localStorage.getItem("livesplit_category") || ""
    };
    localStorage.setItem(IN_RUN_STATE_KEY, JSON.stringify(snapshot));
  } catch (e) {
    console.warn("Failed to persist in-run state to localStorage:", e);
  }
}

function clearInRunState() {
  try {
    state.trackManualScrollOffset = 0;
    localStorage.removeItem(IN_RUN_STATE_KEY);
    const rtaEl = document.getElementById("timer-rta");
    const igtEl = document.getElementById("timer-igt");
    if (rtaEl) rtaEl.innerText = "0.00";
    if (igtEl) igtEl.innerText = "0.00";
  } catch (e) {
    console.warn("Failed to clear in-run state from localStorage:", e);
  }
}

function loadInRunState() {
  try {
    const raw = localStorage.getItem(IN_RUN_STATE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      if (typeof parsed.splitsCount === "number" && state.splitsList.length > 0 && parsed.splitsCount !== state.splitsList.length) {
        clearInRunState();
        return false;
      }
      const curGame = localStorage.getItem("livesplit_game") || "";
      const curCat = localStorage.getItem("livesplit_category") || "";
      if (parsed.game && curGame && parsed.game !== curGame) {
        clearInRunState();
        return false;
      }
      if (parsed.category && curCat && parsed.category !== curCat) {
        clearInRunState();
        return false;
      }
      state.lockedDeltas = parsed.lockedDeltas || {};
      state.completedSplitTimes = parsed.completedSplitTimes || {};
      state.completedSplitTimesRT = parsed.completedSplitTimesRT || {};
      state.completedSplitTimesGT = parsed.completedSplitTimesGT || {};
      state.lastSplitRecordedSec = Number(parsed.lastSplitRecordedSec) || 0;
      state.previousDeltaSeconds = Number(parsed.previousDeltaSeconds) || 0;
      if (typeof parsed.lastElapsedSec === "number") {
        state.lastElapsedSec = parsed.lastElapsedSec;
        if (state.lastElapsedSec > 0) {
          const rtaEl = document.getElementById("timer-rta");
          const igtEl = document.getElementById("timer-igt");
          const disp = formatTimerDisplay(state.lastElapsedSec);
          if (rtaEl) rtaEl.innerText = disp;
          if (igtEl) igtEl.innerText = disp;
        }
      }
      if (typeof parsed.currentIndex === "number") {
        state.currentIndex = parsed.currentIndex;
      }
      return true;
    }
  } catch (e) {
    console.warn("Failed to load in-run state from localStorage:", e);
  }
  return false;
}

// High-frequency render loop optimizations & memory caches
const ALL_DELTA_CLASSES = window.LiveSplit.TrackRenderer.ALL_DELTA_CLASSES;
const ALL_SPLIT_STATE_CLASSES = window.LiveSplit.TrackRenderer.ALL_SPLIT_STATE_CLASSES;

// ============================================================
// 2. HUD TITLE LABELS & TIMER DISPLAY HIERARCHY
// ============================================================
function setGameName(name) {
  const el = document.getElementById("game-name");
  if (el && name) {
    el.innerText = name;
    updatePageTitle();
    if (window.hudLayout && typeof window.hudLayout.autoLoadProfileForGame === "function") {
      window.hudLayout.autoLoadProfileForGame(name);
    }
  }
}

function setCategoryName(cat) {
  const el = document.getElementById("category-name");
  if (el && cat) {
    el.innerText = cat;
    updatePageTitle();
  }
}

function updatePageTitle() {
  const game = document.getElementById("game-name")?.innerText?.trim();
  const cat = document.getElementById("category-name")?.innerText?.trim();
  if (game && game !== "Speedrun Overlay") {
    document.title = (cat && cat !== "Load .lss or connect LiveSplit") ? `${game} - ${cat}` : game;
  } else {
    document.title = "LiveSplit Minimal Overlay";
  }
}

function updateTimingMethodBadge() {
  return window.LiveSplit.TimerDisplay.updateTimingMethodBadge(state.timerDisplayMode, state.currentTimingMethod);
}

function updateTimerDisplayHierarchy() {
  return window.LiveSplit.TimerDisplay.updateTimerDisplayHierarchy(state.timerDisplayMode, state.currentTimingMethod);
}

// ============================================================
// 3. COMPARISONS NORMALIZATION & ACTIVE CURVES ENGINE
// ============================================================
function getShortComparisonName(name) {
  return window.LiveSplit.SplitEngine.getShortComparisonName(name);
}

function normalizeComparisonName(raw) {
  return window.LiveSplit.SplitEngine.normalizeComparisonName(raw, state.comparisonsList);
}

function initDefaultComparisons() {
  state.comparisonsList = ["Personal Best", "Best Segments", "Average Segments", "Worst Segments"];
  state.comparisonsDataGT["Personal Best"] = [...DEFAULT_TARGETS];
  state.comparisonsDataRT["Personal Best"] = [...DEFAULT_TARGETS];

  let sumBest = 0;
  state.comparisonsDataGT["Best Segments"] = DEFAULT_BESTS.map(b => (sumBest += b));
  state.comparisonsDataRT["Best Segments"] = [...state.comparisonsDataGT["Best Segments"]];

  state.comparisonsDataGT["Average Segments"] = DEFAULT_TARGETS.map(t => Math.round(t * 1.08));
  state.comparisonsDataRT["Average Segments"] = [...state.comparisonsDataGT["Average Segments"]];

  state.comparisonsDataGT["Worst Segments"] = DEFAULT_TARGETS.map(t => Math.round(t * 1.25));
  state.comparisonsDataRT["Worst Segments"] = [...state.comparisonsDataGT["Worst Segments"]];
}

function applyActiveTimingMethod(method) {
  if (method && (method === "GameTime" || method === "RealTime")) {
    state.currentTimingMethod = method;
  }
  updateTimingMethodBadge();
  updateTimerDisplayHierarchy();

  const isRT = state.currentTimingMethod === "RealTime";
  const activeTargets = isRT 
    ? (state.comparisonsDataRT[state.currentComparison] || state.comparisonTimesRT)
    : (state.comparisonsDataGT[state.currentComparison] || state.comparisonTimesGT);
  const fallbackTargets = isRT
    ? (state.comparisonsDataGT[state.currentComparison] || state.comparisonTimesGT)
    : (state.comparisonsDataRT[state.currentComparison] || state.comparisonTimesRT);

  state.comparisonTimes = state.splitsList.map((_, i) => {
    return activeTargets[i] ?? fallbackTargets[i] ?? null;
  });

  state.bestSegmentTimes = state.splitsList.map((_, i) => {
    return isRT
      ? (state.bestSegmentTimesRT[i] ?? state.bestSegmentTimesGT[i] ?? null)
      : (state.bestSegmentTimesGT[i] ?? state.bestSegmentTimesRT[i] ?? null);
  });

  for (let i = 0; i < state.splitsList.length; i++) {
    if (!state.lockedDeltas[i]) {
      const timeSpan = document.getElementById(`time-val-${i}`);
      if (timeSpan) {
        const targetVal = formatTargetTime(state.comparisonTimes[i]);
        timeSpan.innerText = targetVal || "-";
      }
    }
  }

  const rc = getRaceClient();
  if (rc && typeof rc.setTimingMethod === "function") {
    rc.setTimingMethod(state.currentTimingMethod);
  }
}

function applyActiveComparison(compName, updateLiveSplit = false, showToast = true) {
  const norm = normalizeComparisonName(compName) || "Personal Best";
  state.currentComparison = norm;
  localStorage.setItem("livesplit_current_comparison", state.currentComparison);

  const isRT = state.currentTimingMethod === "RealTime";
  const activeTargets = isRT 
    ? (state.comparisonsDataRT[state.currentComparison] || state.comparisonTimesRT)
    : (state.comparisonsDataGT[state.currentComparison] || state.comparisonTimesGT);
  const fallbackTargets = isRT
    ? (state.comparisonsDataGT[state.currentComparison] || state.comparisonTimesGT)
    : (state.comparisonsDataRT[state.currentComparison] || state.comparisonTimesRT);

  state.comparisonTimes = state.splitsList.map((_, i) => {
    return activeTargets[i] ?? fallbackTargets[i] ?? null;
  });

  const badge = document.getElementById("comparison-badge");
  if (badge) {
    badge.innerText = `Comp: ${getShortComparisonName(state.currentComparison)}`;
  }

  const selComp = document.getElementById("select-active-comparison");
  if (selComp && selComp.value !== state.currentComparison) {
    selComp.value = state.currentComparison;
  }

  let prevDiff = 0;
  for (let i = 0; i < state.splitsList.length; i++) {
    const splitTimeSec = state.completedSplitTimes[i] ?? state.lockedDeltas[i]?.splitTimeSec;
    if (splitTimeSec !== null && splitTimeSec !== undefined && !isNaN(splitTimeSec) && splitTimeSec > 0) {
      // Completed split: recalculate delta and segment status against newly active comparison
      const targetSec = (i < state.comparisonTimes.length && state.comparisonTimes[i] !== null && state.comparisonTimes[i] > 0)
        ? state.comparisonTimes[i]
        : null;

      if (targetSec !== null) {
        const diff = splitTimeSec - targetSec;
        const deltaChange = diff - prevDiff;
        const gainedTime = deltaChange <= 0.001;
        const isAhead = diff <= 0;
        const isGold = (state.lockedDeltas[i]?.stateClass === "gold");

        let stateClass = "uncoloured";
        if (isGold) {
          stateClass = "gold";
        } else if (isAhead) {
          stateClass = gainedTime ? "ahead-gaining" : "ahead-losing";
        } else {
          stateClass = gainedTime ? "behind-gaining" : "behind-losing";
        }
        prevDiff = diff;

        const displayDelta = { text: formatDeltaSeconds(diff), isAhead, signedSeconds: diff };
        state.lockedDeltas[i] = { deltaInfo: displayDelta, stateClass, splitTimeSec };
        setDeltaDisplay(i, displayDelta, stateClass, splitTimeSec);
      } else {
        const displayDelta = { text: "-", isAhead: false, signedSeconds: 0 };
        const stateClass = "uncoloured";
        state.lockedDeltas[i] = { deltaInfo: displayDelta, stateClass, splitTimeSec };
        setDeltaDisplay(i, displayDelta, stateClass, splitTimeSec);
      }
    } else if (state.lockedDeltas[i]?.stateClass === "uncoloured" && (state.completedSplitTimes[i] === null || state.completedSplitTimes[i] === undefined)) {
      // Skipped split: retain uncoloured placeholder
      const skipDelta = { text: "-", isAhead: false, signedSeconds: 0 };
      setDeltaDisplay(i, skipDelta, "uncoloured", null);
    } else {
      // Upcoming split: update target comparison time
      const timeSpan = document.getElementById(`time-val-${i}`);
      if (timeSpan) {
        const targetVal = formatTargetTime(state.comparisonTimes[i]);
        timeSpan.innerText = targetVal || "-";
        timeSpan.className = "split-time-val target-time";
      }
      const deltaSpan = document.getElementById(`delta-val-${i}`);
      if (deltaSpan) {
        deltaSpan.innerText = "";
        deltaSpan.className = "split-delta-val";
      }
    }
  }

  if (state.currentIndex >= 0 && state.currentIndex < state.splitsList.length) {
    state.previousDeltaSeconds = prevDiff;
  }

  if (state.currentIndex >= 0) {
    saveInRunState();
  }

  if (updateLiveSplit) {
    sendRaw(`setcomparison ${state.currentComparison}`);
  }

  if (showToast) {
    showComparisonToast(state.currentComparison);
  }
}

function showComparisonToast(compName) {
  return window.LiveSplit.ToastManager.showComparisonToast(compName);
}

function cycleComparison(reverse = false) {
  if (state.comparisonsList.length === 0) return;
  const currentIdx = state.comparisonsList.indexOf(state.currentComparison);
  const nextIdx = reverse
    ? (currentIdx - 1 + state.comparisonsList.length) % state.comparisonsList.length
    : (currentIdx + 1) % state.comparisonsList.length;
  const nextComp = state.comparisonsList[nextIdx];
  applyActiveComparison(nextComp, true);
}

// ============================================================
// 4. TIME UTILITIES & LIVE DELTA PARSING
// ============================================================
// Thin aliases onto LiveSplit.Time / DOMUtils / SplitEngine, kept so existing call sites stay short.
function timeStringToSeconds(tStr) {
  return window.LiveSplit.Time.timeStringToSeconds(tStr);
}

function escapeHtml(str) {
  return window.LiveSplit.DOMUtils.escapeHtml(str);
}

function formatTimerDisplay(rawTime) {
  return window.LiveSplit.Time.formatTimerDisplay(rawTime);
}

function formatTargetTime(sec) {
  return window.LiveSplit.Time.formatTargetTime(sec);
}

function formatDeltaSeconds(signedSec) {
  return window.LiveSplit.Time.formatDeltaSeconds(signedSec);
}

function formatDeltaLive(raw) {
  return window.LiveSplit.Time.formatDeltaLive(raw);
}

function sanitizeComparisonTimes(times, fallbackTimes, targetLen = null) {
  return window.LiveSplit.SplitEngine.sanitizeComparisonTimes(times, fallbackTimes, targetLen);
}

// ============================================================
// 5. LSS XML SPLITS PARSER & HISTORICAL CURVES COMPUTATION
// ============================================================
function parseLSS(xmlText, isNewDrop = false) {
  try {
    if (isNewDrop) {
      clearInRunState();
      state.currentIndex = -1;
      state.lockedDeltas = {};
      state.completedSplitTimes = {};
      state.completedSplitTimesRT = {};
      state.lastSplitRecordedSec = 0;
      state.previousDeltaSeconds = 0;
      state.lastElapsedSec = 0;
    }

    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlText, "text/xml");

    const game = xml.querySelector("GameName")?.textContent?.trim();
    const category = xml.querySelector("CategoryName")?.textContent?.trim();
    if (game) {
      setGameName(game);
      localStorage.setItem("livesplit_game", game);
    }
    if (category) {
      setCategoryName(category);
      localStorage.setItem("livesplit_category", category);
    }

    // Pure XML parsing & curve computation is delegated to LiveSplit.SplitEngine
    const parsed = window.LiveSplit.SplitEngine.parseLssXml(xmlText);
    if (parsed) {
      state.splitsList = parsed.splitsList;
      state.comparisonTimesGT = parsed.comparisonTimesGT;
      state.comparisonTimesRT = parsed.comparisonTimesRT;
      state.bestSegmentTimesGT = parsed.bestSegmentTimesGT;
      state.bestSegmentTimesRT = parsed.bestSegmentTimesRT;
      state.comparisonsDataGT = parsed.comparisonsDataGT;
      state.comparisonsDataRT = parsed.comparisonsDataRT;
      state.comparisonsList = parsed.comparisonsList;

      // Auto-detect timing method from the splits file:
      // If splits have GameTime recorded (e.g. PC speedruns with load remover), default to GameTime.
      // If no GameTime at all (e.g. console speedruns), default to RealTime.
      const hasAnyGameTime = state.comparisonTimesGT.some(t => t !== null && t > 0) || 
                             state.bestSegmentTimesGT.some(t => t !== null && t > 0);
      const isManualMethod = (localStorage.getItem("livesplit_timing_method_manual") === "true");
      if (!isManualMethod) {
        state.currentTimingMethod = hasAnyGameTime ? "GameTime" : "RealTime";
        localStorage.setItem("livesplit_timing_method", state.currentTimingMethod);
      } else {
        const savedMethod = localStorage.getItem("livesplit_timing_method");
        if (savedMethod === "RealTime" || savedMethod === "GameTime") {
          state.currentTimingMethod = savedMethod;
        } else {
          state.currentTimingMethod = hasAnyGameTime ? "GameTime" : "RealTime";
        }
      }

      // Cache raw LSS and parsed data
      state.baselineBestSegmentTimesGT = [...state.bestSegmentTimesGT];
      state.baselineBestSegmentTimesRT = [...state.bestSegmentTimesRT];
      localStorage.setItem("livesplit_baseline_golds_gt", JSON.stringify(state.baselineBestSegmentTimesGT));
      localStorage.setItem("livesplit_baseline_golds_rt", JSON.stringify(state.baselineBestSegmentTimesRT));
      localStorage.setItem("livesplit_raw_lss", xmlText);
      localStorage.setItem("livesplit_segments", JSON.stringify(state.splitsList));
      localStorage.setItem("livesplit_targets_gt", JSON.stringify(state.comparisonTimesGT));
      localStorage.setItem("livesplit_targets_rt", JSON.stringify(state.comparisonTimesRT));
      localStorage.setItem("livesplit_golds_gt", JSON.stringify(state.bestSegmentTimesGT));
      localStorage.setItem("livesplit_golds_rt", JSON.stringify(state.bestSegmentTimesRT));
      localStorage.setItem("livesplit_comparisons_list", JSON.stringify(state.comparisonsList));
      localStorage.setItem("livesplit_comparisons_gt", JSON.stringify(state.comparisonsDataGT));
      localStorage.setItem("livesplit_comparisons_rt", JSON.stringify(state.comparisonsDataRT));

      updateGoldBadge();
      applyActiveComparison(state.currentComparison, false, false);
      if (!isNewDrop) {
        loadInRunState();
      }
      renderTrack();
      const dropDesc = document.getElementById("dropzone-desc");
      if (dropDesc) {
        const gName = game || localStorage.getItem("livesplit_game") || "";
        dropDesc.innerText = `Active: ${gName ? gName + " • " : ""}${state.splitsList.length} splits loaded ✓`;
        dropDesc.style.color = "#38bdf8";
      }
      if (window.hudLayout && window.hudLayout.syncTrackModalUI) {
        window.hudLayout.syncTrackModalUI();
      }
    }
  } catch (e) {
    console.error("Failed to parse .lss XML", e);
  }
}

// ============================================================
// 6. STORAGE CACHE LOADER & TIMING METHOD CONTROLLER
// ============================================================
function updateGoldBadge() {
  const badge = document.getElementById("gold-toggle-badge");
  if (badge) {
    const isEnabled = state.cachedEnableGolds;
    badge.innerText = isEnabled ? "Golds: ON" : "Golds: OFF";
    badge.style.color = isEnabled ? "#facc15" : "rgba(148, 163, 184, 0.7)";
  }
}

function toggleGoldSegments() {
  const current = (localStorage.getItem("livesplit_enable_golds") !== "false");
  const nextVal = (!current) ? "true" : "false";
  localStorage.setItem("livesplit_enable_golds", nextVal);
  state.cachedEnableGolds = (nextVal !== "false");
  updateGoldBadge();
}

function setTimerDisplayMode(mode, focusMethod) {
  if (mode !== "gametime" && mode !== "realtime" && mode !== "both") {
    mode = "both";
  }
  state.timerDisplayMode = mode;
  localStorage.setItem("livesplit_timer_display_mode", mode);
  localStorage.setItem("livesplit_timing_method_manual", "true");

  if (focusMethod === "GameTime" || focusMethod === "RealTime") {
    state.currentTimingMethod = focusMethod;
    localStorage.setItem("livesplit_timing_method", focusMethod);
  } else if (mode === "gametime") {
    state.currentTimingMethod = "GameTime";
    localStorage.setItem("livesplit_timing_method", "GameTime");
  } else if (mode === "realtime") {
    state.currentTimingMethod = "RealTime";
    localStorage.setItem("livesplit_timing_method", "RealTime");
  } else {
    // mode === "both" without explicit focus: preserve active or saved method
    const savedMethod = localStorage.getItem("livesplit_timing_method");
    if (savedMethod === "GameTime" || savedMethod === "RealTime") {
      state.currentTimingMethod = savedMethod;
    }
  }

  applyActiveTimingMethod(state.currentTimingMethod);
  updateTimerDisplayHierarchy();
  updateTimingMethodBadge();

  // Sync modal segmented controls if open
  window.LiveSplit.TimerDisplay.syncModalControls(mode, state.currentTimingMethod);

  if (state.currentTimingMethod === "GameTime") sendRaw("switchto gametime");
  else if (state.currentTimingMethod === "RealTime") sendRaw("switchto realtime");
}

function setTimingMethodFocus(method) {
  if (method !== "GameTime" && method !== "RealTime") return;
  localStorage.setItem("livesplit_timing_method_manual", "true");
  localStorage.setItem("livesplit_timing_method", method);
  state.currentTimingMethod = method;

  // If a single timer is active and user chooses opposite method, expand to both
  if (state.timerDisplayMode === "gametime" && method === "RealTime") {
    state.timerDisplayMode = "both";
    localStorage.setItem("livesplit_timer_display_mode", "both");
  } else if (state.timerDisplayMode === "realtime" && method === "GameTime") {
    state.timerDisplayMode = "both";
    localStorage.setItem("livesplit_timer_display_mode", "both");
  }

  applyActiveTimingMethod(state.currentTimingMethod);
  updateTimerDisplayHierarchy();
  updateTimingMethodBadge();

  // Sync modal controls
  window.LiveSplit.TimerDisplay.syncModalControls(state.timerDisplayMode, state.currentTimingMethod);

  if (method === "GameTime") sendRaw("switchto gametime");
  else if (method === "RealTime") sendRaw("switchto realtime");
}

function toggleTimingMethod() {
  // Cycles Game -> Real -> Both (Game) -> Both (Real)
  const next = window.LiveSplit.TimerDisplay.calculateNextTimingMode(state.timerDisplayMode, state.currentTimingMethod);
  setTimerDisplayMode(next.mode, next.focusMethod);
}

function loadCachedSplits() {
  state.cachedEnableGolds = (localStorage.getItem("livesplit_enable_golds") !== "false");
  const savedTimerMode = localStorage.getItem("livesplit_timer_display_mode");
  const params = new URLSearchParams(window.location.search);
  const urlTimer = params.get("timer") || params.get("time");
  if (urlTimer && ["gametime", "realtime", "both"].includes(urlTimer.toLowerCase())) {
    state.timerDisplayMode = urlTimer.toLowerCase();
  } else if (savedTimerMode && ["gametime", "realtime", "both"].includes(savedTimerMode)) {
    state.timerDisplayMode = savedTimerMode;
  }

  const isManualMethod = (localStorage.getItem("livesplit_timing_method_manual") === "true");
  const savedMethod = localStorage.getItem("livesplit_timing_method");
  if (isManualMethod && (savedMethod === "RealTime" || savedMethod === "GameTime")) {
    state.currentTimingMethod = savedMethod;
  } else if (state.timerDisplayMode === "gametime") {
    state.currentTimingMethod = "GameTime";
  } else if (state.timerDisplayMode === "realtime") {
    state.currentTimingMethod = "RealTime";
  }

  const savedComp = localStorage.getItem("livesplit_current_comparison");
  if (savedComp) {
    state.currentComparison = savedComp;
  }

  const savedGame = localStorage.getItem("livesplit_game");
  const savedCategory = localStorage.getItem("livesplit_category");
  if (savedGame) setGameName(savedGame);
  if (savedCategory) setCategoryName(savedCategory);

  const rawLss = localStorage.getItem("livesplit_raw_lss");
  if (rawLss) {
    parseLSS(rawLss);
    return;
  }

  const cachedSegments = localStorage.getItem("livesplit_segments");
  if (cachedSegments) {
    try {
      state.splitsList = JSON.parse(cachedSegments);
      state.comparisonTimesGT = JSON.parse(localStorage.getItem("livesplit_targets_gt") || "[]");
      state.comparisonTimesRT = JSON.parse(localStorage.getItem("livesplit_targets_rt") || "[]");
      state.bestSegmentTimesGT = JSON.parse(localStorage.getItem("livesplit_golds_gt") || "[]");
      state.bestSegmentTimesRT = JSON.parse(localStorage.getItem("livesplit_golds_rt") || "[]");
      
      const cachedBaseGT = localStorage.getItem("livesplit_baseline_golds_gt");
      const cachedBaseRT = localStorage.getItem("livesplit_baseline_golds_rt");
      if (cachedBaseGT && cachedBaseRT) {
        state.baselineBestSegmentTimesGT = JSON.parse(cachedBaseGT);
        state.baselineBestSegmentTimesRT = JSON.parse(cachedBaseRT);
      } else {
        state.baselineBestSegmentTimesGT = [...state.bestSegmentTimesGT];
        state.baselineBestSegmentTimesRT = [...state.bestSegmentTimesRT];
      }

      const cachedCompsList = localStorage.getItem("livesplit_comparisons_list");
      if (cachedCompsList) state.comparisonsList = JSON.parse(cachedCompsList);
      const cachedCompsGT = localStorage.getItem("livesplit_comparisons_gt");
      if (cachedCompsGT) state.comparisonsDataGT = JSON.parse(cachedCompsGT);
      const cachedCompsRT = localStorage.getItem("livesplit_comparisons_rt");
      if (cachedCompsRT) state.comparisonsDataRT = JSON.parse(cachedCompsRT);

      if (!state.comparisonsDataGT["Personal Best"]) state.comparisonsDataGT["Personal Best"] = [...state.comparisonTimesGT];
      if (!state.comparisonsDataRT["Personal Best"]) state.comparisonsDataRT["Personal Best"] = [...state.comparisonTimesRT];

      // Cross-fill and sanitize custom comparisons
      const allCachedCustom = new Set([...Object.keys(state.comparisonsDataGT), ...Object.keys(state.comparisonsDataRT)]);
      allCachedCustom.forEach(cName => {
        const cGT = state.comparisonsDataGT[cName];
        const cRT = state.comparisonsDataRT[cName];
        const hasGT = cGT && cGT.some(t => t !== null && t > 0);
        const hasRT = cRT && cRT.some(t => t !== null && t > 0);
        if (hasGT && !hasRT) state.comparisonsDataRT[cName] = sanitizeComparisonTimes(cGT, state.comparisonTimesRT);
        if (hasRT && !hasGT) state.comparisonsDataGT[cName] = sanitizeComparisonTimes(cRT, state.comparisonTimesGT);
      });

      const hasAnyGameTime = state.comparisonTimesGT.some(t => t !== null && t > 0) || 
                             state.bestSegmentTimesGT.some(t => t !== null && t > 0);
      const isManualMethod = (localStorage.getItem("livesplit_timing_method_manual") === "true");
      if (!isManualMethod) {
        state.currentTimingMethod = hasAnyGameTime ? "GameTime" : "RealTime";
        localStorage.setItem("livesplit_timing_method", state.currentTimingMethod);
      }
      applyActiveTimingMethod(state.currentTimingMethod);

      updateGoldBadge();
      applyActiveComparison(state.currentComparison, false, false);
      loadInRunState();
      renderTrack();
      const dropDesc = document.getElementById("dropzone-desc");
      if (dropDesc && state.splitsList.length > 0) {
        const gName = localStorage.getItem("livesplit_game") || "";
        dropDesc.innerText = `Active: ${gName ? gName + " • " : ""}${state.splitsList.length} splits loaded ✓`;
        dropDesc.style.color = "#38bdf8";
      }
      if (window.hudLayout && window.hudLayout.syncTrackModalUI) {
        window.hudLayout.syncTrackModalUI();
      }
      return;
    } catch (e) {
      console.warn("Failed loading cached split JSON, falling back to defaults", e);
    }
  }

  // Fallback generic splits template
  state.splitsList = [...DEFAULT_SPLITS];
  state.comparisonTimesGT = [...DEFAULT_TARGETS];
  state.comparisonTimesRT = [...DEFAULT_TARGETS];
  state.bestSegmentTimesGT = [...DEFAULT_BESTS];
  state.bestSegmentTimesRT = [...DEFAULT_BESTS];
  state.baselineBestSegmentTimesGT = [...DEFAULT_BESTS];
  state.baselineBestSegmentTimesRT = [...DEFAULT_BESTS];
  initDefaultComparisons();

  updateGoldBadge();
  applyActiveComparison(state.currentComparison, false, false);
  loadInRunState();
  renderTrack();
  if (window.hudLayout && window.hudLayout.syncTrackModalUI) {
    window.hudLayout.syncTrackModalUI();
  }
}

// ============================================================
// 7. LIVESPLIT SERVER CLIENT & SEQUENTIAL COMMAND QUEUE
// ============================================================
// Connection lifecycle and the sequential command queue live in src/core/livesplit-connection.js
const connection = window.LiveSplit.LiveSplitConnection.createLiveSplitConnection({
  url: WS_URL,
  onOpen: async () => {
    state.canQueryComparison = true;
    const rcConn = getRaceClient();
    if (rcConn && typeof rcConn.setExternalHostConnected === "function") {
      rcConn.setExternalHostConnected(true);
    }

    // Query Game and Category from LiveSplit if not loaded from .lss
    if (!localStorage.getItem("livesplit_raw_lss")) {
      await syncLiveSplitMetadata();
    }

    if (!isPolling) {
      isPolling = true;
      pollLoop();
    }
  },
  onClose: () => {
    isPolling = false;
    const rcDisconn = getRaceClient();
    if (rcDisconn && typeof rcDisconn.setExternalHostConnected === "function") {
      rcDisconn.setExternalHostConnected(false);
    }
  }
});

function sendCommand(cmd, timeoutMs = 400, isProbe = false) {
  return connection.sendCommand(cmd, timeoutMs, isProbe);
}

// Fire-and-forget command (LiveSplit sends no reply), skipped while disconnected
function sendRaw(cmd) {
  connection.sendRaw(cmd);
}

async function syncLiveSplitMetadata() {
  const game = await sendCommand("getgamename");
  const cat = await sendCommand("getcategoryname");
  if (game && game.trim() && game !== "-") {
    setGameName(game.trim());
    localStorage.setItem("livesplit_game", game.trim());
  }
  if (cat && cat.trim() && cat !== "-") {
    setCategoryName(cat.trim());
    localStorage.setItem("livesplit_category", cat.trim());
  }
}

// ============================================================
// 8. PROGRESS BAR TRACK RENDERER & STATUS DISPATCHER
//    (DOM building, windowing and scrolling live in src/ui/track-renderer.js)
// ============================================================
const getVisibleSplitsCapacity = window.LiveSplit.TrackRenderer.getVisibleSplitsCapacity;

function renderTrack() {
  if (liveElementCache) liveElementCache.invalidate();
  ghostRunner.clearTextThresholdCache();
  const track = document.getElementById("track");
  const targetLabels = state.splitsList.map((_, i) => formatTargetTime(state.comparisonTimes[i]));
  window.LiveSplit.TrackRenderer.buildTrackDom(track, state.splitsList, targetLabels, state.currentIndex >= 0);
  track.style.setProperty("--ghost-opacity", ghostRunner.getGhostOpacity());

  updateTrackDensityAndAngle();
  updateTrackStatus(state.currentIndex);
}

// Sliding-window mode is on when "Always Show Last Split" is enabled (and not "Fit All")
function isTrackWindowingEnabled() {
  const alwaysShowLast = localStorage.getItem("livesplit_always_show_last_split") !== "false";
  const splitPref = localStorage.getItem("livesplit_visible_splits") || "auto";
  return alwaysShowLast && splitPref !== "all";
}

function isTrackWindowed() {
  const N = state.splitsList.length;
  if (N <= 1 || !isTrackWindowingEnabled()) return false;
  return (N + 1 > getVisibleSplitsCapacity());
}

function shiftTrackWindow(direction) {
  const N = state.splitsList.length;
  if (N <= 1) return false;
  if (!isTrackWindowed()) return false;

  const V = getVisibleSplitsCapacity();
  const { k: currentK, defaultK, maxK } = window.LiveSplit.TrackRenderer.getTrackWindowPosition(state.currentIndex, N, V, state.trackManualScrollOffset);
  const newK = Math.max(0, Math.min(maxK, currentK + direction));

  if (newK !== currentK) {
    state.trackManualScrollOffset = newK - defaultK;
    updateTrackWindow(state.currentIndex);
    if (state.lastElapsedSec > 0) {
      updateGhostRunner(state.lastElapsedSec);
    }
    return true;
  }
  return false;
}

// Applies the sliding window (pinned final split + discontinuity break); returns true when windowed
function updateTrackWindow(idx) {
  const N = state.splitsList.length;
  const enabled = N > 1 && isTrackWindowingEnabled();
  const V = enabled ? getVisibleSplitsCapacity() : N + 1;
  const win = window.LiveSplit.TrackRenderer.calculateTrackWindow(idx, N, V, state.trackManualScrollOffset, enabled);
  window.LiveSplit.TrackRenderer.applyTrackWindow(N, win);
  return win.isWindowed;
}

function clearDeltaSpan(i) {
  const deltaSpan = document.getElementById(`delta-val-${i}`);
  if (deltaSpan) {
    deltaSpan.innerText = "";
    deltaSpan.className = "split-delta-val";
  }
}

function updateTrackStatus(idx) {
  if (idx !== state.currentIndex) {
    state.trackManualScrollOffset = 0;
  }
  state.currentIndex = idx;
  const nodeStart = document.getElementById("node-start");
  if (nodeStart) {
    nodeStart.classList.toggle("active", idx >= 0);
  }

  const isVertical = document.getElementById("track")?.classList.contains("vertical");
  const resetSegmentFill = window.LiveSplit.TrackRenderer.resetSegmentFill;

  for (let i = 0; i < state.splitsList.length; i++) {
    const item = document.getElementById(`item-${i}`);
    const fill = document.getElementById(`fill-${i}`);
    if (!item) continue;

    item.classList.remove("current");

    if (idx < 0) {
      // Before the run: clear all state and show comparison targets
      item.classList.remove(...ALL_SPLIT_STATE_CLASSES);
      if (fill) resetSegmentFill(fill, isVertical);
      clearDeltaSpan(i);
      const timeSpan = document.getElementById(`time-val-${i}`);
      if (timeSpan) {
        const targetVal = formatTargetTime(state.comparisonTimes[i]);
        timeSpan.innerText = targetVal || "-";
        timeSpan.className = "split-time-val target-time";
      }
    } else if (i < idx) {
      item.classList.add("completed");
      if (state.lockedDeltas[i]) {
        const { deltaInfo, stateClass, splitTimeSec } = state.lockedDeltas[i];
        setDeltaDisplay(i, deltaInfo, stateClass, splitTimeSec);
      } else if (fill) {
        fill.style.width = "100%";
        fill.style.height = "100%";
        fill.className = "segment-bar-fill uncoloured";
        item.classList.add("uncoloured");
        if (fill.parentElement) fill.parentElement.classList.remove("overdue");
      }
    } else if (i === idx) {
      item.classList.add("current");
      item.classList.remove("completed");
      if (!state.lockedDeltas[i]) clearDeltaSpan(i);
    } else {
      item.classList.remove("completed");
      if (fill) resetSegmentFill(fill, isVertical);
      clearDeltaSpan(i);
    }
  }

  // Update sliding window & discontinuity after status classes are updated
  const isWindowed = updateTrackWindow(idx);
  window.LiveSplit.TrackRenderer.scrollTrackToIndex(idx, isWindowed, isVertical);
}

// ============================================================
// 9. HIGH-FREQUENCY LIVE PROGRESS & DELTA REVEAL (60 FPS)
// ============================================================
let liveElementCache = null;
function getLiveElements(idx) {
  if (!liveElementCache) {
    liveElementCache = window.LiveSplit.TrackRenderer.createLiveElementCache();
  }
  return liveElementCache.getElements(idx);
}

function updateLiveSegmentProgress(currentSec) {
  if (state.currentIndex < 0 || state.currentIndex >= state.splitsList.length || currentSec === null) return;

  const { fill, deltaSpan, isVertical } = getLiveElements(state.currentIndex);

  const prevTargetSec = (state.currentIndex > 0 && state.comparisonTimes[state.currentIndex - 1] !== null)
    ? state.comparisonTimes[state.currentIndex - 1]
    : 0;

  const currentTargetSec = state.comparisonTimes[state.currentIndex];
  if (!currentTargetSec || currentTargetSec <= prevTargetSec) return;

  const expectedDuration = currentTargetSec - prevTargetSec;
  const elapsedInSegment = Math.max(0, currentSec - state.lastSplitRecordedSec);

  if (expectedDuration <= 0) return;

  // 1. Progress Bar Fill (universal for horizontal and vertical)
  if (fill) {
    const progressRatio = Math.max(0, elapsedInSegment / expectedDuration);
    const pct = Math.min(100, progressRatio * 100);
    if (isVertical) {
      fill.style.width = "100%";
      fill.style.height = `${pct.toFixed(1)}%`;
    } else {
      fill.style.width = `${pct.toFixed(1)}%`;
      fill.style.height = "100%";
    }

    if (progressRatio > 1.0) {
      fill.classList.add("overdue");
      if (fill.parentElement) fill.parentElement.classList.add("overdue");
    } else {
      fill.classList.remove("overdue");
      if (fill.parentElement) fill.parentElement.classList.remove("overdue");
    }
  }

  // 2. Live Delta on Current Split:
  // Displays and updates live once the runner begins losing time to the Best Segment
  if (deltaSpan) {
    const isGoldsEnabled = state.cachedEnableGolds;
    const bestSec = (state.currentIndex < state.bestSegmentTimes.length && state.bestSegmentTimes[state.currentIndex] !== null && state.bestSegmentTimes[state.currentIndex] > 0)
      ? state.bestSegmentTimes[state.currentIndex]
      : null;

    const liveDeltaSec = currentSec - currentTargetSec;
    const deltaChange = liveDeltaSec - state.previousDeltaSeconds;
    const gainedTime = deltaChange <= 0.001;

    // Losing time condition:
    // If Golds are enabled and a Best Segment is recorded, triggers as soon as segment elapsed time exceeds best segment.
    // Otherwise triggers when segment elapsed time exceeds expected PB duration or delta is losing time vs previous split.
    const isLosingTimeToBest = (isGoldsEnabled && bestSec !== null)
      ? (elapsedInSegment > bestSec)
      : (elapsedInSegment > expectedDuration || deltaChange > 0);

    if (isLosingTimeToBest) {
      deltaSpan.innerText = formatDeltaSeconds(liveDeltaSec);
      const targetClass = liveDeltaSec <= 0
        ? (gainedTime ? "delta-ahead-gaining" : "delta-ahead-losing")
        : (gainedTime ? "delta-behind-gaining" : "delta-behind-losing");
      const expectedClass = `split-delta-val ${targetClass}`;
      if (deltaSpan.className !== expectedClass) {
        deltaSpan.className = expectedClass;
      }
    } else {
      // While still on pace to gold (within best segment time), keep delta hidden
      if (deltaSpan.innerText !== "") {
        deltaSpan.innerText = "";
      }
      if (deltaSpan.className !== "split-delta-val") {
        deltaSpan.className = "split-delta-val";
      }
    }
  }
}

// ============================================================
// 10. LIVE GHOST RUNNER ENGINE & MULTI-GHOST MARKERS (src/ui/ghost-runner.js)
// ============================================================
const ghostRunner = window.LiveSplit.GhostRunner.createGhostRunner({
  getSplitsList: () => state.splitsList,
  getComparisonTimes: () => state.comparisonTimes,
  getCurrentIndex: () => state.currentIndex,
  getLastSplitRecordedSec: () => state.lastSplitRecordedSec,
  getLastElapsedSec: () => state.lastElapsedSec,
  getGhostInfo: (ghostId) => getGhostComparisonInfo(ghostId),
  getRaceClient
});

const getNodeTextThreshold = ghostRunner.getNodeTextThreshold;
const getOrCreateGhostMarker = ghostRunner.getOrCreateGhostMarker;
const refreshLeaderboard = ghostRunner.refreshLeaderboard;
const updateGhostRunner = ghostRunner.updateGhostRunner;
const updateGhostBadge = ghostRunner.updateGhostBadge;
const setGhostComparison = ghostRunner.setGhostComparison;
const toggleGhostComparison = ghostRunner.toggleGhostComparison;
const cycleGhostComparison = ghostRunner.cycleGhostComparison;
const setGhostOpacity = ghostRunner.setGhostOpacity;

function getGhostComparisonInfo(targetGhost = null) {
  return window.LiveSplit.GhostMath.getGhostComparisonInfo(
    targetGhost || ghostRunner.getPrimaryGhost(),
    state.currentTimingMethod,
    state.comparisonsDataGT,
    state.comparisonsDataRT,
    state.comparisonTimesGT,
    state.comparisonTimesRT
  );
}

function calculateGhostProgress(currentSec, times) {
  return window.LiveSplit.GhostMath.calculateGhostProgress(currentSec, times);
}

// ============================================================
// 11. DELTA DISPLAY ENGINE & UNDO SPLIT ROLLBACK CONTROLLER
// ============================================================
function setDeltaDisplay(index, deltaInfo, stateClass, splitTimeSec) {
  if (index < 0 || index >= state.splitsList.length) return;
  const el = document.getElementById(`delta-${index}`);
  const item = document.getElementById(`item-${index}`);
  const fill = document.getElementById(`fill-${index}`);
  if (!el || !item) return;

  const deltaSpan = document.getElementById(`delta-val-${index}`) || el.querySelector(".split-delta-val");
  const timeSpan = document.getElementById(`time-val-${index}`) || el.querySelector(".split-time-val");

  // Clean up previous state classes
  el.classList.remove(...ALL_SPLIT_STATE_CLASSES);
  item.classList.remove(...ALL_SPLIT_STATE_CLASSES);

  if (deltaSpan) {
    deltaSpan.classList.remove(...ALL_SPLIT_STATE_CLASSES);
    if (deltaInfo && deltaInfo.text) {
      deltaSpan.innerText = deltaInfo.text;
      deltaSpan.classList.add(`delta-${stateClass}`);
    } else {
      deltaSpan.innerText = "";
    }
  }

  if (timeSpan) {
    timeSpan.classList.remove(...ALL_SPLIT_STATE_CLASSES);
    if (splitTimeSec !== null && splitTimeSec !== undefined && !isNaN(splitTimeSec)) {
      timeSpan.innerText = formatTargetTime(splitTimeSec);
      timeSpan.className = "split-time-val";
    } else {
      const targetVal = formatTargetTime(state.comparisonTimes[index]);
      timeSpan.innerText = (stateClass === "uncoloured" && (splitTimeSec === null || splitTimeSec === undefined))
        ? "-"
        : (targetVal || "-");
      timeSpan.className = "split-time-val target-time";
    }
  }

  if (fill) {
    fill.style.width = "100%";
    fill.style.height = "100%";
    fill.className = `segment-bar-fill ${stateClass}`;
    if (fill.parentElement) fill.parentElement.classList.remove("overdue");
  }

  item.classList.add("completed", stateClass);
}

function handleUndoSplit(newIdx, oldIdx) {
  const isVertical = document.getElementById("track")?.classList.contains("vertical");

  for (let i = newIdx; i < state.splitsList.length; i++) {
    delete state.lockedDeltas[i];
    delete state.completedSplitTimes[i];
    delete state.completedSplitTimesRT[i];
    delete state.completedSplitTimesGT[i];

    const deltaSpan = document.getElementById(`delta-val-${i}`);
    const timeSpan = document.getElementById(`time-val-${i}`);
    const fill = document.getElementById(`fill-${i}`);
    const item = document.getElementById(`item-${i}`);
    const deltaEl = document.getElementById(`delta-${i}`);

    if (deltaEl) {
      deltaEl.classList.remove(...ALL_SPLIT_STATE_CLASSES);
    }
    if (deltaSpan) {
      deltaSpan.innerText = "";
      deltaSpan.className = "split-delta-val";
    }
    if (timeSpan) {
      const targetVal = formatTargetTime(state.comparisonTimes[i]);
      timeSpan.innerText = targetVal || "-";
      timeSpan.className = "split-time-val target-time";
    }
    if (fill) {
      fill.style.width = isVertical ? "100%" : "0%";
      fill.style.height = isVertical ? "0%" : "100%";
      fill.className = "segment-bar-fill";
      if (fill.parentElement) fill.parentElement.classList.remove("overdue");
    }
    if (item) {
      item.classList.remove(...ALL_SPLIT_STATE_CLASSES);
    }

    // Revert temporary in-run gold segment improvements back to baseline
    if (state.baselineBestSegmentTimesGT.length > 0 && state.baselineBestSegmentTimesRT.length > 0) {
      state.bestSegmentTimesGT[i] = state.baselineBestSegmentTimesGT[i];
      state.bestSegmentTimesRT[i] = state.baselineBestSegmentTimesRT[i];
      const isRT = state.currentTimingMethod === "RealTime";
      state.bestSegmentTimes[i] = isRT
        ? (state.bestSegmentTimesRT[i] ?? state.bestSegmentTimesGT[i] ?? null)
        : (state.bestSegmentTimesGT[i] ?? state.bestSegmentTimesRT[i] ?? null);
    }
  }

  // Roll back lastSplitRecordedSec to the last actual completed split
  state.lastSplitRecordedSec = 0;
  for (let k = newIdx - 1; k >= 0; k--) {
    if (state.completedSplitTimes[k] != null) {
      state.lastSplitRecordedSec = state.completedSplitTimes[k];
      break;
    }
  }

  // Roll back previousDeltaSeconds to the last completed split with comparison data
  state.previousDeltaSeconds = 0;
  for (let k = newIdx - 1; k >= 0; k--) {
    if (state.lockedDeltas[k] && state.lockedDeltas[k].deltaInfo && state.lockedDeltas[k].stateClass !== "uncoloured") {
      state.previousDeltaSeconds = state.lockedDeltas[k].deltaInfo.signedSeconds || 0;
      break;
    }
  }

  const rc = getRaceClient();
  if (rc && typeof rc.handleUndoSplit === "function") {
    rc.handleUndoSplit(newIdx, oldIdx);
  }

  saveInRunState();
}

function detectTimingMethodFromComp(splitIdx, compSec) {
  // window.comparisonTimesGT/RT are test hooks that override the parsed curves when set.
  const gtArr = (Array.isArray(window.comparisonTimesGT) && window.comparisonTimesGT.length > 0) ? window.comparisonTimesGT : state.comparisonTimesGT;
  const rtArr = (Array.isArray(window.comparisonTimesRT) && window.comparisonTimesRT.length > 0) ? window.comparisonTimesRT : state.comparisonTimesRT;
  const detected = window.LiveSplit.SplitEngine.detectTimingMethodFromComp(splitIdx, compSec, gtArr, rtArr);
  if (detected) {
    const isManual = (localStorage.getItem("livesplit_timing_method_manual") === "true");
    if (!isManual && detected !== state.currentTimingMethod) {
      applyActiveTimingMethod(detected);
      localStorage.setItem("livesplit_timing_method", detected);
    }
  }
  return detected;
}

// ============================================================
// 12. WEBSOCKET CONNECTION & HIGH-FREQUENCY POLL LOOP
// ============================================================

function connect() {
  connection.connect();
}


// Clears per-run progress (deltas, split times, delta baseline) and the persisted in-run snapshot.
// Resets also drop the elapsed time and any queued host split flash; a fresh start keeps them.
function resetRunProgress({ isReset = true } = {}) {
  clearInRunState();
  state.lockedDeltas = {};
  state.completedSplitTimes = {};
  state.completedSplitTimesRT = {};
  state.completedSplitTimesGT = {};
  state.lastSplitRecordedSec = 0;
  state.previousDeltaSeconds = 0;
  if (isReset) {
    state.lastElapsedSec = 0;
    state.pendingHostSplitFlash = null;
  }
}

// Follows LiveSplit's active comparison when hotkey sync is enabled (disables itself if unsupported)
async function syncComparisonFromLiveSplit(timeoutMs, isProbe = false) {
  const isSyncEnabled = (localStorage.getItem("livesplit_sync_hotkeys") !== "false");
  if (!isSyncEnabled || !state.canQueryComparison) return;
  const lsComp = await sendCommand("getcomparisonname", timeoutMs, isProbe);
  if (lsComp && lsComp !== "-" && lsComp.trim()) {
    const norm = normalizeComparisonName(lsComp.trim());
    if (norm && norm !== state.currentComparison) {
      applyActiveComparison(norm, false);
    }
  } else if (lsComp === null) {
    state.canQueryComparison = false;
  }
}

// Queries LiveSplit's comparison target for the now-active split and stores it on the active curve
async function fetchComparisonTimeFor(idx) {
  const compSec = timeStringToSeconds(await sendCommand("getcomparisonsplittime"));
  if (compSec === null || compSec <= 0) return null;
  detectTimingMethodFromComp(idx, compSec);
  state.comparisonTimes[idx] = compSec;
  if (state.currentTimingMethod === "RealTime") state.comparisonTimesRT[idx] = compSec;
  else state.comparisonTimesGT[idx] = compSec;
  return compSec;
}

// Discard uncommitted in-run gold split segments by default upon reset
function restoreBaselineGoldsOnReset() {
  const discardOnReset = (localStorage.getItem("livesplit_discard_golds_on_reset") !== "false");
  if (!discardOnReset || state.baselineBestSegmentTimesGT.length === 0) return;
  state.bestSegmentTimesGT = [...state.baselineBestSegmentTimesGT];
  state.bestSegmentTimesRT = [...state.baselineBestSegmentTimesRT];
  const isRT = state.currentTimingMethod === "RealTime";
  state.bestSegmentTimes = state.splitsList.map((_, i) => {
    return isRT
      ? (state.bestSegmentTimesRT[i] ?? state.bestSegmentTimesGT[i] ?? null)
      : (state.bestSegmentTimesGT[i] ?? state.bestSegmentTimesRT[i] ?? null);
  });
  localStorage.setItem("livesplit_golds_gt", JSON.stringify(state.bestSegmentTimesGT));
  localStorage.setItem("livesplit_golds_rt", JSON.stringify(state.bestSegmentTimesRT));
}

// Returns every split node to its pre-run look (empty delta, target time, empty fill)
function resetTrackSplitDisplays() {
  const isVert = document.getElementById("track")?.classList.contains("vertical");
  for (let i = 0; i < state.splitsList.length; i++) {
    const deltaSpan = document.getElementById(`delta-val-${i}`);
    const timeSpan = document.getElementById(`time-val-${i}`);
    const fill = document.getElementById(`fill-${i}`);
    const item = document.getElementById(`item-${i}`);
    if (deltaSpan) {
      deltaSpan.innerText = "";
      deltaSpan.className = "split-delta-val";
    }
    if (timeSpan) {
      const targetVal = formatTargetTime(state.comparisonTimes[i]);
      timeSpan.innerText = targetVal || "-";
      timeSpan.className = "split-time-val target-time";
    }
    if (fill) {
      fill.style.width = isVert ? "100%" : "0%";
      fill.style.height = isVert ? "0%" : "100%";
      fill.className = "segment-bar-fill";
      if (fill.parentElement) fill.parentElement.classList.remove("overdue");
    }
    if (item) {
      item.classList.remove(...ALL_SPLIT_STATE_CLASSES);
    }
  }
}

// Reset transition: active run reset, restart from a later split, or a repeated reset to clear DNF
async function handleRunReset(idx, rc, { isSecondResetWithDNF, isSimHostForfeit }) {
  if (isSecondResetWithDNF) {
    // Second reset while DNF'd: cleanly clear DNF and completely reset the race client
    resetRunProgress();
    if (typeof rc.setHostDNF === "function") rc.setHostDNF(false);
    if (typeof rc.reset === "function") rc.reset();
  } else if (isSimHostForfeit) {
    // Reset during active simulation: Host forfeits / cancels their run (DNF)
    // The rest of the simulated competitors continue racing so you can see DNF behavior on the leaderboard!
    rc.setHostDNF(true);
    resetRunProgress();
  } else {
    resetRunProgress();
    if (rc && typeof rc.reset === "function") rc.reset();
  }

  restoreBaselineGoldsOnReset();
  resetTrackSplitDisplays();
  updateTrackStatus(idx);
  updateGhostRunner(0);
  await syncLiveSplitMetadata();
  await syncComparisonFromLiveSplit(40);
}

// Timer just started a fresh run: ensure any prior DNF is cleared and the race starts cleanly
async function handleRunStarted() {
  resetRunProgress({ isReset: false });

  const rcStart = getRaceClient();
  if (rcStart) {
    if (typeof rcStart.setHostDNF === "function" && rcStart.isHostDNF()) {
      rcStart.setHostDNF(false);
    }
    if (typeof rcStart.handleHostRunStarted === "function") {
      rcStart.handleHostRunStarted();
    }
  }

  // Fetch target time for the first split from LiveSplit
  if (state.splitsList.length > 0) {
    await fetchComparisonTimeFor(0);
  }
}

// If the runner skipped multiple splits in one leap, mark skipped intermediate splits as uncoloured
function markSkippedSplits(fromIdx, toIdxExclusive) {
  for (let s = fromIdx; s < toIdxExclusive; s++) {
    delete state.completedSplitTimes[s];
    delete state.completedSplitTimesRT[s];
    const skipDelta = { ...window.LiveSplit.SplitEvaluation.DASH_DELTA };
    state.lockedDeltas[s] = { deltaInfo: skipDelta, stateClass: "uncoloured", splitTimeSec: null };
    setDeltaDisplay(s, skipDelta, "uncoloured", null);
  }
}

// Stores the split's cumulative time on the active curve and mirrors it onto the other timing method
function recordCompletedSplitTimes(prevIdx, splitTimeSec, igtSec, rtaSec) {
  if (state.currentTimingMethod === "RealTime") {
    state.completedSplitTimesRT[prevIdx] = splitTimeSec;
    if (igtSec !== null && igtSec > 0) {
      state.completedSplitTimesGT[prevIdx] = igtSec;
    } else if (state.completedSplitTimesGT[prevIdx] != null) {
      // retain existing GT
    } else if (state.completedSplitTimes[prevIdx] != null) {
      state.completedSplitTimesGT[prevIdx] = state.completedSplitTimes[prevIdx];
    } else {
      state.completedSplitTimesGT[prevIdx] = splitTimeSec;
    }
  } else {
    state.completedSplitTimesGT[prevIdx] = splitTimeSec;
    state.completedSplitTimesRT[prevIdx] = (rtaSec !== null && rtaSec > 0) ? rtaSec : splitTimeSec;
  }
  state.completedSplitTimes[prevIdx] = (state.currentTimingMethod === "RealTime")
    ? state.completedSplitTimesRT[prevIdx]
    : state.completedSplitTimesGT[prevIdx];
}

function previousCompletedSplitSec(prevIdx) {
  for (let k = prevIdx - 1; k >= 0; k--) {
    if (state.completedSplitTimes[k] != null) return state.completedSplitTimes[k];
  }
  return 0;
}

function recordGoldSegment(prevIdx, segmentDurationSec) {
  state.bestSegmentTimes[prevIdx] = segmentDurationSec;
  if (state.currentTimingMethod === "RealTime") {
    state.bestSegmentTimesRT[prevIdx] = segmentDurationSec;
  } else {
    state.bestSegmentTimesGT[prevIdx] = segmentDurationSec;
  }

  // Only write to persistent storage immediately if the user opted out of discarding on reset
  const discardOnReset = (localStorage.getItem("livesplit_discard_golds_on_reset") !== "false");
  if (!discardOnReset) {
    if (state.currentTimingMethod === "RealTime") {
      localStorage.setItem("livesplit_golds_rt", JSON.stringify(state.bestSegmentTimesRT));
    } else {
      localStorage.setItem("livesplit_golds_gt", JSON.stringify(state.bestSegmentTimesGT));
    }
  }
}

// Final split beat the overall PB: adopt this run's splits as targets and commit earned golds to baseline
function commitPersonalBestIfBeaten(splitTimeSec) {
  const overallPbSec = state.comparisonTimes[state.splitsList.length - 1];
  if (!(overallPbSec === null || overallPbSec === undefined || splitTimeSec < overallPbSec)) return;

  for (let i = 0; i < state.splitsList.length; i++) {
    if (state.completedSplitTimes[i] != null) {
      state.comparisonTimes[i] = state.completedSplitTimes[i];
      if (state.currentTimingMethod === "RealTime") {
        state.comparisonTimesRT[i] = state.completedSplitTimes[i];
      } else {
        state.comparisonTimesGT[i] = state.completedSplitTimes[i];
      }
    }
  }

  state.baselineBestSegmentTimesGT = [...state.bestSegmentTimesGT];
  state.baselineBestSegmentTimesRT = [...state.bestSegmentTimesRT];
  localStorage.setItem("livesplit_baseline_golds_gt", JSON.stringify(state.baselineBestSegmentTimesGT));
  localStorage.setItem("livesplit_baseline_golds_rt", JSON.stringify(state.baselineBestSegmentTimesRT));
  localStorage.setItem("livesplit_golds_gt", JSON.stringify(state.bestSegmentTimesGT));
  localStorage.setItem("livesplit_golds_rt", JSON.stringify(state.bestSegmentTimesRT));

  if (state.currentTimingMethod === "RealTime") {
    localStorage.setItem("livesplit_targets_rt", JSON.stringify(state.comparisonTimesRT));
  } else {
    localStorage.setItem("livesplit_targets_gt", JSON.stringify(state.comparisonTimesGT));
  }
}

// Split index advanced: evaluate the split(s) just left and arm the next split's target
async function handleSplitAdvanced(idx, igtSec, rtaSec) {
  markSkippedSplits(state.currentIndex, idx - 1);

  const prevIdx = idx - 1;

  // A split was completed IF AND ONLY IF LiveSplit recorded a new positive split time
  // that is strictly greater than the last recorded split time of this run!
  const parsedLastSplit = timeStringToSeconds(await sendCommand("getlastsplittime"));
  const isSplitCompleted = (parsedLastSplit !== null && parsedLastSplit > 0 && parsedLastSplit > (state.lastSplitRecordedSec + 0.001));

  let splitTimeSec = null;
  let stateClass = "uncoloured";
  let displayDelta = { ...window.LiveSplit.SplitEvaluation.DASH_DELTA };

  if (isSplitCompleted) {
    splitTimeSec = parsedLastSplit;
    state.lastSplitRecordedSec = splitTimeSec;
    recordCompletedSplitTimes(prevIdx, splitTimeSec, igtSec, rtaSec);

    const finalDeltaInfo = formatDeltaLive(await sendCommand("getdelta"));
    const targetSec = (prevIdx < state.comparisonTimes.length && state.comparisonTimes[prevIdx] !== null && state.comparisonTimes[prevIdx] > 0)
      ? state.comparisonTimes[prevIdx]
      : null;
    const bestSec = (prevIdx < state.bestSegmentTimes.length && state.bestSegmentTimes[prevIdx] !== null && state.bestSegmentTimes[prevIdx] > 0)
      ? state.bestSegmentTimes[prevIdx]
      : null;

    const result = window.LiveSplit.SplitEvaluation.evaluateCompletedSplit({
      splitTimeSec,
      prevSplitSec: previousCompletedSplitSec(prevIdx),
      targetSec,
      bestSec,
      finalDeltaInfo,
      previousDeltaSeconds: state.previousDeltaSeconds,
      goldsEnabled: state.cachedEnableGolds,
      formatDeltaSeconds
    });
    if (result.isGold) recordGoldSegment(prevIdx, result.segmentDurationSec);
    stateClass = result.stateClass;
    displayDelta = result.displayDelta;
    state.previousDeltaSeconds = result.previousDeltaSeconds;

    if (prevIdx === state.splitsList.length - 1 && splitTimeSec > 0) {
      commitPersonalBestIfBeaten(splitTimeSec);
    }
  } else {
    delete state.completedSplitTimes[prevIdx];
    delete state.completedSplitTimesRT[prevIdx];
    delete state.completedSplitTimesGT[prevIdx];
  }

  state.lockedDeltas[prevIdx] = { deltaInfo: displayDelta, stateClass, splitTimeSec };
  setDeltaDisplay(prevIdx, displayDelta, stateClass, splitTimeSec);
  saveInRunState();

  // Trigger leaderboard split flash glow for host
  state.pendingHostSplitFlash = {
    type: window.LiveSplit.SplitEvaluation.getSplitFlashType(stateClass),
    timestamp: Date.now(),
    completedSplitName: (prevIdx >= 0 && prevIdx < state.splitsList.length) ? state.splitsList[prevIdx] : `Split ${prevIdx + 1}`,
    newSplitName: (idx < state.splitsList.length) ? state.splitsList[idx] : "Finished"
  };

  // Query target comparison time once for the next newly active split
  if (idx < state.splitsList.length) {
    const nextCompSec = await fetchComparisonTimeFor(idx);
    const nextTimeSpan = nextCompSec !== null ? document.getElementById(`time-val-${idx}`) : null;
    if (nextTimeSpan) {
      nextTimeSpan.innerText = formatTargetTime(nextCompSec) || "-";
    }
  }
}

// Push the host's live progress to the race client (leaderboard, gaps, split flashes)
function reportHostProgress(currentTotalSec, rtaSec) {
  const rc = getRaceClient();
  if (!rc || typeof rc.updateHostProgress !== "function") return;
  const hostSplitName = (state.currentIndex < 0)
    ? "Start"
    : (state.currentIndex < state.splitsList.length ? state.splitsList[state.currentIndex] : "Finished");
  const realTimeSec = (rtaSec !== null && rtaSec > 0) ? rtaSec : currentTotalSec;
  const rtComparisons = (state.comparisonTimesRT && state.comparisonTimesRT.length > 0) ? state.comparisonTimesRT : state.comparisonTimes;
  const rtCompletedSplits = (Object.keys(state.completedSplitTimesRT).length > 0) ? state.completedSplitTimesRT : state.completedSplitTimes;
  const gtCompletedSplits = (Object.keys(state.completedSplitTimesGT).length > 0) ? state.completedSplitTimesGT : state.completedSplitTimes;
  rc.updateHostProgress(
    currentTotalSec,
    state.currentIndex,
    gtCompletedSplits,
    state.comparisonTimes,
    hostSplitName,
    state.splitsList,
    state.pendingHostSplitFlash,
    true,
    realTimeSec,
    rtComparisons,
    rtCompletedSplits,
    state.currentTimingMethod
  );
  state.pendingHostSplitFlash = null;
}

// Reads one LiveSplit timer, mirrors it into its HUD element, and returns seconds (or null)
async function pollTimer(command, elementId) {
  const raw = await sendCommand(command);
  if (!raw || raw === "-") return null;
  const el = document.getElementById(elementId);
  if (el) el.innerText = formatTimerDisplay(raw);
  return timeStringToSeconds(raw);
}

async function handleSplitIndex(idx, igtSec, rtaSec, currentTotalSec) {
  const rc = getRaceClient();
  if (rc && typeof rc.setExternalHostConnected === "function") {
    rc.setExternalHostConnected(true);
  }
  const isSim = rc && typeof rc.isSimulating === "function" && rc.isSimulating();
  const wasRunning = (state.currentIndex > 0) || (state.currentIndex === 0 && state.lastElapsedSec > 1.0);
  const isSecondResetWithDNF = (idx === -1 && state.currentIndex === -1 && rc && typeof rc.isHostDNF === "function" && rc.isHostDNF());

  if ((idx === -1 && state.currentIndex !== -1) || (idx === 0 && state.currentIndex > 0) || isSecondResetWithDNF) {
    const isSimHostForfeit = !isSecondResetWithDNF && isSim && wasRunning && typeof rc.setHostDNF === "function" && !rc.isHostDNF();
    await handleRunReset(idx, rc, { isSecondResetWithDNF, isSimHostForfeit });
  } else if (idx !== state.currentIndex) {
    if (state.currentIndex === -1 && idx === 0) {
      await handleRunStarted();
    } else if (state.currentIndex >= 0 && idx > state.currentIndex) {
      await handleSplitAdvanced(idx, igtSec, rtaSec);
    } else if (state.currentIndex >= 0 && idx < state.currentIndex) {
      // LiveSplit Undo Split triggered
      handleUndoSplit(idx, state.currentIndex);
    }
    updateTrackStatus(idx);
    if (idx >= 0) {
      saveInRunState();
    }
  }

  if (idx >= 0 && currentTotalSec !== null) {
    reportHostProgress(currentTotalSec, rtaSec);
    updateLiveSegmentProgress(currentTotalSec);
    updateGhostRunner(currentTotalSec);
  }
}

async function pollLoop() {
  while (connection.isOpen()) {
    try {
      // 0. Periodic Auto-Sync with LiveSplit hotkeys (every ~500ms)
      state.pollTick = (state.pollTick + 1) % 15;
      if (state.pollTick === 0) {
        await syncComparisonFromLiveSplit(120, true);
      }

      // 1-2. Game Time & Real Time
      const igtSec = await pollTimer("getcurrentgametime", "timer-igt");
      const rtaSec = await pollTimer("getcurrentrealtime", "timer-rta");

      // Total elapsed seconds for the active timing method (with fallback)
      const currentTotalSec = (state.currentTimingMethod === "RealTime")
        ? (rtaSec ?? igtSec)
        : (igtSec ?? rtaSec);
      if (currentTotalSec !== null) {
        state.lastElapsedSec = currentTotalSec;
      }

      // 3. Split Index (strict integer check to avoid corrupting run if non-integer text is received)
      const splitIdxStr = await sendCommand("getsplitindex");
      const isStrictInt = typeof splitIdxStr === "string" && /^-?\d+$/.test(splitIdxStr.trim());
      if (isStrictInt) {
        await handleSplitIndex(parseInt(splitIdxStr.trim(), 10), igtSec, rtaSec, currentTotalSec);
      }
    } catch (loopErr) {
      console.error("[LiveSplit] Error in pollLoop tick:", loopErr);
    }
    await new Promise((r) => setTimeout(r, 33));
  }
}

// ============================================================
// 13. FILE LOADERS, TRACK DENSITY & SCROLL INPUT
//     (src/ui/splits-file-loader.js, track-density.js, track-scroll.js)
// ============================================================
window.LiveSplit.SplitsFileLoader.bindSplitsFileLoaders({
  onSplitsText: (xmlText) => parseLSS(xmlText, true)
});

const trackDensity = window.LiveSplit.TrackDensity.createTrackDensityController({
  getSplitCount: () => state.splitsList.length,
  onOrientationChange: () => { state.trackManualScrollOffset = 0; },
  refresh: () => updateTrackDensityAndAngle()
});
const cycleVisibleSplits = trackDensity.cycleVisibleSplits;
const cycleSplitAngle = trackDensity.cycleSplitAngle;

function updateTrackDensityAndAngle() {
  ghostRunner.clearTextThresholdCache();
  if (trackDensity.update()) {
    updateTrackStatus(state.currentIndex);
  }
}

window.updateTrackDensityAndAngle = updateTrackDensityAndAngle;

function setupTrackScrollInteractions() {
  window.LiveSplit.TrackScroll.setupTrackScrollInteractions({ isTrackWindowed, shiftTrackWindow });
}

// ============================================================
// 14. DRAGGABLE QUICK SETTINGS MENU (src/ui/settings-menu.js)
// ============================================================
const resetSettingsMenuPosition = window.LiveSplit.SettingsMenu.resetSettingsMenuPosition;
const initSettingsMenuDraggable = window.LiveSplit.SettingsMenu.initSettingsMenuDraggable;
const toggleSettingsMenu = window.LiveSplit.SettingsMenu.toggleSettingsMenu;

// ============================================================
// 15. INITIALIZATION & GLOBAL WINDOW INTERFACE
// ============================================================
let isOverlayInitialized = false;

function initOverlay() {
  if (isOverlayInitialized) return;
  isOverlayInitialized = true;

  document.getElementById("gold-toggle-badge")?.addEventListener("click", toggleGoldSegments);
  document.getElementById("timing-method-badge")?.addEventListener("click", toggleTimingMethod);
  document.getElementById("comparison-badge")?.addEventListener("click", cycleComparison);
  document.getElementById("ghost-badge")?.addEventListener("click", cycleGhostComparison);
  document.getElementById("split-density-badge")?.addEventListener("click", cycleVisibleSplits);
  document.getElementById("split-angle-badge")?.addEventListener("click", cycleSplitAngle);

  // Live race controls & WebSocket telemetry log (src/ui/race-controls.js, src/ui/ws-log-panel.js)
  const raceClient = getRaceClient();
  window.LiveSplit.RaceControls.bindRaceControls({
    raceClient,
    refreshLeaderboard,
    refreshGhosts: () => updateGhostRunner(state.lastElapsedSec),
    getSimulationInputs: () => {
      const gtComparisons = (state.comparisonTimesGT && state.comparisonTimesGT.length > 0) ? state.comparisonTimesGT : state.comparisonTimes;
      const rtComparisons = (state.comparisonTimesRT && state.comparisonTimesRT.length > 0) ? state.comparisonTimesRT : gtComparisons;
      const isAlreadyRunning = (state.currentIndex >= 0 && typeof state.lastElapsedSec === "number" && state.lastElapsedSec > 0);
      return { splitsList: state.splitsList, gtComparisons, rtComparisons, isAlreadyRunning };
    }
  });
  window.LiveSplit.WsLogPanel.bindWsLogPanel(raceClient);

  // Latching pressed-down trigger pill and close button setup
  const triggerPill = document.getElementById("settings-trigger-pill");
  const closeBtn = document.getElementById("btn-close-settings");

  // Toggle open / pressed-down state when clicking trigger pill
  if (triggerPill) {
    triggerPill.onclick = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      toggleSettingsMenu();
    };
  }

  // Explicit close button in header
  if (closeBtn) {
    closeBtn.onclick = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      toggleSettingsMenu(false);
    };
  }

  // Escape key to dismiss
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      toggleSettingsMenu(false);
    }
  });

  // Comparison switching hotkeys: 'C' / 'Shift+C', NumPad 4 / 6, [ / ]
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    const isEdit = document.body.classList.contains("edit-mode") ||
      (window.hudLayout && typeof window.hudLayout.isEditMode === "function" && window.hudLayout.isEditMode());
    if (isEdit) return;

    if (e.key === "c" || e.key === "C") {
      e.preventDefault();
      cycleComparison(e.shiftKey);
    } else if (e.code === "Numpad6" || e.key === "]") {
      e.preventDefault();
      cycleComparison(false);
    } else if (e.code === "Numpad4" || e.key === "[") {
      e.preventDefault();
      cycleComparison(true);
    }
  });

  // Direct click on timer blocks to focus timing method
  document.getElementById("block-igt")?.addEventListener("click", () => {
    if (window.hudLayout && window.hudLayout.isEditMode && window.hudLayout.isEditMode()) return;
    setTimingMethodFocus("GameTime");
  });
  document.getElementById("block-rta")?.addEventListener("click", () => {
    if (window.hudLayout && window.hudLayout.isEditMode && window.hudLayout.isEditMode()) return;
    setTimingMethodFocus("RealTime");
  });

  // Always Show Last Split checkbox listener
  document.getElementById("cb-always-show-last-split")?.addEventListener("change", (e) => {
    localStorage.setItem("livesplit_always_show_last_split", e.target.checked ? "true" : "false");
    updateTrackDensityAndAngle();
    updateTrackStatus(state.currentIndex);
  });

  initSettingsMenuDraggable();
  setupTrackScrollInteractions();
  loadCachedSplits();
  updateTrackDensityAndAngle();
  updateGhostBadge();

  initDevMode();

  const verEl = document.getElementById("overlay-version");
  if (verEl) verEl.innerText = APP_VERSION;

  connect();
}

// ============================================================
// Developer & Diagnostics Mode (src/ui/dev-mode.js)
// ============================================================
const isDevModeActive = window.LiveSplit.DevMode.isDevModeActive;
const setDevMode = window.LiveSplit.DevMode.setDevMode;
const toggleDevMode = window.LiveSplit.DevMode.toggleDevMode;
const initDevMode = window.LiveSplit.DevMode.initDevMode;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initOverlay);
} else {
  initOverlay();
}

// Global exports for layout.js and unit tests
window.APP_VERSION = APP_VERSION;
window.applyActiveComparison = applyActiveComparison;
window.getCurrentComparison = () => state.currentComparison;
window.getComparisonsList = () => state.comparisonsList;
window.cycleComparison = cycleComparison;
window.timeStringToSeconds = timeStringToSeconds;
window.formatTargetTime = formatTargetTime;
window.formatDeltaSeconds = formatDeltaSeconds;
window.formatDeltaLive = formatDeltaLive;
window.normalizeComparisonName = normalizeComparisonName;
window.getShortComparisonName = getShortComparisonName;
window.getGhostComparison = () => ghostRunner.getPrimaryGhost();
window.getActiveGhostComparisons = () => ghostRunner.getActiveGhostComparisons();
window.setGhostComparison = setGhostComparison;
window.toggleGhostComparison = toggleGhostComparison;
window.cycleGhostComparison = cycleGhostComparison;
window.getGhostComparisonInfo = getGhostComparisonInfo;
window.getOrCreateGhostMarker = getOrCreateGhostMarker;
window.calculateGhostProgress = calculateGhostProgress;
window.getNodeTextThreshold = getNodeTextThreshold;
window.setGhostOpacity = setGhostOpacity;
window.sanitizeComparisonTimes = sanitizeComparisonTimes;
window.detectTimingMethodFromComp = detectTimingMethodFromComp;
window.applyActiveTimingMethod = applyActiveTimingMethod;
window.getCurrentTimingMethod = () => state.currentTimingMethod;
window.setTimerDisplayMode = setTimerDisplayMode;
window.setTimingMethodFocus = setTimingMethodFocus;
window.getTimerDisplayMode = () => state.timerDisplayMode;
window.toggleTimingMethod = toggleTimingMethod;
window.resetSettingsMenuPosition = resetSettingsMenuPosition;
window.toggleSettingsMenu = toggleSettingsMenu;
window.handleUndoSplit = handleUndoSplit;
window.setDeltaDisplay = setDeltaDisplay;
window.setupTrackScrollInteractions = setupTrackScrollInteractions;
window.formatTimerDisplay = formatTimerDisplay;
window.saveInRunState = saveInRunState;
window.clearInRunState = clearInRunState;
window.loadInRunState = loadInRunState;
window.getLockedDeltas = () => state.lockedDeltas;
window.getCurrentIndex = () => state.currentIndex;
window.updateTrackStatus = updateTrackStatus;
window.updateGhostBadge = updateGhostBadge;
window.updateGhostRunner = updateGhostRunner;
window.updateTrackWindow = updateTrackWindow;
window.shiftTrackWindow = shiftTrackWindow;
window.isTrackWindowed = isTrackWindowed;
window.getVisibleSplitsCapacity = getVisibleSplitsCapacity;
window.getTrackManualScrollOffset = () => state.trackManualScrollOffset;
window.showComparisonToast = showComparisonToast;
window.isDevMode = isDevModeActive;
window.showDevModeToast = window.LiveSplit.ToastManager.showDevModeToast;
window.setDevMode = setDevMode;
window.toggleDevMode = toggleDevMode;
window.updateTimingMethodBadge = updateTimingMethodBadge;
window.updateTimerDisplayHierarchy = updateTimerDisplayHierarchy;
window.initOverlay = initOverlay;
window.getLastElapsedSec = () => state.lastElapsedSec;
window.LiveSplit = window.LiveSplit || {};
window.LiveSplit.getLastElapsedSec = () => state.lastElapsedSec;
