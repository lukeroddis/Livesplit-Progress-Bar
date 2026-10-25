// Safe storage wrapper providing in-memory fallback if localStorage is disabled or restricted
// (e.g. sandboxed OBS Studio CEF Browser Sources, private browsing, or QuotaExceededError)
const memoryStorage = {};
const safeStorage = {
  getItem(key) {
    try {
      const val = localStorage.getItem(key);
      return val !== null ? val : (memoryStorage[key] !== undefined ? memoryStorage[key] : null);
    } catch (e) {
      return memoryStorage[key] !== undefined ? memoryStorage[key] : null;
    }
  },
  setItem(key, value) {
    const str = String(value);
    memoryStorage[key] = str;
    try {
      localStorage.setItem(key, str);
    } catch (e) {
      console.warn(`[safeStorage] localStorage unavailable, using in-memory fallback for "${key}"`, e);
    }
  },
  removeItem(key) {
    delete memoryStorage[key];
    try {
      localStorage.removeItem(key);
    } catch (e) {
      // ignore
    }
  }
};
window.safeStorage = safeStorage;

const APP_VERSION = "v1.0.3";
const WS_URL = "ws://localhost:16834/livesplit";

// Generic fallback splits used if no .lss is loaded
const DEFAULT_SPLITS = [
  "Split 1", "Split 2", "Split 3", "Split 4", "Split 5",
  "Split 6", "Split 7", "Split 8", "Split 9", "Finish"
];
const DEFAULT_TARGETS = [30, 60, 90, 120, 150, 180, 210, 240, 270, 300];
const DEFAULT_BESTS = [30, 30, 30, 30, 30, 30, 30, 30, 30, 30];

let splitsList = [];
let comparisonTimes = [];
let bestSegmentTimes = [];
let comparisonTimesGT = [];
let comparisonTimesRT = [];
let bestSegmentTimesGT = [];
let bestSegmentTimesRT = [];
let baselineBestSegmentTimesGT = [];
let baselineBestSegmentTimesRT = [];
let comparisonsList = ["Personal Best", "Best Segments", "Average Segments", "Worst Segments"];
let currentComparison = "Personal Best";
let comparisonsDataGT = {};
let comparisonsDataRT = {};
let completedSplitTimes = {};
let completedSplitTimesRT = {};
let completedSplitTimesGT = {};
let currentTimingMethod = "GameTime";
let timerDisplayMode = "both"; // 'gametime' | 'realtime' | 'both'
let lockedDeltas = {}; 
let ws = null;
let currentIndex = -1;
let isPolling = false;
let inflightResolver = null;
let lastSplitRecordedSec = 0;
let previousDeltaSeconds = 0;
let lastElapsedSec = 0;
let trackManualScrollOffset = 0;

const IN_RUN_STATE_KEY = "livesplit_in_run_state";

function saveInRunState() {
  try {
    const state = {
      currentIndex,
      lockedDeltas,
      completedSplitTimes,
      completedSplitTimesRT,
      completedSplitTimesGT,
      lastSplitRecordedSec,
      previousDeltaSeconds,
      lastElapsedSec,
      splitsCount: splitsList.length,
      game: localStorage.getItem("livesplit_game") || "",
      category: localStorage.getItem("livesplit_category") || ""
    };
    localStorage.setItem(IN_RUN_STATE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("Failed to persist in-run state to localStorage:", e);
  }
}

function clearInRunState() {
  try {
    trackManualScrollOffset = 0;
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
      if (typeof parsed.splitsCount === "number" && splitsList.length > 0 && parsed.splitsCount !== splitsList.length) {
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
      lockedDeltas = parsed.lockedDeltas || {};
      completedSplitTimes = parsed.completedSplitTimes || {};
      completedSplitTimesRT = parsed.completedSplitTimesRT || {};
      completedSplitTimesGT = parsed.completedSplitTimesGT || {};
      lastSplitRecordedSec = Number(parsed.lastSplitRecordedSec) || 0;
      previousDeltaSeconds = Number(parsed.previousDeltaSeconds) || 0;
      if (typeof parsed.lastElapsedSec === "number") {
        lastElapsedSec = parsed.lastElapsedSec;
        if (lastElapsedSec > 0) {
          const rtaEl = document.getElementById("timer-rta");
          const igtEl = document.getElementById("timer-igt");
          const disp = formatTimerDisplay(lastElapsedSec);
          if (rtaEl) rtaEl.innerText = disp;
          if (igtEl) igtEl.innerText = disp;
        }
      }
      if (typeof parsed.currentIndex === "number") {
        currentIndex = parsed.currentIndex;
      }
      return true;
    }
  } catch (e) {
    console.warn("Failed to load in-run state from localStorage:", e);
  }
  return false;
}

// High-frequency render loop optimizations & memory caches
const ALL_DELTA_CLASSES = [
  "delta-ahead-gaining", "delta-ahead-losing", 
  "delta-behind-gaining", "delta-behind-losing", 
  "delta-gold", "delta-uncoloured"
];
const ALL_SPLIT_STATE_CLASSES = [
  "completed", "current", "target-time", 
  "ahead-gaining", "ahead-losing", 
  "behind-gaining", "behind-losing", 
  "gold", "uncoloured", "overdue",
  ...ALL_DELTA_CLASSES
];
let cachedEnableGolds = (localStorage.getItem("livesplit_enable_golds") !== "false");
const nodeThresholdCache = new Map();
const knownGhostMarkers = new Set();
let commandQueue = Promise.resolve();

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
  const badge = document.getElementById("timing-method-badge");
  if (!badge) return;
  if (timerDisplayMode === "gametime") {
    badge.innerText = "Time: Game";
    badge.style.color = "#38bdf8";
  } else if (timerDisplayMode === "realtime") {
    badge.innerText = "Time: Real";
    badge.style.color = "#a78bfa";
  } else {
    // Both timers visible
    if (currentTimingMethod === "GameTime") {
      badge.innerText = "Time: Both (Game)";
      badge.style.color = "#38bdf8";
    } else {
      badge.innerText = "Time: Both (Real)";
      badge.style.color = "#a78bfa";
    }
  }
}

function updateTimerDisplayHierarchy() {
  const rtaEl = document.getElementById("timer-rta");
  const igtEl = document.getElementById("timer-igt");
  const rtaBlock = document.getElementById("block-rta");
  const igtBlock = document.getElementById("block-igt");
  if (!rtaEl || !igtEl || !rtaBlock || !igtBlock) return;

  const mode = timerDisplayMode || "both";

  if (mode === "gametime") {
    igtBlock.style.display = "flex";
    rtaBlock.style.display = "none";
    igtEl.className = "timer-primary";
    rtaEl.className = "timer-secondary";
  } else if (mode === "realtime") {
    rtaBlock.style.display = "flex";
    igtBlock.style.display = "none";
    rtaEl.className = "timer-primary";
    igtEl.className = "timer-secondary";
  } else {
    // Both timers visible
    rtaBlock.style.display = "flex";
    igtBlock.style.display = "flex";
    const isRT = currentTimingMethod === "RealTime";
    if (isRT) {
      rtaEl.className = "timer-primary";
      igtEl.className = "timer-secondary";
    } else {
      igtEl.className = "timer-primary";
      rtaEl.className = "timer-secondary";
    }
  }
}

// ============================================================
// 3. COMPARISONS NORMALIZATION & ACTIVE CURVES ENGINE
// ============================================================
function getShortComparisonName(name) {
  if (name === "Personal Best") return "PB";
  if (name === "Best Segments") return "Best Segs";
  if (name === "Average Segments") return "Average";
  if (name === "Worst Segments") return "Worst";
  return name.length > 10 ? name.slice(0, 9) + "…" : name;
}

function normalizeComparisonName(raw) {
  if (!raw || raw === "-" || raw.trim() === "") return null;
  const str = raw.trim();
  const lower = str.toLowerCase();
  if (lower === "personal best" || lower === "pb") return "Personal Best";
  if (lower === "best segments" || lower === "best splits" || lower === "sum of best") return "Best Segments";
  if (lower === "average segments" || lower === "average") return "Average Segments";
  if (lower === "worst segments" || lower === "worst") return "Worst Segments";

  for (const c of comparisonsList) {
    if (c.toLowerCase() === lower) return c;
  }
  return str;
}

function initDefaultComparisons() {
  comparisonsList = ["Personal Best", "Best Segments", "Average Segments", "Worst Segments"];
  comparisonsDataGT["Personal Best"] = [...DEFAULT_TARGETS];
  comparisonsDataRT["Personal Best"] = [...DEFAULT_TARGETS];

  let sumBest = 0;
  comparisonsDataGT["Best Segments"] = DEFAULT_BESTS.map(b => (sumBest += b));
  comparisonsDataRT["Best Segments"] = [...comparisonsDataGT["Best Segments"]];

  comparisonsDataGT["Average Segments"] = DEFAULT_TARGETS.map(t => Math.round(t * 1.08));
  comparisonsDataRT["Average Segments"] = [...comparisonsDataGT["Average Segments"]];

  comparisonsDataGT["Worst Segments"] = DEFAULT_TARGETS.map(t => Math.round(t * 1.25));
  comparisonsDataRT["Worst Segments"] = [...comparisonsDataGT["Worst Segments"]];
}

function applyActiveTimingMethod(method) {
  if (method && (method === "GameTime" || method === "RealTime")) {
    currentTimingMethod = method;
  }
  updateTimingMethodBadge();
  updateTimerDisplayHierarchy();

  const isRT = currentTimingMethod === "RealTime";
  const activeTargets = isRT 
    ? (comparisonsDataRT[currentComparison] || comparisonTimesRT)
    : (comparisonsDataGT[currentComparison] || comparisonTimesGT);
  const fallbackTargets = isRT
    ? (comparisonsDataGT[currentComparison] || comparisonTimesGT)
    : (comparisonsDataRT[currentComparison] || comparisonTimesRT);

  comparisonTimes = splitsList.map((_, i) => {
    return activeTargets[i] ?? fallbackTargets[i] ?? null;
  });

  bestSegmentTimes = splitsList.map((_, i) => {
    return isRT
      ? (bestSegmentTimesRT[i] ?? bestSegmentTimesGT[i] ?? null)
      : (bestSegmentTimesGT[i] ?? bestSegmentTimesRT[i] ?? null);
  });

  for (let i = 0; i < splitsList.length; i++) {
    if (!lockedDeltas[i]) {
      const timeSpan = document.getElementById(`time-val-${i}`);
      if (timeSpan) {
        const targetVal = formatTargetTime(comparisonTimes[i]);
        timeSpan.innerText = targetVal || "-";
      }
    }
  }

  const rc = window.LiveSplit && window.LiveSplit.RaceClient ? (window.LiveSplit.RaceClient.instance || window.LiveSplit.RaceClient) : window.LiveSplitRaceClient;
  if (rc && typeof rc.setTimingMethod === "function") {
    rc.setTimingMethod(currentTimingMethod);
  }
}

function applyActiveComparison(compName, updateLiveSplit = false, showToast = true) {
  const norm = normalizeComparisonName(compName) || "Personal Best";
  currentComparison = norm;
  localStorage.setItem("livesplit_current_comparison", currentComparison);

  const isRT = currentTimingMethod === "RealTime";
  const activeTargets = isRT 
    ? (comparisonsDataRT[currentComparison] || comparisonTimesRT)
    : (comparisonsDataGT[currentComparison] || comparisonTimesGT);
  const fallbackTargets = isRT
    ? (comparisonsDataGT[currentComparison] || comparisonTimesGT)
    : (comparisonsDataRT[currentComparison] || comparisonTimesRT);

  comparisonTimes = splitsList.map((_, i) => {
    return activeTargets[i] ?? fallbackTargets[i] ?? null;
  });

  const badge = document.getElementById("comparison-badge");
  if (badge) {
    badge.innerText = `Comp: ${getShortComparisonName(currentComparison)}`;
  }

  const selComp = document.getElementById("select-active-comparison");
  if (selComp && selComp.value !== currentComparison) {
    selComp.value = currentComparison;
  }

  let prevDiff = 0;
  for (let i = 0; i < splitsList.length; i++) {
    const splitTimeSec = completedSplitTimes[i] ?? lockedDeltas[i]?.splitTimeSec;
    if (splitTimeSec !== null && splitTimeSec !== undefined && !isNaN(splitTimeSec) && splitTimeSec > 0) {
      // Completed split: recalculate delta and segment status against newly active comparison
      const targetSec = (i < comparisonTimes.length && comparisonTimes[i] !== null && comparisonTimes[i] > 0)
        ? comparisonTimes[i]
        : null;

      if (targetSec !== null) {
        const diff = splitTimeSec - targetSec;
        const deltaChange = diff - prevDiff;
        const gainedTime = deltaChange <= 0.001;
        const isAhead = diff <= 0;
        const isGold = (lockedDeltas[i]?.stateClass === "gold");

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
        lockedDeltas[i] = { deltaInfo: displayDelta, stateClass, splitTimeSec };
        setDeltaDisplay(i, displayDelta, stateClass, splitTimeSec);
      } else {
        const displayDelta = { text: "-", isAhead: false, signedSeconds: 0 };
        const stateClass = "uncoloured";
        lockedDeltas[i] = { deltaInfo: displayDelta, stateClass, splitTimeSec };
        setDeltaDisplay(i, displayDelta, stateClass, splitTimeSec);
      }
    } else if (lockedDeltas[i]?.stateClass === "uncoloured" && (completedSplitTimes[i] === null || completedSplitTimes[i] === undefined)) {
      // Skipped split: retain uncoloured placeholder
      const skipDelta = { text: "-", isAhead: false, signedSeconds: 0 };
      setDeltaDisplay(i, skipDelta, "uncoloured", null);
    } else {
      // Upcoming split: update target comparison time
      const timeSpan = document.getElementById(`time-val-${i}`);
      if (timeSpan) {
        const targetVal = formatTargetTime(comparisonTimes[i]);
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

  if (currentIndex >= 0 && currentIndex < splitsList.length) {
    previousDeltaSeconds = prevDiff;
  }

  if (currentIndex >= 0) {
    saveInRunState();
  }

  if (updateLiveSplit && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(`setcomparison ${currentComparison}`);
  }

  if (showToast) {
    showComparisonToast(currentComparison);
  }
}

let comparisonToastTimer = null;
function showComparisonToast(compName) {
  if (!compName) return;
  let toast = document.getElementById("hud-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "hud-toast";
    toast.className = "hud-toast";
    document.body.appendChild(toast);
  }
  toast.style.display = "";
  toast.innerHTML = `<span style="color: #38bdf8;">⚖️ Comparison:</span> <span>${escapeHtml(compName)}</span>`;
  toast.classList.add("show");
  if (comparisonToastTimer) clearTimeout(comparisonToastTimer);
  comparisonToastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 1800);
}

function cycleComparison(reverse = false) {
  if (comparisonsList.length === 0) return;
  const currentIdx = comparisonsList.indexOf(currentComparison);
  const nextIdx = reverse
    ? (currentIdx - 1 + comparisonsList.length) % comparisonsList.length
    : (currentIdx + 1) % comparisonsList.length;
  const nextComp = comparisonsList[nextIdx];
  applyActiveComparison(nextComp, true);
}

// ============================================================
// 4. TIME UTILITIES & LIVE DELTA PARSING
// ============================================================
function timeStringToSeconds(tStr) {
  if (!tStr || tStr === "-" || tStr === "") return null;
  const str = tStr.trim();
  let days = 0;
  let timePart = str;
  if (str.includes(".")) {
    const firstDot = str.indexOf(".");
    const firstColon = str.indexOf(":");
    if (firstColon !== -1 && firstDot < firstColon) {
      days = parseInt(str.slice(0, firstDot), 10) || 0;
      timePart = str.slice(firstDot + 1);
    }
  }
  const parts = timePart.split(":");
  let sec = 0;
  if (parts.length === 3) {
    sec = parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
  } else if (parts.length === 2) {
    sec = parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
  } else if (parts.length === 1) {
    sec = parseFloat(parts[0]);
  } else {
    return null;
  }
  return isNaN(sec) ? null : days * 86400 + sec;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatTimerDisplay(rawTime) {
  if (rawTime === null || rawTime === undefined || rawTime === "") return "0.00";
  if (rawTime === "-") return "-";

  let isNegative = false;
  let days = 0;
  let h = 0;
  let m = 0;
  let s = 0;
  let hundredths = "00";

  if (typeof rawTime === "number") {
    if (isNaN(rawTime)) return "0.00";
    if (rawTime < 0) {
      isNegative = true;
      rawTime = Math.abs(rawTime);
    }
    const totalHundredths = Math.round(rawTime * 100);
    const totalSec = Math.floor(totalHundredths / 100);
    const frac = totalHundredths % 100;
    h = Math.floor(totalSec / 3600);
    m = Math.floor((totalSec % 3600) / 60);
    s = totalSec % 60;
    hundredths = frac.toString().padStart(2, "0");
  } else {
    let str = String(rawTime).trim();
    if (str.startsWith("-") || str.startsWith("−") || str.charCodeAt(0) === 8722) {
      isNegative = true;
      str = str.replace(/^[-−\u2212]/, "").trim();
    }

    if (str.includes(".")) {
      const firstDot = str.indexOf(".");
      const firstColon = str.indexOf(":");
      // Days part before dot, e.g. "1.02:03:04.56"
      if (firstColon !== -1 && firstDot < firstColon) {
        days = parseInt(str.slice(0, firstDot), 10) || 0;
        str = str.slice(firstDot + 1);
      }
    }

    let timeMain = str;
    let fracPart = "";
    if (str.includes(".")) {
      const dotIdx = str.indexOf(".");
      timeMain = str.slice(0, dotIdx);
      fracPart = str.slice(dotIdx + 1);
    }

    hundredths = fracPart.length >= 2 
      ? fracPart.slice(0, 2) 
      : fracPart.padEnd(2, "0");

    const parts = timeMain.split(":");
    if (parts.length === 3) {
      h = (parseInt(parts[0], 10) || 0) + (days * 24);
      m = parseInt(parts[1], 10) || 0;
      s = parseInt(parts[2], 10) || 0;
    } else if (parts.length === 2) {
      h = days * 24;
      m = parseInt(parts[0], 10) || 0;
      s = parseInt(parts[1], 10) || 0;
    } else if (parts.length === 1) {
      h = days * 24;
      m = 0;
      s = parseInt(parts[0], 10) || 0;
    }
  }

  // Avoid "-0.00"
  if (isNegative && h === 0 && m === 0 && s === 0 && (hundredths === "00" || hundredths === "0")) {
    isNegative = false;
  }

  const sPad = (h > 0 || m > 0) ? s.toString().padStart(2, "0") : s.toString();
  let result = "";

  if (h > 0) {
    const mPad = m.toString().padStart(2, "0");
    result = `${h}:${mPad}:${sPad}.${hundredths}`;
  } else if (m > 0) {
    result = `${m}:${sPad}.${hundredths}`;
  } else {
    result = `${sPad}.${hundredths}`;
  }

  return isNegative ? `-${result}` : result;
}

function formatTargetTime(sec) {
  if (sec === null || sec === undefined || isNaN(sec)) return "";
  const totalSec = Math.floor(sec);
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

function formatDeltaSeconds(signedSec) {
  if (signedSec === null || signedSec === undefined || isNaN(signedSec)) return "";
  const isAhead = signedSec < 0;
  const sign = isAhead ? "-" : "+";
  const abs = Math.abs(signedSec);

  if (abs < 0.05) {
    return "±0.0";
  }

  const totalSec = Math.floor(abs);
  const frac = Math.floor((abs - totalSec) * 10);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const sPad = (s < 10 && (h > 0 || m > 0)) ? `0${s}` : `${s}`;

  if (h > 0) {
    const mPad = m < 10 ? `0${m}` : `${m}`;
    return `${sign}${h}:${mPad}:${sPad}`;
  } else if (m > 0) {
    return `${sign}${m}:${sPad}`;
  } else {
    return `${sign}${sPad}.${frac}`;
  }
}

function formatDeltaLive(raw) {
  if (!raw || raw === "-" || raw.trim() === "") return null;

  const trimmed = raw.trim();
  const isAhead = trimmed.startsWith("-") || trimmed.startsWith("−") || trimmed.charCodeAt(0) === 8722;
  const sign = isAhead ? "-" : "+";

  let cleaned = trimmed.replace(/^[-+−\u2212]/, "").trim();

  let days = 0;
  if (cleaned.includes(".")) {
    const firstDot = cleaned.indexOf(".");
    const firstColon = cleaned.indexOf(":");
    if (firstColon !== -1 && firstDot < firstColon) {
      days = parseInt(cleaned.slice(0, firstDot), 10) || 0;
      cleaned = cleaned.slice(firstDot + 1);
    }
  }

  let decPart = "";
  let fracSec = 0;
  if (cleaned.includes(".")) {
    const parts = cleaned.split(".");
    cleaned = parts[0];
    decPart = "." + parts[1].charAt(0);
    fracSec = parseFloat("0." + parts[1]) || 0;
  }

  const timeUnits = cleaned.split(":").map(p => parseInt(p, 10));
  if (timeUnits.some(isNaN)) return null;

  let totalSec = days * 86400;
  if (timeUnits.length === 3) totalSec += timeUnits[0] * 3600 + timeUnits[1] * 60 + timeUnits[2];
  else if (timeUnits.length === 2) totalSec += timeUnits[0] * 60 + timeUnits[1];
  else if (timeUnits.length === 1) totalSec += timeUnits[0];

  const signedSeconds = isAhead ? -(totalSec + fracSec) : (totalSec + fracSec);

  if (totalSec === 0 && fracSec === 0 && !isAhead) {
    return { text: "±0.0", isAhead: false, signedSeconds: 0 };
  }

  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const secFormatted = (s < 10 && (h > 0 || m > 0)) ? `0${s}` : `${s}`;

  let outputText = "";
  if (h > 0) {
    const minFormatted = m < 10 ? `0${m}` : `${m}`;
    outputText = `${sign}${h}:${minFormatted}:${secFormatted}`;
  } else if (m > 0) {
    outputText = `${sign}${m}:${secFormatted}`;
  } else {
    outputText = `${sign}${secFormatted}${decPart || ".0"}`;
  }

  return { text: outputText, isAhead, signedSeconds };
}

function sanitizeComparisonTimes(times, fallbackTimes, targetLen = null) {
  if (!times || !Array.isArray(times) || times.length === 0) {
    return fallbackTimes && Array.isArray(fallbackTimes) ? [...fallbackTimes] : [];
  }
  const len = targetLen !== null 
    ? targetLen 
    : (fallbackTimes && fallbackTimes.length > times.length ? fallbackTimes.length : times.length);
  const result = new Array(len);
  let lastVal = 0;

  for (let i = 0; i < len; i++) {
    const raw = times[i];
    if (raw !== null && raw !== undefined && !isNaN(raw) && raw > 0) {
      lastVal = raw;
      result[i] = raw;
    } else if (fallbackTimes && fallbackTimes[i] !== null && fallbackTimes[i] !== undefined && !isNaN(fallbackTimes[i]) && fallbackTimes[i] > 0) {
      const fb = fallbackTimes[i];
      lastVal = Math.max(lastVal, fb);
      result[i] = lastVal;
    } else {
      result[i] = lastVal > 0 ? lastVal : null;
    }
  }
  return result;
}

// ============================================================
// 5. LSS XML SPLITS PARSER & HISTORICAL CURVES COMPUTATION
// ============================================================
function parseLSS(xmlText, isNewDrop = false) {
  try {
    if (isNewDrop) {
      clearInRunState();
      currentIndex = -1;
      lockedDeltas = {};
      completedSplitTimes = {};
      completedSplitTimesRT = {};
      lastSplitRecordedSec = 0;
      previousDeltaSeconds = 0;
      lastElapsedSec = 0;
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

    const segments = Array.from(xml.querySelectorAll("Segment"));
    if (segments.length > 0) {
      splitsList = [];
      comparisonTimesGT = [];
      comparisonTimesRT = [];
      bestSegmentTimesGT = [];
      bestSegmentTimesRT = [];
      comparisonsDataGT = {};
      comparisonsDataRT = {};
      comparisonsList = ["Personal Best", "Best Segments", "Average Segments", "Worst Segments"];

      // Collect any custom comparisons declared in root <Comparisons>
      const declaredComps = Array.from(xml.querySelectorAll("Comparisons > Comparison"));
      declaredComps.forEach(c => {
        const cName = c.textContent.trim();
        if (cName && !comparisonsList.includes(cName)) {
          comparisonsList.push(cName);
        }
      });

      const segmentHistoriesGT = [];
      const segmentHistoriesRT = [];
      const customSplitTimesGT = {};
      const customSplitTimesRT = {};

      segments.forEach((seg, segIdx) => {
        const name = seg.querySelector("Name")?.textContent.trim() || "Split";

        let pbGT = null;
        let pbRT = null;
        const pbNode = seg.querySelector("SplitTimes > SplitTime[name='Personal Best']");
        if (pbNode) {
          pbGT = pbNode.querySelector("GameTime")?.textContent;
          pbRT = pbNode.querySelector("RealTime")?.textContent;
        }
        if (!pbGT && !pbRT) {
          pbGT = seg.querySelector("PersonalBestSplitTime > GameTime")?.textContent;
          pbRT = seg.querySelector("PersonalBestSplitTime > RealTime")?.textContent;
        }

        const bestGT = seg.querySelector("BestSegmentTime > GameTime")?.textContent;
        const bestRT = seg.querySelector("BestSegmentTime > RealTime")?.textContent;

        let bestSecGT = timeStringToSeconds(bestGT);
        let bestSecRT = timeStringToSeconds(bestRT);

        // Collect segment history for calculating Average Segments and Worst Segments
        const segHistGT = [];
        const segHistRT = [];
        const historyTimes = Array.from(seg.querySelectorAll("SegmentHistory > Time"));
        historyTimes.forEach(tNode => {
          const hgt = timeStringToSeconds(tNode.querySelector("GameTime")?.textContent);
          const hrt = timeStringToSeconds(tNode.querySelector("RealTime")?.textContent);
          if (hgt !== null && hgt > 0) {
            segHistGT.push(hgt);
            if (bestSecGT === null || hgt < bestSecGT) bestSecGT = hgt;
          }
          if (hrt !== null && hrt > 0) {
            segHistRT.push(hrt);
            if (bestSecRT === null || hrt < bestSecRT) bestSecRT = hrt;
          }
        });

        // Collect custom comparison split times
        const splitTimeNodes = Array.from(seg.querySelectorAll("SplitTimes > SplitTime"));
        splitTimeNodes.forEach(st => {
          const stName = st.getAttribute("name");
          if (stName && stName !== "Personal Best") {
            if (!customSplitTimesGT[stName]) customSplitTimesGT[stName] = [];
            if (!customSplitTimesRT[stName]) customSplitTimesRT[stName] = [];
            const sgt = timeStringToSeconds(st.querySelector("GameTime")?.textContent);
            const srt = timeStringToSeconds(st.querySelector("RealTime")?.textContent);
            customSplitTimesGT[stName][segIdx] = sgt;
            customSplitTimesRT[stName][segIdx] = srt;
            if (!comparisonsList.includes(stName)) comparisonsList.push(stName);
          }
        });

        splitsList.push(name);
        comparisonTimesGT.push(timeStringToSeconds(pbGT));
        comparisonTimesRT.push(timeStringToSeconds(pbRT));
        bestSegmentTimesGT.push(bestSecGT);
        bestSegmentTimesRT.push(bestSecRT);
        segmentHistoriesGT.push(segHistGT);
        segmentHistoriesRT.push(segHistRT);
      });

      // 1. Personal Best targets
      comparisonsDataGT["Personal Best"] = [...comparisonTimesGT];
      comparisonsDataRT["Personal Best"] = [...comparisonTimesRT];

      // 2. Best Segments targets (Sum of Best)
      let cumBestGT = 0;
      let cumBestRT = 0;
      comparisonsDataGT["Best Segments"] = bestSegmentTimesGT.map(s => {
        if (s !== null && s > 0) cumBestGT += s;
        return cumBestGT > 0 ? cumBestGT : null;
      });
      comparisonsDataRT["Best Segments"] = bestSegmentTimesRT.map(s => {
        if (s !== null && s > 0) cumBestRT += s;
        return cumBestRT > 0 ? cumBestRT : null;
      });

      // 3. Average Segments targets
      let cumAvgGT = 0;
      let cumAvgRT = 0;
      comparisonsDataGT["Average Segments"] = [];
      comparisonsDataRT["Average Segments"] = [];
      for (let i = 0; i < segments.length; i++) {
        const hgt = segmentHistoriesGT[i];
        let pbDurGT = (comparisonTimesGT[i] != null && (i === 0 ? comparisonTimesGT[i] : (comparisonTimesGT[i] - (comparisonTimesGT[i-1] || 0)))) || null;
        if (pbDurGT !== null && pbDurGT <= 0) pbDurGT = bestSegmentTimesGT[i];
        const avgGT = hgt.length > 0 ? (hgt.reduce((a, b) => a + b, 0) / hgt.length) : (pbDurGT ?? bestSegmentTimesGT[i]);
        if (avgGT != null && avgGT > 0) cumAvgGT += avgGT;
        comparisonsDataGT["Average Segments"].push(cumAvgGT > 0 ? cumAvgGT : null);

        const hrt = segmentHistoriesRT[i];
        let pbDurRT = (comparisonTimesRT[i] != null && (i === 0 ? comparisonTimesRT[i] : (comparisonTimesRT[i] - (comparisonTimesRT[i-1] || 0)))) || null;
        if (pbDurRT !== null && pbDurRT <= 0) pbDurRT = bestSegmentTimesRT[i];
        const avgRT = hrt.length > 0 ? (hrt.reduce((a, b) => a + b, 0) / hrt.length) : (pbDurRT ?? bestSegmentTimesRT[i]);
        if (avgRT != null && avgRT > 0) cumAvgRT += avgRT;
        comparisonsDataRT["Average Segments"].push(cumAvgRT > 0 ? cumAvgRT : null);
      }

      // 4. Worst Segments targets
      let cumWorstGT = 0;
      let cumWorstRT = 0;
      comparisonsDataGT["Worst Segments"] = [];
      comparisonsDataRT["Worst Segments"] = [];
      for (let i = 0; i < segments.length; i++) {
        const hgt = segmentHistoriesGT[i];
        let pbDurGT = (comparisonTimesGT[i] != null && (i === 0 ? comparisonTimesGT[i] : (comparisonTimesGT[i] - (comparisonTimesGT[i-1] || 0)))) || null;
        if (pbDurGT !== null && pbDurGT <= 0) pbDurGT = bestSegmentTimesGT[i];
        const worstGT = hgt.length > 0 ? Math.max(...hgt) : (pbDurGT ?? bestSegmentTimesGT[i]);
        if (worstGT != null && worstGT > 0) cumWorstGT += worstGT;
        comparisonsDataGT["Worst Segments"].push(cumWorstGT > 0 ? cumWorstGT : null);

        const hrt = segmentHistoriesRT[i];
        let pbDurRT = (comparisonTimesRT[i] != null && (i === 0 ? comparisonTimesRT[i] : (comparisonTimesRT[i] - (comparisonTimesRT[i-1] || 0)))) || null;
        if (pbDurRT !== null && pbDurRT <= 0) pbDurRT = bestSegmentTimesRT[i];
        const worstRT = hrt.length > 0 ? Math.max(...hrt) : (pbDurRT ?? bestSegmentTimesRT[i]);
        if (worstRT != null && worstRT > 0) cumWorstRT += worstRT;
        comparisonsDataRT["Worst Segments"].push(cumWorstRT > 0 ? cumWorstRT : null);
      }

      // 5. Custom comparisons (sanitized and cross-filled between GT/RT if one timing method is missing)
      const allCustomKeys = new Set([...Object.keys(customSplitTimesGT), ...Object.keys(customSplitTimesRT)]);
      allCustomKeys.forEach(cName => {
        const rawGT = customSplitTimesGT[cName] || [];
        const rawRT = customSplitTimesRT[cName] || [];
        const hasGT = rawGT.some(t => t !== null && t > 0);
        const hasRT = rawRT.some(t => t !== null && t > 0);

        // Sanitize with fallback to PB times, cross-filling if one method is empty
        const sanGT = sanitizeComparisonTimes(hasGT ? rawGT : (hasRT ? rawRT : []), comparisonTimesGT);
        const sanRT = sanitizeComparisonTimes(hasRT ? rawRT : (hasGT ? rawGT : []), comparisonTimesRT);

        comparisonsDataGT[cName] = sanGT;
        comparisonsDataRT[cName] = sanRT;
        if (!comparisonsList.includes(cName)) comparisonsList.push(cName);
      });

      // Auto-detect timing method from the splits file:
      // If splits have GameTime recorded (e.g. PC speedruns with load remover), default to GameTime.
      // If no GameTime at all (e.g. console speedruns), default to RealTime.
      const hasAnyGameTime = comparisonTimesGT.some(t => t !== null && t > 0) || 
                             bestSegmentTimesGT.some(t => t !== null && t > 0);
      const isManualMethod = (localStorage.getItem("livesplit_timing_method_manual") === "true");
      if (!isManualMethod) {
        currentTimingMethod = hasAnyGameTime ? "GameTime" : "RealTime";
        localStorage.setItem("livesplit_timing_method", currentTimingMethod);
      } else {
        const savedMethod = localStorage.getItem("livesplit_timing_method");
        if (savedMethod === "RealTime" || savedMethod === "GameTime") {
          currentTimingMethod = savedMethod;
        } else {
          currentTimingMethod = hasAnyGameTime ? "GameTime" : "RealTime";
        }
      }

      // Cache raw LSS and parsed data
      baselineBestSegmentTimesGT = [...bestSegmentTimesGT];
      baselineBestSegmentTimesRT = [...bestSegmentTimesRT];
      localStorage.setItem("livesplit_baseline_golds_gt", JSON.stringify(baselineBestSegmentTimesGT));
      localStorage.setItem("livesplit_baseline_golds_rt", JSON.stringify(baselineBestSegmentTimesRT));
      localStorage.setItem("livesplit_raw_lss", xmlText);
      localStorage.setItem("livesplit_segments", JSON.stringify(splitsList));
      localStorage.setItem("livesplit_targets_gt", JSON.stringify(comparisonTimesGT));
      localStorage.setItem("livesplit_targets_rt", JSON.stringify(comparisonTimesRT));
      localStorage.setItem("livesplit_golds_gt", JSON.stringify(bestSegmentTimesGT));
      localStorage.setItem("livesplit_golds_rt", JSON.stringify(bestSegmentTimesRT));
      localStorage.setItem("livesplit_comparisons_list", JSON.stringify(comparisonsList));
      localStorage.setItem("livesplit_comparisons_gt", JSON.stringify(comparisonsDataGT));
      localStorage.setItem("livesplit_comparisons_rt", JSON.stringify(comparisonsDataRT));

      updateGoldBadge();
      applyActiveComparison(currentComparison, false, false);
      if (!isNewDrop) {
        loadInRunState();
      }
      renderTrack();
      const dropDesc = document.getElementById("dropzone-desc");
      if (dropDesc) {
        const gName = game || localStorage.getItem("livesplit_game") || "";
        dropDesc.innerText = `Active: ${gName ? gName + " • " : ""}${segments.length} splits loaded ✓`;
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
    const isEnabled = cachedEnableGolds;
    badge.innerText = isEnabled ? "Golds: ON" : "Golds: OFF";
    badge.style.color = isEnabled ? "#facc15" : "rgba(148, 163, 184, 0.7)";
  }
}

function toggleGoldSegments() {
  const current = (localStorage.getItem("livesplit_enable_golds") !== "false");
  const nextVal = (!current) ? "true" : "false";
  localStorage.setItem("livesplit_enable_golds", nextVal);
  cachedEnableGolds = (nextVal !== "false");
  updateGoldBadge();
}

function setTimerDisplayMode(mode, focusMethod) {
  if (mode !== "gametime" && mode !== "realtime" && mode !== "both") {
    mode = "both";
  }
  timerDisplayMode = mode;
  localStorage.setItem("livesplit_timer_display_mode", mode);
  localStorage.setItem("livesplit_timing_method_manual", "true");

  if (focusMethod === "GameTime" || focusMethod === "RealTime") {
    currentTimingMethod = focusMethod;
    localStorage.setItem("livesplit_timing_method", focusMethod);
  } else if (mode === "gametime") {
    currentTimingMethod = "GameTime";
    localStorage.setItem("livesplit_timing_method", "GameTime");
  } else if (mode === "realtime") {
    currentTimingMethod = "RealTime";
    localStorage.setItem("livesplit_timing_method", "RealTime");
  } else {
    // mode === "both" without explicit focus: preserve active or saved method
    const savedMethod = localStorage.getItem("livesplit_timing_method");
    if (savedMethod === "GameTime" || savedMethod === "RealTime") {
      currentTimingMethod = savedMethod;
    }
  }

  applyActiveTimingMethod(currentTimingMethod);
  updateTimerDisplayHierarchy();
  updateTimingMethodBadge();

  // Sync modal segmented controls if open
  document.querySelectorAll("#ctrl-timer-display .seg-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-val") === mode);
  });
  document.querySelectorAll("#ctrl-timer-focus .seg-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-val") === currentTimingMethod);
  });
  const rowTimerFocus = document.getElementById("row-timer-focus");
  if (rowTimerFocus) {
    rowTimerFocus.style.display = (mode === "both") ? "flex" : "none";
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    if (currentTimingMethod === "GameTime") ws.send("switchto gametime");
    else if (currentTimingMethod === "RealTime") ws.send("switchto realtime");
  }
}

function setTimingMethodFocus(method) {
  if (method !== "GameTime" && method !== "RealTime") return;
  localStorage.setItem("livesplit_timing_method_manual", "true");
  localStorage.setItem("livesplit_timing_method", method);
  currentTimingMethod = method;

  // If a single timer is active and user chooses opposite method, expand to both
  if (timerDisplayMode === "gametime" && method === "RealTime") {
    timerDisplayMode = "both";
    localStorage.setItem("livesplit_timer_display_mode", "both");
  } else if (timerDisplayMode === "realtime" && method === "GameTime") {
    timerDisplayMode = "both";
    localStorage.setItem("livesplit_timer_display_mode", "both");
  }

  applyActiveTimingMethod(currentTimingMethod);
  updateTimerDisplayHierarchy();
  updateTimingMethodBadge();

  // Sync modal controls
  document.querySelectorAll("#ctrl-timer-display .seg-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-val") === timerDisplayMode);
  });
  document.querySelectorAll("#ctrl-timer-focus .seg-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-val") === currentTimingMethod);
  });

  if (ws && ws.readyState === WebSocket.OPEN) {
    if (method === "GameTime") ws.send("switchto gametime");
    else if (method === "RealTime") ws.send("switchto realtime");
  }
}

function toggleTimingMethod() {
  // Cycle across all 4 logical states:
  // 1. Time: Game (IGT only)
  // 2. Time: Real (RTA only)
  // 3. Time: Both (Game primary)
  // 4. Time: Both (Real primary)
  if (timerDisplayMode === "gametime") {
    setTimerDisplayMode("realtime", "RealTime");
  } else if (timerDisplayMode === "realtime") {
    setTimerDisplayMode("both", "GameTime");
  } else if (timerDisplayMode === "both" && currentTimingMethod === "GameTime") {
    setTimerDisplayMode("both", "RealTime");
  } else {
    setTimerDisplayMode("gametime", "GameTime");
  }
}

function loadCachedSplits() {
  cachedEnableGolds = (localStorage.getItem("livesplit_enable_golds") !== "false");
  const savedTimerMode = localStorage.getItem("livesplit_timer_display_mode");
  const params = new URLSearchParams(window.location.search);
  const urlTimer = params.get("timer") || params.get("time");
  if (urlTimer && ["gametime", "realtime", "both"].includes(urlTimer.toLowerCase())) {
    timerDisplayMode = urlTimer.toLowerCase();
  } else if (savedTimerMode && ["gametime", "realtime", "both"].includes(savedTimerMode)) {
    timerDisplayMode = savedTimerMode;
  }

  const isManualMethod = (localStorage.getItem("livesplit_timing_method_manual") === "true");
  const savedMethod = localStorage.getItem("livesplit_timing_method");
  if (isManualMethod && (savedMethod === "RealTime" || savedMethod === "GameTime")) {
    currentTimingMethod = savedMethod;
  } else if (timerDisplayMode === "gametime") {
    currentTimingMethod = "GameTime";
  } else if (timerDisplayMode === "realtime") {
    currentTimingMethod = "RealTime";
  }

  const savedComp = localStorage.getItem("livesplit_current_comparison");
  if (savedComp) {
    currentComparison = savedComp;
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
      splitsList = JSON.parse(cachedSegments);
      comparisonTimesGT = JSON.parse(localStorage.getItem("livesplit_targets_gt") || "[]");
      comparisonTimesRT = JSON.parse(localStorage.getItem("livesplit_targets_rt") || "[]");
      bestSegmentTimesGT = JSON.parse(localStorage.getItem("livesplit_golds_gt") || "[]");
      bestSegmentTimesRT = JSON.parse(localStorage.getItem("livesplit_golds_rt") || "[]");
      
      const cachedBaseGT = localStorage.getItem("livesplit_baseline_golds_gt");
      const cachedBaseRT = localStorage.getItem("livesplit_baseline_golds_rt");
      if (cachedBaseGT && cachedBaseRT) {
        baselineBestSegmentTimesGT = JSON.parse(cachedBaseGT);
        baselineBestSegmentTimesRT = JSON.parse(cachedBaseRT);
      } else {
        baselineBestSegmentTimesGT = [...bestSegmentTimesGT];
        baselineBestSegmentTimesRT = [...bestSegmentTimesRT];
      }

      const cachedCompsList = localStorage.getItem("livesplit_comparisons_list");
      if (cachedCompsList) comparisonsList = JSON.parse(cachedCompsList);
      const cachedCompsGT = localStorage.getItem("livesplit_comparisons_gt");
      if (cachedCompsGT) comparisonsDataGT = JSON.parse(cachedCompsGT);
      const cachedCompsRT = localStorage.getItem("livesplit_comparisons_rt");
      if (cachedCompsRT) comparisonsDataRT = JSON.parse(cachedCompsRT);

      if (!comparisonsDataGT["Personal Best"]) comparisonsDataGT["Personal Best"] = [...comparisonTimesGT];
      if (!comparisonsDataRT["Personal Best"]) comparisonsDataRT["Personal Best"] = [...comparisonTimesRT];

      // Cross-fill and sanitize custom comparisons
      const allCachedCustom = new Set([...Object.keys(comparisonsDataGT), ...Object.keys(comparisonsDataRT)]);
      allCachedCustom.forEach(cName => {
        const cGT = comparisonsDataGT[cName];
        const cRT = comparisonsDataRT[cName];
        const hasGT = cGT && cGT.some(t => t !== null && t > 0);
        const hasRT = cRT && cRT.some(t => t !== null && t > 0);
        if (hasGT && !hasRT) comparisonsDataRT[cName] = sanitizeComparisonTimes(cGT, comparisonTimesRT);
        if (hasRT && !hasGT) comparisonsDataGT[cName] = sanitizeComparisonTimes(cRT, comparisonTimesGT);
      });

      const hasAnyGameTime = comparisonTimesGT.some(t => t !== null && t > 0) || 
                             bestSegmentTimesGT.some(t => t !== null && t > 0);
      const isManualMethod = (localStorage.getItem("livesplit_timing_method_manual") === "true");
      if (!isManualMethod) {
        currentTimingMethod = hasAnyGameTime ? "GameTime" : "RealTime";
        localStorage.setItem("livesplit_timing_method", currentTimingMethod);
      }
      applyActiveTimingMethod(currentTimingMethod);

      updateGoldBadge();
      applyActiveComparison(currentComparison, false, false);
      loadInRunState();
      renderTrack();
      const dropDesc = document.getElementById("dropzone-desc");
      if (dropDesc && splitsList.length > 0) {
        const gName = localStorage.getItem("livesplit_game") || "";
        dropDesc.innerText = `Active: ${gName ? gName + " • " : ""}${splitsList.length} splits loaded ✓`;
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
  splitsList = [...DEFAULT_SPLITS];
  comparisonTimesGT = [...DEFAULT_TARGETS];
  comparisonTimesRT = [...DEFAULT_TARGETS];
  bestSegmentTimesGT = [...DEFAULT_BESTS];
  bestSegmentTimesRT = [...DEFAULT_BESTS];
  baselineBestSegmentTimesGT = [...DEFAULT_BESTS];
  baselineBestSegmentTimesRT = [...DEFAULT_BESTS];
  initDefaultComparisons();

  updateGoldBadge();
  applyActiveComparison(currentComparison, false, false);
  loadInRunState();
  renderTrack();
  if (window.hudLayout && window.hudLayout.syncTrackModalUI) {
    window.hudLayout.syncTrackModalUI();
  }
}

// ============================================================
// 7. LIVESPLIT SERVER CLIENT & SEQUENTIAL COMMAND QUEUE
// ============================================================
function sendCommand(cmd, timeoutMs = 400, isProbe = false) {
  const execute = () => new Promise((resolve) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      resolve(null);
      return;
    }

    let timer = setTimeout(() => {
      inflightResolver = null;
      if (!isProbe) {
        console.warn(`LiveSplit command "${cmd}" timed out after ${timeoutMs}ms. Resetting WebSocket to prevent stream desynchronization.`);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      }
      resolve(null);
    }, timeoutMs);

    inflightResolver = (res) => {
      clearTimeout(timer);
      resolve(res);
    };

    try {
      ws.send(cmd.trim());
    } catch (e) {
      clearTimeout(timer);
      inflightResolver = null;
      resolve(null);
    }
  });

  commandQueue = commandQueue.then(execute, execute);
  return commandQueue;
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
// ============================================================
function renderTrack() {
  if (liveElementCache) liveElementCache.invalidate();
  nodeThresholdCache.clear();
  const track = document.getElementById("track");
  track.innerHTML = "";

  // 1. Initial Start Node
  const startItem = document.createElement("div");
  startItem.className = "split-item origin-node completed";
  if (currentIndex >= 0) {
    startItem.classList.add("active");
  }
  startItem.id = "node-start";

  const startDelta = document.createElement("div");
  startDelta.className = "split-delta";
  startDelta.innerHTML = `<span class="split-time-val target-time">0:00</span>`;

  const startName = document.createElement("div");
  startName.className = "split-name";
  startName.innerText = "Start";

  const startDot = document.createElement("div");
  startDot.className = "dot";

  startItem.appendChild(startDelta);
  startItem.appendChild(startName);
  startItem.appendChild(startDot);
  track.appendChild(startItem);

  // 2. All Splits
  splitsList.forEach((name, i) => {
    const item = document.createElement("div");
    item.className = "split-item";
    item.id = `item-${i}`;

    const segBg = document.createElement("div");
    segBg.className = "segment-bar-bg";

    const segFill = document.createElement("div");
    segFill.className = "segment-bar-fill";
    segFill.id = `fill-${i}`;
    segBg.appendChild(segFill);

    const discEl = document.createElement("div");
    discEl.className = "discontinuity-break";
    discEl.title = "Hidden intermediate splits";
    discEl.innerHTML = `<span class="disc-slash"></span><span class="disc-slash"></span>`;
    segBg.appendChild(discEl);

    const deltaEl = document.createElement("div");
    deltaEl.className = "split-delta";
    deltaEl.id = `delta-${i}`;
    const targetVal = formatTargetTime(comparisonTimes[i]);
    deltaEl.innerHTML = `<span class="split-delta-val" id="delta-val-${i}"></span><span class="split-time-val target-time" id="time-val-${i}">${targetVal || "-"}</span>`;

    const nameEl = document.createElement("div");
    nameEl.className = "split-name";
    nameEl.innerText = name;

    const dot = document.createElement("div");
    dot.className = "dot";

    item.appendChild(segBg);
    item.appendChild(deltaEl);
    item.appendChild(nameEl);
    item.appendChild(dot);
    track.appendChild(item);
  });

  // Inject or preserve live ghost marker inside #track
  let ghostMarker = document.getElementById("ghost-marker");
  if (!ghostMarker) {
    ghostMarker = document.createElement("div");
    ghostMarker.className = "ghost-marker";
    ghostMarker.id = "ghost-marker";
  }
  ghostMarker.style.display = "none";
  ghostMarker.innerHTML = `
    <div class="ghost-icon-wrap"><span id="ghost-icon">🏆</span></div>
    <div class="ghost-needle"></div>
  `;
  track.appendChild(ghostMarker);
  track.style.setProperty("--ghost-opacity", ghostOpacity);

  updateTrackDensityAndAngle();
  updateTrackStatus(currentIndex);
}

function getVisibleSplitsCapacity() {
  const splitPref = localStorage.getItem("livesplit_visible_splits") || "auto";
  if (splitPref !== "auto" && splitPref !== "all") {
    const num = parseInt(splitPref, 10);
    if (!isNaN(num) && num > 0) return num;
  }
  const viewport = document.getElementById("track-viewport");
  const track = document.getElementById("track");
  const trackComp = document.getElementById("hud-comp-track");
  const isVertical = track?.classList.contains("vertical");
  const isDockedVertical = isVertical && (trackComp?.classList.contains("docked-left") || trackComp?.classList.contains("docked-right"));
  const isDockedHorizontal = !isVertical && trackComp?.classList.contains("docked-bottom");

  const viewportW = (isDockedHorizontal && (!viewport || viewport.clientWidth < 500))
    ? (window.innerWidth || 1920)
    : (viewport?.clientWidth || window.innerWidth || 1920);

  const viewportH = (isDockedVertical && (!viewport || viewport.clientHeight < 300))
    ? (window.innerHeight || 1080)
    : (viewport?.clientHeight || window.innerHeight || 800);

  const pLeft = 24;
  const pRight = 24;
  const availW = Math.max(300, viewportW - (pLeft + pRight));
  return isVertical 
    ? Math.max(4, Math.floor((viewportH - 40) / 64)) 
    : Math.max(4, Math.floor(availW / 125));
}

function isTrackWindowed() {
  const N = splitsList.length;
  if (N <= 1) return false;
  const alwaysShowLast = localStorage.getItem("livesplit_always_show_last_split") !== "false";
  const splitPref = localStorage.getItem("livesplit_visible_splits") || "auto";
  if (!alwaysShowLast || splitPref === "all") return false;

  const V = getVisibleSplitsCapacity();
  return (N + 1 > V);
}

function getDefaultTrackWindowPosition(idx, N, V, W) {
  const half = Math.floor((W - 1) / 2);
  const idealStart = idx - half;
  const maxK = Math.max(0, N - V + 1);

  if (idealStart + (W - 1) >= N - 1) {
    return maxK;
  }
  if (idealStart <= -1) {
    return 0;
  }
  return Math.max(0, Math.min(maxK, idealStart + 1));
}

function shiftTrackWindow(direction) {
  const N = splitsList.length;
  if (N <= 1) return false;
  if (!isTrackWindowed()) return false;

  const V = getVisibleSplitsCapacity();
  const W = Math.max(2, V - 1);
  const maxK = Math.max(0, N - V + 1);
  const defaultK = getDefaultTrackWindowPosition(currentIndex, N, V, W);
  const currentK = Math.max(0, Math.min(maxK, defaultK + trackManualScrollOffset));
  const newK = Math.max(0, Math.min(maxK, currentK + direction));

  if (newK !== currentK) {
    trackManualScrollOffset = newK - defaultK;
    updateTrackWindow(currentIndex);
    if (lastElapsedSec > 0) {
      updateGhostRunner(lastElapsedSec);
    }
    return true;
  }
  return false;
}

function updateTrackWindow(idx) {
  const N = splitsList.length;
  const nodeStart = document.getElementById("node-start");
  if (N <= 1) {
    if (nodeStart) {
      nodeStart.classList.remove("is-omitted", "first-visible-node");
    }
    const item0 = document.getElementById("item-0");
    if (item0) {
      item0.classList.remove("is-omitted", "has-discontinuity", "first-visible-node");
    }
    return false;
  }

  const alwaysShowLast = localStorage.getItem("livesplit_always_show_last_split") !== "false";
  const splitPref = localStorage.getItem("livesplit_visible_splits") || "auto";

  if (!alwaysShowLast || splitPref === "all") {
    // Show all splits (continuous linear track)
    if (nodeStart) {
      nodeStart.classList.remove("is-omitted", "first-visible-node");
    }
    for (let i = 0; i < N; i++) {
      const el = document.getElementById(`item-${i}`);
      if (el) el.classList.remove("is-omitted", "has-discontinuity", "first-visible-node");
    }
    return false;
  }

  const V = getVisibleSplitsCapacity();

  // If total nodes (Start node + all N splits = N + 1) fit within V capacity:
  if (N + 1 <= V) {
    if (nodeStart) {
      nodeStart.classList.remove("is-omitted", "first-visible-node");
    }
    for (let i = 0; i < N; i++) {
      const el = document.getElementById(`item-${i}`);
      if (el) el.classList.remove("is-omitted", "has-discontinuity", "first-visible-node");
    }
    return false;
  }

  // N + 1 > V: Pin the final split (N - 1) in the last visible slot.
  // Sliding portion has W = V - 1 slots.
  const W = Math.max(2, V - 1);
  const maxK = Math.max(0, N - V + 1);
  const defaultK = getDefaultTrackWindowPosition(idx, N, V, W);
  const k = Math.max(0, Math.min(maxK, defaultK + trackManualScrollOffset));

  let startNodeVisible = false;
  let windowStart = 0;
  let windowEnd = 0;
  let hasDiscontinuity = true;

  if (k === 0) {
    // Earliest view: Start node is visible in slot 0.
    // Takes 1 slot, so W - 1 splits are visible in slots 1..(W - 1).
    startNodeVisible = true;
    windowStart = 0;
    windowEnd = Math.max(0, W - 2);
    hasDiscontinuity = (windowEnd < N - 1);
  } else if (k >= maxK) {
    // Finale view: active window encompasses the final split.
    // Display the last V splits continuously with no discontinuity break!
    hasDiscontinuity = false;
    startNodeVisible = false;
    windowStart = Math.max(0, N - V);
    windowEnd = N - 1;
  } else {
    // Mid-run: Start node is omitted.
    startNodeVisible = false;
    windowStart = k - 1;
    windowEnd = windowStart + (W - 1);
    hasDiscontinuity = (windowEnd < N - 1);
  }

  // Update node-start visibility
  if (nodeStart) {
    if (startNodeVisible) {
      nodeStart.classList.remove("is-omitted");
    } else {
      nodeStart.classList.add("is-omitted");
    }
  }

  // Update splits visibility
  for (let i = 0; i < N; i++) {
    const el = document.getElementById(`item-${i}`);
    if (!el) continue;

    if (i >= windowStart && i <= windowEnd) {
      el.classList.remove("is-omitted");
      el.classList.remove("has-discontinuity");
      el.classList.toggle("first-visible-node", !startNodeVisible && i === windowStart);
    } else if (i === N - 1) {
      el.classList.remove("is-omitted");
      el.classList.remove("first-visible-node");
      if (hasDiscontinuity) {
        el.classList.add("has-discontinuity");
      } else {
        el.classList.remove("has-discontinuity");
      }
    } else {
      el.classList.add("is-omitted");
      el.classList.remove("has-discontinuity", "first-visible-node");
    }
  }

  return true;
}

function updateTrackStatus(idx) {
  if (idx !== currentIndex) {
    trackManualScrollOffset = 0;
  }
  currentIndex = idx;
  const nodeStart = document.getElementById("node-start");
  if (nodeStart) {
    nodeStart.classList.toggle("active", idx >= 0);
  }

  const isVertical = document.getElementById("track")?.classList.contains("vertical");

  for (let i = 0; i < splitsList.length; i++) {
    const item = document.getElementById(`item-${i}`);
    const fill = document.getElementById(`fill-${i}`);
    if (!item) continue;

    item.classList.remove("current");

    if (idx >= 0) {
      if (i < idx) {
        item.classList.add("completed");
        if (lockedDeltas[i]) {
          const { deltaInfo, stateClass, splitTimeSec } = lockedDeltas[i];
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
        if (!lockedDeltas[i]) {
          const deltaSpan = document.getElementById(`delta-val-${i}`);
          if (deltaSpan) {
            deltaSpan.innerText = "";
            deltaSpan.className = "split-delta-val";
          }
        }
      } else {
        item.classList.remove("completed");
        if (fill) {
          fill.style.width = isVertical ? "100%" : "0%";
          fill.style.height = isVertical ? "0%" : "100%";
          fill.className = "segment-bar-fill";
          if (fill.parentElement) fill.parentElement.classList.remove("overdue");
        }
        const deltaSpan = document.getElementById(`delta-val-${i}`);
        if (deltaSpan) {
          deltaSpan.innerText = "";
          deltaSpan.className = "split-delta-val";
        }
      }
    } else {
      item.classList.remove(...ALL_SPLIT_STATE_CLASSES);
      if (fill) {
        fill.style.width = isVertical ? "100%" : "0%";
        fill.style.height = isVertical ? "0%" : "100%";
        fill.className = "segment-bar-fill";
        if (fill.parentElement) fill.parentElement.classList.remove("overdue");
      }
      const deltaSpan = document.getElementById(`delta-val-${i}`);
      const timeSpan = document.getElementById(`time-val-${i}`);
      if (deltaSpan) {
        deltaSpan.innerText = "";
        deltaSpan.className = "split-delta-val";
      }
      if (timeSpan) {
        const targetVal = formatTargetTime(comparisonTimes[i]);
        timeSpan.innerText = targetVal || "-";
        timeSpan.className = "split-time-val target-time";
      }
    }
  }

  // Update sliding window & discontinuity after status classes are updated
  const isWindowed = updateTrackWindow(idx);

  const viewport = document.getElementById("track-viewport");
  if (viewport && typeof viewport.scrollTo === "function") {
    if (isWindowed) {
      viewport.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
    } else if (idx < 0) {
      if (isVertical) {
        viewport.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        viewport.scrollTo({ left: 0, behavior: 'smooth' });
      }
    } else {
      const activeItem = document.getElementById(`item-${idx}`);
      if (activeItem) {
        if (isVertical) {
          const scrollTarget = activeItem.offsetTop + (activeItem.offsetHeight / 2) - (viewport.clientHeight / 2);
          viewport.scrollTo({ top: Math.max(0, scrollTarget), behavior: 'smooth' });
        } else {
          const scrollTarget = activeItem.offsetLeft + (activeItem.offsetWidth / 2) - (viewport.clientWidth / 2);
          viewport.scrollTo({ left: Math.max(0, scrollTarget), behavior: 'smooth' });
        }
      }
    }
  }
}

// ============================================================
// 9. HIGH-FREQUENCY LIVE PROGRESS & DELTA REVEAL (60 FPS)
// ============================================================
let liveElementCache = null;
function getLiveElements(idx) {
  if (!liveElementCache && window.LiveSplit?.TrackRenderer?.createLiveElementCache) {
    liveElementCache = window.LiveSplit.TrackRenderer.createLiveElementCache();
  }
  if (liveElementCache) {
    return liveElementCache.getElements(idx);
  }
  return {
    fill: document.getElementById(`fill-${idx}`),
    deltaSpan: document.getElementById(`delta-val-${idx}`),
    isVertical: document.getElementById("track")?.classList.contains("vertical")
  };
}

function updateLiveSegmentProgress(currentSec) {
  if (currentIndex < 0 || currentIndex >= splitsList.length || currentSec === null) return;

  const { fill, deltaSpan, isVertical } = getLiveElements(currentIndex);

  const prevTargetSec = (currentIndex > 0 && comparisonTimes[currentIndex - 1] !== null)
    ? comparisonTimes[currentIndex - 1]
    : 0;

  const currentTargetSec = comparisonTimes[currentIndex];
  if (!currentTargetSec || currentTargetSec <= prevTargetSec) return;

  const expectedDuration = currentTargetSec - prevTargetSec;
  const elapsedInSegment = Math.max(0, currentSec - lastSplitRecordedSec);

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
    const isGoldsEnabled = cachedEnableGolds;
    const bestSec = (currentIndex < bestSegmentTimes.length && bestSegmentTimes[currentIndex] !== null && bestSegmentTimes[currentIndex] > 0)
      ? bestSegmentTimes[currentIndex]
      : null;

    const liveDeltaSec = currentSec - currentTargetSec;
    const deltaChange = liveDeltaSec - previousDeltaSeconds;
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
// 10. LIVE GHOST RUNNER ENGINE & MULTI-GHOST MARKERS
// ============================================================
let activeGhostComparisons = loadActiveGhostComparisons();
let ghostComparison = activeGhostComparisons.filter(g => g !== "off")[0] || "off";
let ghostOpacity = parseFloat(localStorage.getItem("livesplit_ghost_opacity") || "85") / 100;

function loadActiveGhostComparisons() {
  const savedMulti = localStorage.getItem("livesplit_active_ghosts");
  if (savedMulti) {
    try {
      const parsed = JSON.parse(savedMulti);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      if (Array.isArray(parsed) && parsed.length === 0) return ["off"];
    } catch (e) {}
  }
  const single = localStorage.getItem("livesplit_ghost_comparison") || "off";
  return single === "off" ? ["off"] : [single];
}

function saveActiveGhostComparisons() {
  localStorage.setItem("livesplit_active_ghosts", JSON.stringify(activeGhostComparisons));
  const primary = activeGhostComparisons.filter(g => g !== "off")[0] || "off";
  ghostComparison = primary;
  localStorage.setItem("livesplit_ghost_comparison", primary);
}

function getGhostComparisonInfo(targetGhost = null) {
  const gChoice = targetGhost || ghostComparison;
  if (!gChoice || gChoice === "off") return null;

  const isRT = (currentTimingMethod === "RealTime");
  const compData = isRT ? comparisonsDataRT : comparisonsDataGT;
  const altData = isRT ? comparisonsDataGT : comparisonsDataRT;
  const compKeys = Object.keys(compData);
  const altKeys = Object.keys(altData);
  const fallbackTimes = isRT ? comparisonTimesRT : comparisonTimesGT;

  const lowGhost = gChoice.toLowerCase().trim();

  // 1. World Record match (wr / world record)
  const isWRMatch = (lowGhost === "wr" || lowGhost.includes("world record"));
  if (isWRMatch) {
    const wrKey = compKeys.find(k => k.toLowerCase().includes("world record") || k.toLowerCase() === "wr");
    const altWrKey = altKeys.find(k => k.toLowerCase().includes("world record") || k.toLowerCase() === "wr");

    const candTimes = (wrKey && compData[wrKey] && compData[wrKey].some(t => t !== null && t > 0)) ? compData[wrKey] : null;
    const altTimes = (altWrKey && altData[altWrKey] && altData[altWrKey].some(t => t !== null && t > 0)) ? altData[altWrKey] : null;

    if (candTimes) {
      if (altTimes && fallbackTimes && fallbackTimes.length > 0 && fallbackTimes[0] > 0) {
        const curRatio = Math.abs(candTimes[0] - fallbackTimes[0]) / fallbackTimes[0];
        const altRatio = Math.abs(altTimes[0] - fallbackTimes[0]) / fallbackTimes[0];
        if (curRatio > 1.5 && altRatio < 0.5) {
          return { id: "wr", name: altWrKey, icon: "🏆", color: "#facc15", times: sanitizeComparisonTimes(altTimes, fallbackTimes) };
        }
      }
      return { id: "wr", name: wrKey, icon: "🏆", color: "#facc15", times: sanitizeComparisonTimes(candTimes, fallbackTimes) };
    }

    if (altTimes) {
      return { id: "wr", name: altWrKey, icon: "🏆", color: "#facc15", times: sanitizeComparisonTimes(altTimes, fallbackTimes) };
    }

    // Fallback if no explicit WR track in .lss: use Best Segments / Sum of Best pace
    if (compData["Best Segments"] && compData["Best Segments"].some(t => t !== null && t > 0)) {
      return { id: "wr", name: "Best Segments (WR Fallback)", icon: "🏆", color: "#facc15", times: sanitizeComparisonTimes(compData["Best Segments"], fallbackTimes) };
    }
    return { id: "wr", name: "Personal Best", icon: "🏆", color: "#facc15", times: sanitizeComparisonTimes(compData["Personal Best"] || fallbackTimes, fallbackTimes) };
  }

  // 2. Personal Best (pb)
  if (lowGhost === "pb" || lowGhost === "personal best") {
    return { id: "pb", name: "Personal Best", icon: "🥈", color: "#38bdf8", times: sanitizeComparisonTimes(compData["Personal Best"] || fallbackTimes, fallbackTimes) };
  }

  // 3. Best Segments (best)
  if (lowGhost === "best" || lowGhost === "best segments") {
    return { id: "best", name: "Best Segments", icon: "⭐", color: "#eab308", times: sanitizeComparisonTimes(compData["Best Segments"] || fallbackTimes, fallbackTimes) };
  }

  // 4. Average Segments (average)
  if (lowGhost === "average" || lowGhost === "average segments") {
    return { id: "average", name: "Average Segments", icon: "📊", color: "#a78bfa", times: sanitizeComparisonTimes(compData["Average Segments"] || fallbackTimes, fallbackTimes) };
  }

  // 5. Worst Segments (worst)
  if (lowGhost === "worst" || lowGhost === "worst segments") {
    return { id: "worst", name: "Worst Segments", icon: "🐢", color: "#f87171", times: sanitizeComparisonTimes(compData["Worst Segments"] || fallbackTimes, fallbackTimes) };
  }

  // 6. Direct match with any custom comparison by name
  if (compData[gChoice] && compData[gChoice].some(t => t !== null && t > 0)) {
    const cand = compData[gChoice];
    const alt = altData[gChoice];
    if (alt && alt.some(t => t !== null && t > 0) && fallbackTimes && fallbackTimes.length > 0 && fallbackTimes[0] > 0) {
      const curRatio = Math.abs(cand[0] - fallbackTimes[0]) / fallbackTimes[0];
      const altRatio = Math.abs(alt[0] - fallbackTimes[0]) / fallbackTimes[0];
      if (curRatio > 1.5 && altRatio < 0.5) {
        return { id: gChoice, name: gChoice, icon: "👤", color: "#06b6d4", times: sanitizeComparisonTimes(alt, fallbackTimes) };
      }
    }
    return { id: gChoice, name: gChoice, icon: "👤", color: "#06b6d4", times: sanitizeComparisonTimes(cand, fallbackTimes) };
  }
  if (altData[gChoice] && altData[gChoice].some(t => t !== null && t > 0)) {
    return { id: gChoice, name: gChoice, icon: "👤", color: "#06b6d4", times: sanitizeComparisonTimes(altData[gChoice], fallbackTimes) };
  }

  return null;
}

function calculateGhostProgress(currentSec, times) {
  if (!times || !Array.isArray(times) || times.length === 0 || currentSec === null || currentSec <= 0) {
    return { segIdx: 0, ratio: 0, isFinished: false, targetSec: 0 };
  }

  // Find the last valid positive target time
  let lastValidIdx = times.length - 1;
  while (lastValidIdx >= 0 && (times[lastValidIdx] === null || times[lastValidIdx] === undefined || times[lastValidIdx] <= 0)) {
    lastValidIdx--;
  }

  if (lastValidIdx < 0) {
    return { segIdx: 0, ratio: 0, isFinished: false, targetSec: 0 };
  }

  const lastTime = times[lastValidIdx];
  if (currentSec >= lastTime) {
    return { segIdx: lastValidIdx, ratio: 1.0, isFinished: true, targetSec: lastTime };
  }

  for (let i = 0; i <= lastValidIdx; i++) {
    const tNext = times[i];
    if (tNext === null || tNext === undefined || tNext <= 0) continue;

    // Search backwards for the previous positive target time
    let tPrev = 0;
    let pIdx = i - 1;
    while (pIdx >= 0) {
      if (times[pIdx] !== null && times[pIdx] !== undefined && times[pIdx] > 0) {
        tPrev = times[pIdx];
        break;
      }
      pIdx--;
    }

    if (currentSec < tNext) {
      const dur = tNext - tPrev;
      const ratio = (dur > 0) ? Math.max(0, Math.min(1.0, (currentSec - tPrev) / dur)) : 0;
      return { segIdx: i, ratio, isFinished: false, targetSec: tNext };
    }
  }

  return { segIdx: lastValidIdx, ratio: 1.0, isFinished: true, targetSec: lastTime };
}

function getNodeTextThreshold(nodeEl, isNext = false) {
  if (!nodeEl) return 45;
  const cacheKey = (nodeEl.id || "start") + (isNext ? "_next" : "_prev");
  if (nodeThresholdCache.has(cacheKey)) {
    return nodeThresholdCache.get(cacheKey);
  }

  const track = document.getElementById("track");
  const isAngled = track && track.classList.contains("angled-text");
  const nameEl = nodeEl.querySelector(".split-name");
  const deltaEl = nodeEl.querySelector(".split-delta");
  const nameW = nameEl ? nameEl.offsetWidth : 60;
  const deltaW = deltaEl ? deltaEl.offsetWidth : 50;

  let val = 45;
  if (isAngled) {
    if (!isNext) {
      val = Math.max(45, (nameW * 0.76) + 12);
    } else {
      val = Math.max(45, (deltaW / 2) + 15);
    }
  } else {
    const maxW = Math.max(nameW, deltaW, 50);
    val = (maxW / 2) + 14;
  }

  nodeThresholdCache.set(cacheKey, val);
  return val;
}

function getOrCreateGhostMarker(ghostInfo) {
  const markerId = `ghost-marker-${ghostInfo.id}`;
  let marker = document.getElementById(markerId);
  const track = document.getElementById("track");
  if (!track) return null;

  if (!marker) {
    marker = document.createElement("div");
    marker.id = markerId;
    marker.className = `ghost-marker ghost-theme-${ghostInfo.id}`;
    marker.innerHTML = `
      <div class="ghost-icon-wrap"><span class="ghost-icon">${escapeHtml(ghostInfo.icon || "🏎️")}</span></div>
      <div class="ghost-needle"></div>
      <div class="racer-tag">${ghostInfo.name ? escapeHtml(ghostInfo.name) : ""}</div>
    `;
    track.appendChild(marker);
  } else {
    if (!track.contains(marker)) {
      track.appendChild(marker);
    }
    marker.className = `ghost-marker ghost-theme-${ghostInfo.id}`;
    const iconSpan = marker.querySelector(".ghost-icon");
    if (iconSpan) iconSpan.innerText = ghostInfo.icon;
    let tag = marker.querySelector(".racer-tag");
    if (!tag) {
      tag = document.createElement("div");
      tag.className = "racer-tag";
      marker.appendChild(tag);
    }
    tag.innerText = ghostInfo.name || "";
  }
  knownGhostMarkers.add(marker);
  return marker;
}

const raceMarkerMap = new Map();

function getOrCreateRaceMarker(racer) {
  const markerId = `ghost-marker-race-${racer.userId}`;
  let marker = raceMarkerMap.get(markerId);
  if (!marker || !document.contains(marker)) {
    marker = document.getElementById(markerId);
    if (marker) raceMarkerMap.set(markerId, marker);
  }
  const track = document.getElementById("track");
  if (!track) return null;

  const color = racer.color || "#38bdf8";
  const rawAvatar = racer.avatar || "";
  const isSafeImg = typeof rawAvatar === "string" && (
    rawAvatar.startsWith("https://") ||
    rawAvatar.startsWith("http://") ||
    rawAvatar.startsWith("data:image/")
  );
  const isLikelyUrl = typeof rawAvatar === "string" && (
    rawAvatar.includes(":") || rawAvatar.includes("/")
  );
  const fallbackIcon = rawAvatar && !isLikelyUrl ? rawAvatar : "🏎️";
  const avatarHtml = isSafeImg
    ? `<img class="racer-avatar-img" src="${escapeHtml(rawAvatar)}" alt="" />`
    : `<span class="ghost-icon racer-avatar">${escapeHtml(fallbackIcon)}</span>`;

  if (!marker) {
    marker = document.createElement("div");
    marker.id = markerId;
    marker.className = "ghost-marker race-competitor";
    marker.style.setProperty("--racer-color", color);
    marker.innerHTML = `
      <div class="ghost-icon-wrap racer-avatar-wrap">${avatarHtml}</div>
      <div class="ghost-needle racer-needle"></div>
      <div class="racer-tag">${escapeHtml(racer.username || "")}</div>
    `;
    track.appendChild(marker);
    raceMarkerMap.set(markerId, marker);
  } else {
    if (!track.contains(marker)) {
      track.appendChild(marker);
    }
    marker.style.setProperty("--racer-color", color);
    const wrap = marker.querySelector(".racer-avatar-wrap");
    if (wrap) wrap.innerHTML = avatarHtml;
    const tag = marker.querySelector(".racer-tag");
    if (tag && tag.textContent !== (racer.username || "")) {
      tag.textContent = racer.username || "";
    }
  }
  if (racer.isDNF) {
    marker.classList.add("is-dnf");
  } else {
    marker.classList.remove("is-dnf");
  }
  knownGhostMarkers.add(marker);
  return marker;
}

function refreshLeaderboard() {
  if (window.LiveSplitLeaderboard && typeof window.LiveSplitLeaderboard.renderLeaderboard === "function") {
    const rc = window.LiveSplit && window.LiveSplit.RaceClient ? (window.LiveSplit.RaceClient.instance || window.LiveSplit.RaceClient) : window.LiveSplitRaceClient;
    const isSim = rc ? (typeof rc.isSimulating === "function" ? rc.isSimulating() : !!rc.isSimulating) : false;
    const isConn = rc ? (typeof rc.isConnected === "function" ? rc.isConnected() : !!rc.isConnected) : false;
    const isEditMode = window.hudLayout && typeof window.hudLayout.isEditMode === "function" ? window.hudLayout.isEditMode() : false;
    window.LiveSplitLeaderboard.renderLeaderboard(
      rc ? rc.getRankedEntrants() : [],
      isSim,
      isConn,
      isEditMode
    );
  }
}

function hideAllGhostMarkers() {
  const staticMarker = document.getElementById("ghost-marker");
  if (staticMarker) {
    staticMarker.style.display = "none";
    staticMarker.style.removeProperty("--ghost-stack-offset");
    staticMarker.style.removeProperty("--ghost-splay-x");
    staticMarker.style.removeProperty("--ghost-needle-angle");
    staticMarker.style.removeProperty("--ghost-needle-height");
    staticMarker.classList.remove("splay-left", "splay-right");
  }
  knownGhostMarkers.forEach((m) => {
    if (m) {
      m.style.display = "none";
      m.style.removeProperty("--ghost-stack-offset");
      m.style.removeProperty("--ghost-splay-x");
      m.style.removeProperty("--ghost-needle-angle");
      m.style.removeProperty("--ghost-needle-height");
      m.classList.remove("splay-left", "splay-right");
    }
  });
}

function updateGhostRunner(currentSec) {
  const edgeLeft = document.getElementById("ghost-edge-left");
  const edgeRight = document.getElementById("ghost-edge-right");
  const viewport = document.getElementById("track-viewport");
  const track = document.getElementById("track");

  if (!viewport || !track) return;

  const isVertical = track.classList.contains("vertical");

  const activeList = activeGhostComparisons.filter(g => g && g !== "off");
  const rc = window.LiveSplit && window.LiveSplit.RaceClient ? (window.LiveSplit.RaceClient.instance || window.LiveSplit.RaceClient) : window.LiveSplitRaceClient;
  const isSim = rc ? (typeof rc.isSimulating === "function" ? rc.isSimulating() : !!rc.isSimulating) : false;
  const isConn = rc ? (typeof rc.isConnected === "function" ? rc.isConnected() : !!rc.isConnected) : false;
  const isRaceActive = isSim || isConn;
  const areRacePinsOn = rc && typeof rc.areRacePinsVisible === "function" ? rc.areRacePinsVisible() : true;
  const raceEntrants = (isRaceActive && areRacePinsOn)
    ? rc.getRankedEntrants().filter(e => !e.isHost && !e.isMuted)
    : [];

  if ((activeList.length === 0 && raceEntrants.length === 0) || currentSec === null || currentSec < 0 || splitsList.length === 0) {
    hideAllGhostMarkers();
    if (edgeLeft) edgeLeft.style.display = "none";
    if (edgeRight) edgeRight.style.display = "none";
    refreshLeaderboard();
    return;
  }

  // Pre-calculate runner's current progress in segment for live delta calculations
  let runnerSegProgress = 0;
  if (currentIndex >= 0 && currentIndex < splitsList.length) {
    const curTarget = comparisonTimes[currentIndex];
    const prevTarget = (currentIndex > 0) ? (comparisonTimes[currentIndex - 1] || 0) : 0;
    const dur = curTarget ? (curTarget - prevTarget) : 0;
    const elapsedInSeg = Math.max(0, currentSec - lastSplitRecordedSec);
    runnerSegProgress = (dur > 0) ? Math.min(1.0, elapsedInSeg / dur) : 0;
  }

  const scrollOffset = isVertical ? viewport.scrollTop : viewport.scrollLeft;
  const rawSpan = isVertical ? viewport.clientHeight : viewport.clientWidth;
  const clientSpan = (rawSpan > 0) ? rawSpan : ((isVertical ? window.innerHeight : window.innerWidth) || 800);
  const visibleMin = (scrollOffset > 0) ? (scrollOffset + 10) : -20;
  const visibleMax = scrollOffset + clientSpan + 20;

  const nodeStart = document.getElementById("node-start");
  if (!nodeStart) return;

  const leftOffscreenGhosts = [];
  const rightOffscreenGhosts = [];
  const renderedMarkerIds = new Set();
  const visibleOnscreenMarkers = [];

  function getSegmentCoords(segIdx) {
    let startCoord = 0;
    let endCoord = 0;
    let prevNode = null;
    let nextNode = null;

    if (isVertical) {
      if (segIdx === 0) {
        prevNode = nodeStart;
        startCoord = nodeStart.offsetTop + (nodeStart.offsetHeight / 2);
        const item0 = document.getElementById("item-0");
        nextNode = item0;
        endCoord = item0 ? (item0.offsetTop + (item0.offsetHeight / 2)) : startCoord + 64;
      } else {
        const prevItem = document.getElementById(`item-${segIdx - 1}`);
        const currentItem = document.getElementById(`item-${segIdx}`);
        if (prevItem && currentItem) {
          if (currentItem.classList.contains("is-omitted")) {
            const finalItem = document.getElementById(`item-${splitsList.length - 1}`);
            if (finalItem && finalItem.classList.contains("has-discontinuity")) {
              const discY = finalItem.offsetTop - 32;
              startCoord = discY;
              endCoord = discY;
            } else {
              return null;
            }
          } else {
            prevNode = prevItem;
            nextNode = currentItem;
            startCoord = (prevItem.classList.contains("is-omitted") ? currentItem.offsetTop - 64 : prevItem.offsetTop) + (prevItem.offsetHeight / 2);
            endCoord = currentItem.offsetTop + (currentItem.offsetHeight / 2);
          }
        } else {
          return null;
        }
      }
    } else {
      if (segIdx === 0) {
        prevNode = nodeStart;
        startCoord = nodeStart.offsetLeft + (nodeStart.offsetWidth / 2);
        const item0 = document.getElementById("item-0");
        nextNode = item0;
        endCoord = item0 ? (item0.offsetLeft + (item0.offsetWidth / 2)) : startCoord + 220;
      } else {
        const prevItem = document.getElementById(`item-${segIdx - 1}`);
        const currentItem = document.getElementById(`item-${segIdx}`);
        if (prevItem && currentItem) {
          if (currentItem.classList.contains("is-omitted")) {
            const finalItem = document.getElementById(`item-${splitsList.length - 1}`);
            if (finalItem && finalItem.classList.contains("has-discontinuity")) {
              const discX = finalItem.offsetLeft - (finalItem.offsetWidth / 2);
              startCoord = discX;
              endCoord = discX;
            } else {
              return null;
            }
          } else {
            prevNode = prevItem;
            nextNode = currentItem;
            startCoord = (prevItem.classList.contains("is-omitted") ? currentItem.offsetLeft - 120 : prevItem.offsetLeft) + (prevItem.offsetWidth / 2);
            endCoord = currentItem.offsetLeft + (currentItem.offsetWidth / 2);
          }
        } else {
          return null;
        }
      }
    }

    return { startCoord, endCoord, prevNode, nextNode };
  }

  // 1. Render active comparison ghosts (WR, PB, Best, Avg, Worst)
  activeList.forEach((gId) => {
    const ghostInfo = getGhostComparisonInfo(gId);
    if (!ghostInfo) return;

    const marker = getOrCreateGhostMarker(ghostInfo);
    if (!marker) return;
    renderedMarkerIds.add(marker.id);

    const { segIdx, ratio } = calculateGhostProgress(currentSec, ghostInfo.times);
    const coords = getSegmentCoords(segIdx);
    if (!coords) {
      marker.style.display = "none";
      return;
    }

    const ghostCoord = coords.startCoord + ratio * (coords.endCoord - coords.startCoord);

    // Compute live delta vs this ghost
    const ghostTimes = ghostInfo.times;
    let ghostTimeAtRunnerPos = 0;
    if (currentIndex >= 0 && currentIndex < ghostTimes.length) {
      const gNext = ghostTimes[currentIndex] ?? comparisonTimes[currentIndex] ?? 0;
      const gPrev = (currentIndex === 0) ? 0 : (ghostTimes[currentIndex - 1] ?? (comparisonTimes[currentIndex - 1] || 0));
      ghostTimeAtRunnerPos = gPrev + runnerSegProgress * (gNext - gPrev);
    } else {
      ghostTimeAtRunnerPos = ghostTimes[ghostTimes.length - 1] || 0;
    }

    const liveDeltaGhost = currentSec - ghostTimeAtRunnerPos;
    const isAhead = (liveDeltaGhost <= 0);
    const deltaStr = formatDeltaSeconds(liveDeltaGhost);

    if (ghostCoord < visibleMin) {
      marker.style.display = "none";
      marker.style.removeProperty("--ghost-stack-offset");
      marker.style.removeProperty("--ghost-splay-x");
      marker.style.removeProperty("--ghost-needle-angle");
      marker.style.removeProperty("--ghost-needle-height");
      leftOffscreenGhosts.push({ ghostInfo, deltaStr, isAhead });
    } else if (ghostCoord > visibleMax) {
      marker.style.display = "none";
      marker.style.removeProperty("--ghost-stack-offset");
      marker.style.removeProperty("--ghost-splay-x");
      marker.style.removeProperty("--ghost-needle-angle");
      marker.style.removeProperty("--ghost-needle-height");
      rightOffscreenGhosts.push({ ghostInfo, deltaStr, isAhead });
    } else {
      visibleOnscreenMarkers.push({
        marker,
        coord: ghostCoord,
        coords
      });
    }
  });

  // 2. Render live race competitors (therun.gg / racetime.gg / simulation)
  function getCompetitorTrackRef(sc) {
    const s = Math.max(0, sc || 0);
    const idx = Math.floor(s);
    const rat = Math.max(0, Math.min(1.0, s - idx));
    const tP = idx > 0 ? (comparisonTimes[idx - 1] || (idx * 30)) : 0;
    const tN = (idx < comparisonTimes.length) ? (comparisonTimes[idx] || ((idx + 1) * 30)) : (tP + 30);
    return tP + rat * (tN - tP);
  }

  raceEntrants.forEach((racer) => {
    let segIdx = 0;
    let ratio = 0;
    const numSplits = splitsList.length;

    if (racer.isFinished) {
      segIdx = numSplits - 1;
      ratio = 1.0;
    } else if (racer.isDNF && typeof racer.dnfScore === "number") {
      segIdx = Math.floor(racer.dnfScore);
      ratio = racer.dnfScore - segIdx;
    } else if (racer.totalSplits > 0 && racer.totalSplits !== numSplits && typeof racer.runPercentage === "number" && racer.runPercentage > 0) {
      // Spectator mode / split count mismatch: map normalized run percentage across local progress bar
      const mappedScore = Math.max(0, Math.min(numSplits - 0.001, racer.runPercentage * numSplits));
      segIdx = Math.floor(mappedScore);
      ratio = mappedScore - segIdx;
    } else {
      segIdx = Math.floor(racer.score || 0);
      ratio = (racer.score || 0) - segIdx;
    }
    segIdx = Math.max(0, Math.min(numSplits - 1, segIdx));
    ratio = Math.max(0, Math.min(1.0, ratio));

    const coords = getSegmentCoords(segIdx);
    if (!coords) return;

    const marker = getOrCreateRaceMarker(racer);
    if (!marker) return;
    renderedMarkerIds.add(marker.id);

    const ghostCoord = coords.startCoord + ratio * (coords.endCoord - coords.startCoord);

    const hostScore = Math.max(0, currentIndex) + runnerSegProgress;
    const isAhead = (hostScore >= (racer.score || 0));

    const hostCourseSec = getCompetitorTrackRef(hostScore);
    const racerCourseSec = racer.isFinished && typeof racer.finalTimeSec === "number"
      ? racer.finalTimeSec
      : getCompetitorTrackRef(racer.score || 0);
    const deltaSec = currentSec - (racer.currentTimeSec || 0) !== 0 && hostScore === (racer.score || 0)
      ? 0
      : (hostCourseSec - racerCourseSec);
    const deltaStr = formatDeltaSeconds(-deltaSec);

    if (ghostCoord < visibleMin) {
      marker.style.display = "none";
      marker.style.removeProperty("--ghost-stack-offset");
      marker.style.removeProperty("--ghost-splay-x");
      marker.style.removeProperty("--ghost-needle-angle");
      marker.style.removeProperty("--ghost-needle-height");
      leftOffscreenGhosts.push({
        ghostInfo: { id: racer.userId, icon: racer.avatar || "🏎️", color: racer.color },
        deltaStr,
        isAhead
      });
    } else if (ghostCoord > visibleMax) {
      marker.style.display = "none";
      marker.style.removeProperty("--ghost-stack-offset");
      marker.style.removeProperty("--ghost-splay-x");
      marker.style.removeProperty("--ghost-needle-angle");
      marker.style.removeProperty("--ghost-needle-height");
      rightOffscreenGhosts.push({
        ghostInfo: { id: racer.userId, icon: racer.avatar || "🏎️", color: racer.color },
        deltaStr,
        isAhead
      });
    } else {
      visibleOnscreenMarkers.push({
        marker,
        coord: ghostCoord,
        coords
      });
    }
  });

  // 3. Intelligent Mini-Leaderboard Track Pins with Orthogonal Drop Lines (Image 2)
  // Clustered pins align horizontally in race order (Furthest Behind on left -> Furthest Ahead on right).
  // Pin heads float side-by-side with zero overlap above split text.
  // Orthogonal leader lines connect behind the pin heads down to each runner's actual track coordinate,
  // with least drawing precedence so text and badges are always 100% readable.
  const trackElem = document.getElementById("track");
  const configuredPinSize = trackElem ? (parseFloat(getComputedStyle(trackElem).getPropertyValue("--ghost-pin-size")) || 26) : 26;
  const COLLISION_THRESHOLD = configuredPinSize + 2; // px - zero overlap

  visibleOnscreenMarkers.sort((a, b) => {
    if (Math.abs(a.coord - b.coord) > 0.001) {
      return a.coord - b.coord;
    }
    const idA = a.marker.id || "";
    const idB = b.marker.id || "";
    return idA.localeCompare(idB);
  });

  if (isVertical) {
    // In vertical track orientation, tier pins horizontally to the right
    const activeTiers = [];
    visibleOnscreenMarkers.forEach((item) => {
      let tier = 0;
      while (activeTiers[tier] !== undefined && (item.coord - activeTiers[tier]) < COLLISION_THRESHOLD) {
        tier++;
      }
      tier = Math.min(tier, 2);
      activeTiers[tier] = item.coord;

      const marker = item.marker;
      marker.style.display = "flex";
      const offsetX = tier * (configuredPinSize + 2);
      marker.style.transform = `translateY(${item.coord}px) translateY(-50%) translateX(calc(-50% + ${offsetX}px))`;
      marker.style.zIndex = `${20 + tier}`;
      marker.style.removeProperty("--ghost-stack-offset");
      marker.style.removeProperty("--ghost-splay-x");
      marker.style.removeProperty("--ghost-needle-angle");
      marker.style.removeProperty("--ghost-needle-height");
      marker.classList.remove("splay-left", "splay-right");
    });
  } else {
    // Horizontal track orientation: Globally Non-Overlapping Mini-Leaderboard Strip with Orthogonal Drop Lines
    // Iterative cluster merging guarantees ZERO badge overlap across the entire track under all race conditions.
    const leftBound = visibleMin + (configuredPinSize / 2) + 2;
    const rightBound = visibleMax - (configuredPinSize / 2) - 2;
    const maxAllowedSpan = Math.max(1, rightBound - leftBound);

    let badgeSpacing = configuredPinSize + 2;
    const totalPins = visibleOnscreenMarkers.length;
    if (totalPins > 1 && (totalPins - 1) * badgeSpacing > maxAllowedSpan) {
      badgeSpacing = Math.max(12, maxAllowedSpan / (totalPins - 1));
    }

    const getClusterSpan = (c) => (c.items.length - 1) * badgeSpacing;
    const getClusterRawCenter = (c) => c.items.reduce((acc, it) => acc + it.coord, 0) / c.items.length;
    const getClusterClampedCenter = (c) => {
      const span = getClusterSpan(c);
      let center = getClusterRawCenter(c);
      const half = span / 2;
      if (center - half < leftBound) center = leftBound + half;
      if (center + half > rightBound) center = rightBound - half;
      return center;
    };
    const getClusterFirstBadge = (c) => getClusterClampedCenter(c) - getClusterSpan(c) / 2;
    const getClusterLastBadge = (c) => getClusterClampedCenter(c) + getClusterSpan(c) / 2;

    // 1. Initialize each marker as its own cluster
    let clusters = visibleOnscreenMarkers.map((item) => ({
      items: [item]
    }));

    // 2. Iteratively merge any adjacent clusters whose badge bounds overlap (< badgeSpacing)
    let merged = true;
    let iterations = 0;
    while (merged && iterations < 50) {
      merged = false;
      iterations++;
      const nextClusters = [];
      let i = 0;
      while (i < clusters.length) {
        if (i < clusters.length - 1) {
          const cA = clusters[i];
          const cB = clusters[i + 1];
          if (getClusterFirstBadge(cB) - getClusterLastBadge(cA) < badgeSpacing - 0.5) {
            nextClusters.push({
              items: cA.items.concat(cB.items)
            });
            i += 2;
            merged = true;
            continue;
          }
        }
        nextClusters.push(clusters[i]);
        i++;
      }
      clusters = nextClusters;
    }

    const baseNeedleLength = 16; // default baseline needle length in px
    let globalIndex = 0;

    clusters.forEach((cluster) => {
      const N = cluster.items.length;
      const center = getClusterClampedCenter(cluster);
      const span = getClusterSpan(cluster);

      const badgePositions = [];
      for (let k = 0; k < N; k++) {
        badgePositions.push(center - (span / 2) + k * badgeSpacing);
      }

      cluster.items.forEach((item, k) => {
        const marker = item.marker;
        marker.style.display = "flex";
        marker.style.transform = `translateX(${item.coord}px) translateX(-50%)`;

        // Leader (on right) has highest z-index so badges layer naturally
        const iconWrap = marker.querySelector(".ghost-icon-wrap");
        if (iconWrap) iconWrap.style.zIndex = `${30 + globalIndex}`;
        globalIndex++;

        const deltaX = Math.round((badgePositions[k] - item.coord) * 10) / 10;

        const distPrev = Math.abs(item.coord - item.coords.startCoord);
        const distNext = Math.abs(item.coords.endCoord - item.coord);
        const prevThreshold = getNodeTextThreshold(item.coords.prevNode, false);
        const nextThreshold = getNodeTextThreshold(item.coords.nextNode, true);
        const isHoveringText = (distPrev < prevThreshold || distNext < nextThreshold);
        marker.classList.toggle("compact", isHoveringText);

        // Stems extend full length down to track dot/bar (passing behind split text at z-index: 5)

        marker.style.removeProperty("--ghost-needle-angle");
        marker.style.removeProperty("--ghost-stack-offset");
        marker.style.removeProperty("--ghost-needle-height");

        if (deltaX > 1) {
          marker.style.setProperty("--ghost-splay-x", `${deltaX}px`);
          marker.classList.add("splay-right");
          marker.classList.remove("splay-left");
        } else if (deltaX < -1) {
          marker.style.setProperty("--ghost-splay-x", `${deltaX}px`);
          marker.classList.add("splay-left");
          marker.classList.remove("splay-right");
        } else {
          marker.style.removeProperty("--ghost-splay-x");
          marker.classList.remove("splay-left", "splay-right");
        }
      });
    });
  }

  // Hide static template marker and any marker not in rendered set
  const staticMarker = document.getElementById("ghost-marker");
  if (staticMarker) staticMarker.style.display = "none";
  knownGhostMarkers.forEach((m) => {
    if (m && !renderedMarkerIds.has(m.id)) {
      m.style.display = "none";
    }
  });

  const prevArrow = isVertical ? "▲" : "❮";
  const nextArrow = isVertical ? "▼" : "❯";

  // Render left / top off-screen pills
  if (leftOffscreenGhosts.length > 0 && edgeLeft) {
    edgeLeft.style.display = "flex";
    if (leftOffscreenGhosts.length === 1) {
      const g = leftOffscreenGhosts[0];
      const iconCol = g.ghostInfo.color ? `style="color:${g.ghostInfo.color};"` : "";
      edgeLeft.innerHTML = `<span>${prevArrow}</span> <span id="ghost-edge-left-icon" ${iconCol}>${g.ghostInfo.icon}</span> <span id="ghost-edge-left-val" style="color:${g.isAhead ? "#22c55e" : "#ef4444"};">${g.deltaStr}</span>`;
    } else {
      let html = `<span style="opacity:0.7;">${prevArrow}</span> `;
      html += leftOffscreenGhosts.map(g => {
        const col = g.isAhead ? "#22c55e" : "#ef4444";
        const iconCol = g.ghostInfo.color ? `style="color:${g.ghostInfo.color};"` : "";
        return `<span ${iconCol}>${g.ghostInfo.icon}</span> <span style="color:${col}; font-weight:700;">${g.deltaStr}</span>`;
      }).join(" &nbsp;");
      edgeLeft.innerHTML = html;
    }
  } else if (edgeLeft) {
    edgeLeft.style.display = "none";
  }

  // Render right / bottom off-screen pills
  if (rightOffscreenGhosts.length > 0 && edgeRight) {
    edgeRight.style.display = "flex";
    if (rightOffscreenGhosts.length === 1) {
      const g = rightOffscreenGhosts[0];
      const iconCol = g.ghostInfo.color ? `style="color:${g.ghostInfo.color};"` : "";
      edgeRight.innerHTML = `<span id="ghost-edge-right-val" style="color:${g.isAhead ? "#22c55e" : "#ef4444"};">${g.deltaStr}</span> <span id="ghost-edge-right-icon" ${iconCol}>${g.ghostInfo.icon}</span> <span>${nextArrow}</span>`;
    } else {
      let html = rightOffscreenGhosts.map(g => {
        const col = g.isAhead ? "#22c55e" : "#ef4444";
        const iconCol = g.ghostInfo.color ? `style="color:${g.ghostInfo.color};"` : "";
        return `<span ${iconCol}>${g.ghostInfo.icon}</span> <span style="color:${col}; font-weight:700;">${g.deltaStr}</span>`;
      }).join(" &nbsp;");
      html += ` <span style="opacity:0.7;">${nextArrow}</span>`;
      edgeRight.innerHTML = html;
    }
  } else if (edgeRight) {
    edgeRight.style.display = "none";
  }

  // 3. Render F1 Dynamic Leaderboard
  refreshLeaderboard();
}

function updateGhostBadge() {
  const badge = document.getElementById("ghost-badge");
  if (!badge) return;
  const active = activeGhostComparisons.filter(g => g && g !== "off");
  if (active.length === 0) {
    badge.innerText = "Ghost: Off";
    badge.style.color = "rgba(148, 163, 184, 0.9)";
    return;
  }

  const labelMap = {
    wr: "🏆 WR",
    pb: "🥈 PB",
    best: "⭐ Best",
    average: "📊 Avg",
    worst: "🐢 Worst"
  };

  const labels = active.map(id => {
    const low = id.toLowerCase();
    if (labelMap[low]) return labelMap[low];
    if (low.includes("world record")) return "🏆 WR";
    if (low === "personal best") return "🥈 PB";
    if (low === "best segments") return "⭐ Best";
    if (low === "average segments") return "📊 Avg";
    if (low === "worst segments") return "🐢 Worst";
    return `👤 ${id.slice(0, 8)}`;
  });

  badge.innerText = `Ghost: ${labels.join(" + ")}`;
  badge.style.color = active.includes("wr") ? "#facc15" : (active.includes("pb") ? "#38bdf8" : "#eab308");
}

function cycleGhostComparison() {
  const presets = [
    ["off"],
    ["wr"],
    ["pb"],
    ["wr", "pb"],
    ["best"],
    ["wr", "best"],
    ["average"],
    ["worst"]
  ];

  const curKey = activeGhostComparisons.filter(g => g !== "off").sort().join(",");
  let curIdx = -1;
  presets.forEach((p, idx) => {
    const pKey = p.filter(g => g !== "off").sort().join(",");
    if (pKey === curKey) curIdx = idx;
  });

  const nextIdx = (curIdx + 1) % presets.length;
  setGhostComparison(presets[nextIdx]);
}

function setGhostComparison(val) {
  if (Array.isArray(val)) {
    activeGhostComparisons = val.filter(Boolean);
  } else if (typeof val === "string") {
    if (val.includes(",")) {
      activeGhostComparisons = val.split(",").map(s => s.trim()).filter(Boolean);
    } else {
      activeGhostComparisons = (!val.trim() || val.trim().toLowerCase() === "off") ? ["off"] : [val.trim()];
    }
  } else {
    activeGhostComparisons = ["off"];
  }
  if (activeGhostComparisons.length === 0) {
    activeGhostComparisons = ["off"];
  }

  saveActiveGhostComparisons();
  updateGhostBadge();
  hideAllGhostMarkers();

  const edgeLeft = document.getElementById("ghost-edge-left");
  const edgeRight = document.getElementById("ghost-edge-right");
  if (activeGhostComparisons.length === 1 && activeGhostComparisons[0] === "off") {
    if (edgeLeft) edgeLeft.style.display = "none";
    if (edgeRight) edgeRight.style.display = "none";
  } else if (lastElapsedSec > 0) {
    updateGhostRunner(lastElapsedSec);
  }

  if (window.hudLayout && window.hudLayout.syncTrackModalUI) {
    window.hudLayout.syncTrackModalUI();
  }
}

function toggleGhostComparison(ghostId) {
  const id = (ghostId || "").trim();
  if (!id || id === "off") {
    activeGhostComparisons = ["off"];
  } else {
    let list = activeGhostComparisons.filter(g => g !== "off");
    const idx = list.indexOf(id);
    if (idx !== -1) {
      list.splice(idx, 1);
    } else {
      list.push(id);
    }
    activeGhostComparisons = list.length > 0 ? list : ["off"];
  }

  saveActiveGhostComparisons();
  updateGhostBadge();
  hideAllGhostMarkers();

  const edgeLeft = document.getElementById("ghost-edge-left");
  const edgeRight = document.getElementById("ghost-edge-right");
  if (activeGhostComparisons.length === 1 && activeGhostComparisons[0] === "off") {
    if (edgeLeft) edgeLeft.style.display = "none";
    if (edgeRight) edgeRight.style.display = "none";
  } else if (lastElapsedSec > 0) {
    updateGhostRunner(lastElapsedSec);
  }

  if (window.hudLayout && window.hudLayout.syncTrackModalUI) {
    window.hudLayout.syncTrackModalUI();
  }
}

function setGhostOpacity(pct) {
  const parsed = parseInt(pct, 10);
  if (!isNaN(parsed) && parsed >= 30 && parsed <= 100) {
    ghostOpacity = parsed / 100;
    localStorage.setItem("livesplit_ghost_opacity", parsed.toString());
    const track = document.getElementById("track");
    if (track) track.style.setProperty("--ghost-opacity", ghostOpacity);
  }
}

// ============================================================
// 11. DELTA DISPLAY ENGINE & UNDO SPLIT ROLLBACK CONTROLLER
// ============================================================
function setDeltaDisplay(index, deltaInfo, stateClass, splitTimeSec) {
  if (index < 0 || index >= splitsList.length) return;
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
      const targetVal = formatTargetTime(comparisonTimes[index]);
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

  for (let i = newIdx; i < splitsList.length; i++) {
    delete lockedDeltas[i];
    delete completedSplitTimes[i];
    delete completedSplitTimesRT[i];
    delete completedSplitTimesGT[i];

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
      const targetVal = formatTargetTime(comparisonTimes[i]);
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
    if (baselineBestSegmentTimesGT.length > 0 && baselineBestSegmentTimesRT.length > 0) {
      bestSegmentTimesGT[i] = baselineBestSegmentTimesGT[i];
      bestSegmentTimesRT[i] = baselineBestSegmentTimesRT[i];
      const isRT = currentTimingMethod === "RealTime";
      bestSegmentTimes[i] = isRT
        ? (bestSegmentTimesRT[i] ?? bestSegmentTimesGT[i] ?? null)
        : (bestSegmentTimesGT[i] ?? bestSegmentTimesRT[i] ?? null);
    }
  }

  // Roll back lastSplitRecordedSec to the last actual completed split
  lastSplitRecordedSec = 0;
  for (let k = newIdx - 1; k >= 0; k--) {
    if (completedSplitTimes[k] != null) {
      lastSplitRecordedSec = completedSplitTimes[k];
      break;
    }
  }

  // Roll back previousDeltaSeconds to the last completed split with comparison data
  previousDeltaSeconds = 0;
  for (let k = newIdx - 1; k >= 0; k--) {
    if (lockedDeltas[k] && lockedDeltas[k].deltaInfo && lockedDeltas[k].stateClass !== "uncoloured") {
      previousDeltaSeconds = lockedDeltas[k].deltaInfo.signedSeconds || 0;
      break;
    }
  }

  const rc = window.LiveSplit && window.LiveSplit.RaceClient
    ? (window.LiveSplit.RaceClient.instance || window.LiveSplit.RaceClient)
    : window.LiveSplitRaceClient;
  if (rc && typeof rc.handleUndoSplit === "function") {
    rc.handleUndoSplit(newIdx, oldIdx);
  }

  saveInRunState();
}

function detectTimingMethodFromComp(splitIdx, compSec) {
  if (splitIdx < 0 || compSec === null || compSec <= 0) return null;
  const gtArr = (typeof window !== "undefined" && Array.isArray(window.comparisonTimesGT) && window.comparisonTimesGT.length > 0)
    ? window.comparisonTimesGT
    : comparisonTimesGT;
  const rtArr = (typeof window !== "undefined" && Array.isArray(window.comparisonTimesRT) && window.comparisonTimesRT.length > 0)
    ? window.comparisonTimesRT
    : comparisonTimesRT;
  const gtSec = (gtArr && splitIdx < gtArr.length) ? gtArr[splitIdx] : null;
  const rtSec = (rtArr && splitIdx < rtArr.length) ? rtArr[splitIdx] : null;
  if (gtSec !== null && rtSec !== null && Math.abs(gtSec - rtSec) > 1.0) {
    const diffGT = Math.abs(compSec - gtSec);
    const diffRT = Math.abs(compSec - rtSec);
    const detected = (diffGT <= diffRT) ? "GameTime" : "RealTime";
    const isManual = (localStorage.getItem("livesplit_timing_method_manual") === "true");
    if (!isManual && detected !== currentTimingMethod) {
      applyActiveTimingMethod(detected);
      localStorage.setItem("livesplit_timing_method", detected);
    }
    return detected;
  }
  return null;
}

// ============================================================
// 12. WEBSOCKET CONNECTION & HIGH-FREQUENCY POLL LOOP
// ============================================================
let canQueryComparison = true;

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  ws = new WebSocket(WS_URL);

  ws.onopen = async () => {
    const status = document.getElementById("connection-status");
    if (status) {
      status.innerText = "CONNECTED";
      status.style.color = "#4ade80";
      status.closest(".connection-status-pill")?.classList.add("connected");
    }

    canQueryComparison = true;
    const rcConn = window.LiveSplit && window.LiveSplit.RaceClient ? (window.LiveSplit.RaceClient.instance || window.LiveSplit.RaceClient) : window.LiveSplitRaceClient;
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
  };

  ws.onmessage = (event) => {
    const text = event.data.trim();
    if (inflightResolver) {
      const res = inflightResolver;
      inflightResolver = null;
      res(text);
    }
  };

  ws.onclose = () => {
    isPolling = false;
    const rcDisconn = window.LiveSplit && window.LiveSplit.RaceClient ? (window.LiveSplit.RaceClient.instance || window.LiveSplit.RaceClient) : window.LiveSplitRaceClient;
    if (rcDisconn && typeof rcDisconn.setExternalHostConnected === "function") {
      rcDisconn.setExternalHostConnected(false);
    }
    inflightResolver = null;
    const status = document.getElementById("connection-status");
    if (status) {
      status.innerText = "DISCONNECTED";
      status.style.color = "#ef4444";
      status.closest(".connection-status-pill")?.classList.remove("connected");
    }
    setTimeout(connect, 1500);
  };

  ws.onerror = () => ws.close();
}

let pollTick = 0;
let pendingHostSplitFlash = null;

async function pollLoop() {
  while (ws && ws.readyState === WebSocket.OPEN) {
    try {
    // 0. Periodic Auto-Sync with LiveSplit hotkeys (every ~500ms)
    pollTick = (pollTick + 1) % 15;
    if (pollTick === 0) {
      const isSyncEnabled = (localStorage.getItem("livesplit_sync_hotkeys") !== "false");
      if (isSyncEnabled) {
        // Query active comparison (with fallback if unsupported)
        if (canQueryComparison) {
          const lsComp = await sendCommand("getcomparisonname", 120, true);
          if (lsComp && lsComp !== "-" && lsComp.trim()) {
            const norm = normalizeComparisonName(lsComp.trim());
            if (norm && norm !== currentComparison) {
              applyActiveComparison(norm, false);
            }
          } else if (lsComp === null) {
            canQueryComparison = false;
          }
        }
      }
    }

    // 1. Game Time
    const igt = await sendCommand("getcurrentgametime");
    let igtSec = null;
    if (igt && igt !== "-") {
      const igtEl = document.getElementById("timer-igt");
      if (igtEl) igtEl.innerText = formatTimerDisplay(igt);
      igtSec = timeStringToSeconds(igt);
    }

    // 2. Real Time
    const rta = await sendCommand("getcurrentrealtime");
    let rtaSec = null;
    if (rta && rta !== "-") {
      const rtaEl = document.getElementById("timer-rta");
      if (rtaEl) rtaEl.innerText = formatTimerDisplay(rta);
      rtaSec = timeStringToSeconds(rta);
    }

    // Total elapsed seconds for the active timing method (with fallback)
    let currentTotalSec = (currentTimingMethod === "RealTime")
      ? (rtaSec ?? igtSec)
      : (igtSec ?? rtaSec);
    if (currentTotalSec !== null) {
      lastElapsedSec = currentTotalSec;
    }

    // 3. Split Index (strict integer check to avoid corrupting run if non-integer text is received)
    const splitIdxStr = await sendCommand("getsplitindex");
    const isStrictInt = typeof splitIdxStr === "string" && /^-?\d+$/.test(splitIdxStr.trim());

    if (isStrictInt) {
      const idx = parseInt(splitIdxStr.trim(), 10);
      const rc = window.LiveSplit && window.LiveSplit.RaceClient ? (window.LiveSplit.RaceClient.instance || window.LiveSplit.RaceClient) : window.LiveSplitRaceClient;
      if (rc && typeof rc.setExternalHostConnected === "function") {
        rc.setExternalHostConnected(true);
      }
      const isSim = rc && typeof rc.isSimulating === "function" && rc.isSimulating();
      const wasRunning = (currentIndex > 0) || (currentIndex === 0 && lastElapsedSec > 1.0);
      const isSecondResetWithDNF = (idx === -1 && currentIndex === -1 && rc && typeof rc.isHostDNF === "function" && rc.isHostDNF());

      // Reset transition (active run to reset, restarting from a later split, or repeated reset to clear DNF)
      if ((idx === -1 && currentIndex !== -1) || (idx === 0 && currentIndex > 0) || isSecondResetWithDNF) {
        if (isSecondResetWithDNF) {
          // Second reset while DNF'd: cleanly clear DNF and completely reset the race client
          clearInRunState();
          lockedDeltas = {};
          completedSplitTimes = {};
          completedSplitTimesRT = {};
          completedSplitTimesGT = {};
          lastSplitRecordedSec = 0;
          previousDeltaSeconds = 0;
          lastElapsedSec = 0;
          pendingHostSplitFlash = null;
          if (typeof rc.setHostDNF === "function") {
            rc.setHostDNF(false);
          }
          if (typeof rc.reset === "function") {
            rc.reset();
          }
        } else if (isSim && wasRunning && typeof rc.setHostDNF === "function" && !rc.isHostDNF()) {
          // Reset during active simulation: Host forfeits / cancels their run (DNF)
          // The rest of the simulated competitors continue racing so you can see DNF behavior on the leaderboard!
          rc.setHostDNF(true);
          clearInRunState();
          lockedDeltas = {};
          completedSplitTimes = {};
          completedSplitTimesRT = {};
          completedSplitTimesGT = {};
          lastSplitRecordedSec = 0;
          previousDeltaSeconds = 0;
          lastElapsedSec = 0;
          pendingHostSplitFlash = null;
        } else {
          clearInRunState();
          lockedDeltas = {};
          completedSplitTimes = {};
          completedSplitTimesRT = {};
          completedSplitTimesGT = {};
          lastSplitRecordedSec = 0;
          previousDeltaSeconds = 0;
          lastElapsedSec = 0;
          pendingHostSplitFlash = null;

          if (rc && typeof rc.reset === "function") {
            rc.reset();
          }
        }
        // Discard uncommitted in-run gold split segments by default upon reset
        const discardOnReset = (localStorage.getItem("livesplit_discard_golds_on_reset") !== "false");
        if (discardOnReset && baselineBestSegmentTimesGT.length > 0) {
          bestSegmentTimesGT = [...baselineBestSegmentTimesGT];
          bestSegmentTimesRT = [...baselineBestSegmentTimesRT];
          const isRT = currentTimingMethod === "RealTime";
          bestSegmentTimes = splitsList.map((_, i) => {
            return isRT 
              ? (bestSegmentTimesRT[i] ?? bestSegmentTimesGT[i] ?? null)
              : (bestSegmentTimesGT[i] ?? bestSegmentTimesRT[i] ?? null);
          });
          localStorage.setItem("livesplit_golds_gt", JSON.stringify(bestSegmentTimesGT));
          localStorage.setItem("livesplit_golds_rt", JSON.stringify(bestSegmentTimesRT));
        }

        for (let i = 0; i < splitsList.length; i++) {
          const deltaSpan = document.getElementById(`delta-val-${i}`);
          const timeSpan = document.getElementById(`time-val-${i}`);
          const fill = document.getElementById(`fill-${i}`);
          const item = document.getElementById(`item-${i}`);
          if (deltaSpan) {
            deltaSpan.innerText = "";
            deltaSpan.className = "split-delta-val";
          }
          if (timeSpan) {
            const targetVal = formatTargetTime(comparisonTimes[i]);
            timeSpan.innerText = targetVal || "-";
            timeSpan.className = "split-time-val target-time";
          }
          if (fill) {
            const isVert = document.getElementById("track")?.classList.contains("vertical");
            fill.style.width = isVert ? "100%" : "0%";
            fill.style.height = isVert ? "0%" : "100%";
            fill.className = "segment-bar-fill";
            if (fill.parentElement) fill.parentElement.classList.remove("overdue");
          }
          if (item) {
            item.classList.remove(...ALL_SPLIT_STATE_CLASSES);
          }
        }
        updateTrackStatus(idx);
        updateGhostRunner(0);
        await syncLiveSplitMetadata();

        // Check active comparison on reset
        const isSyncEnabled = (localStorage.getItem("livesplit_sync_hotkeys") !== "false");
        if (isSyncEnabled && canQueryComparison) {
          const lsComp = await sendCommand("getcomparisonname", 40);
          if (lsComp && lsComp !== "-" && lsComp.trim()) {
            const norm = normalizeComparisonName(lsComp.trim());
            if (norm && norm !== currentComparison) {
              applyActiveComparison(norm, false);
            }
          } else if (lsComp === null) {
            canQueryComparison = false;
          }
        }
      } 
      // Completed Split
      else if (idx !== currentIndex) {
        if (currentIndex === -1 && idx === 0) {
          // Timer just started fresh run: ensure any prior DNF is cleared and race starts cleanly
          clearInRunState();
          lockedDeltas = {};
          completedSplitTimes = {};
          completedSplitTimesRT = {};
          completedSplitTimesGT = {};
          lastSplitRecordedSec = 0;
          previousDeltaSeconds = 0;

          const rcStart = window.LiveSplit && window.LiveSplit.RaceClient ? (window.LiveSplit.RaceClient.instance || window.LiveSplit.RaceClient) : window.LiveSplitRaceClient;
          if (rcStart) {
            if (typeof rcStart.setHostDNF === "function" && rcStart.isHostDNF()) {
              rcStart.setHostDNF(false);
            }
            if (typeof rcStart.handleHostRunStarted === "function") {
              rcStart.handleHostRunStarted();
            }
          }

          // Fetch target time for the first split from LiveSplit
          if (splitsList.length > 0) {
            const rawCompTime = await sendCommand("getcomparisonsplittime");
            const compSec = timeStringToSeconds(rawCompTime);
            if (compSec !== null && compSec > 0) {
              detectTimingMethodFromComp(0, compSec);
              comparisonTimes[0] = compSec;
              if (currentTimingMethod === "RealTime") comparisonTimesRT[0] = compSec;
              else comparisonTimesGT[0] = compSec;
            }
          }
        } else if (currentIndex >= 0 && idx > currentIndex) {
          // If runner skipped multiple splits in one leap, mark skipped intermediate splits as uncoloured
          for (let s = currentIndex; s < idx - 1; s++) {
            delete completedSplitTimes[s];
            delete completedSplitTimesRT[s];
            const skipDelta = { text: "-", isAhead: false, signedSeconds: 0 };
            lockedDeltas[s] = { deltaInfo: skipDelta, stateClass: "uncoloured", splitTimeSec: null };
            setDeltaDisplay(s, skipDelta, "uncoloured", null);
          }

          const prevIdx = idx - 1;

          // 1. Get exact cumulative split time from LiveSplit for the evaluated split
          const rawLastSplit = await sendCommand("getlastsplittime");
          const parsedLastSplit = timeStringToSeconds(rawLastSplit);

          // A split was completed IF AND ONLY IF LiveSplit recorded a new positive split time
          // that is strictly greater than the last recorded split time of this run!
          const isSplitCompleted = (parsedLastSplit !== null && parsedLastSplit > 0 && parsedLastSplit > (lastSplitRecordedSec + 0.001));

          let splitTimeSec = null;
          let isSkipped = !isSplitCompleted;

          if (isSplitCompleted) {
            splitTimeSec = parsedLastSplit;
            lastSplitRecordedSec = splitTimeSec;

            if (currentTimingMethod === "RealTime") {
              completedSplitTimesRT[prevIdx] = splitTimeSec;
              if (igtSec !== null && igtSec > 0) {
                completedSplitTimesGT[prevIdx] = igtSec;
              } else if (completedSplitTimesGT[prevIdx] != null) {
                // retain existing GT
              } else if (completedSplitTimes[prevIdx] != null) {
                completedSplitTimesGT[prevIdx] = completedSplitTimes[prevIdx];
              } else {
                completedSplitTimesGT[prevIdx] = splitTimeSec;
              }
            } else {
              // GameTime
              completedSplitTimesGT[prevIdx] = splitTimeSec;
              if (rtaSec !== null && rtaSec > 0) {
                completedSplitTimesRT[prevIdx] = rtaSec;
              } else {
                completedSplitTimesRT[prevIdx] = splitTimeSec;
              }
            }
            completedSplitTimes[prevIdx] = (currentTimingMethod === "RealTime")
              ? completedSplitTimesRT[prevIdx]
              : completedSplitTimesGT[prevIdx];
          } else {
            delete completedSplitTimes[prevIdx];
            delete completedSplitTimesRT[prevIdx];
            delete completedSplitTimesGT[prevIdx];
          }

          let stateClass = "uncoloured";
          let displayDelta = { text: "-", isAhead: false, signedSeconds: 0 };

          if (!isSkipped) {
            // 2. Compute segment duration
            let prevSplitSec = 0;
            for (let k = prevIdx - 1; k >= 0; k--) {
              if (completedSplitTimes[k] != null) {
                prevSplitSec = completedSplitTimes[k];
                break;
              }
            }

            let segmentDurationSec = (splitTimeSec >= prevSplitSec)
              ? (splitTimeSec - prevSplitSec)
              : null;

            // 3. Get delta from LiveSplit
            const rawFinalDelta = await sendCommand("getdelta");
            const finalDeltaInfo = formatDeltaLive(rawFinalDelta);
            const targetSec = (prevIdx < comparisonTimes.length && comparisonTimes[prevIdx] !== null && comparisonTimes[prevIdx] > 0)
              ? comparisonTimes[prevIdx]
              : null;

            // 4. Evaluate Gold Split (Personal Best Segment)
            let isGold = false;
            const isGoldsEnabled = cachedEnableGolds;
            const bestSec = (prevIdx < bestSegmentTimes.length && bestSegmentTimes[prevIdx] !== null && bestSegmentTimes[prevIdx] > 0)
              ? bestSegmentTimes[prevIdx]
              : null;

            // Only ever mark gold if Golds are enabled, we have a valid positive best segment, and we strictly beat it
            if (isGoldsEnabled && bestSec !== null && segmentDurationSec !== null && segmentDurationSec > 0) {
              if (segmentDurationSec < (bestSec - 0.05)) {
                isGold = true;
                bestSegmentTimes[prevIdx] = segmentDurationSec;
                if (currentTimingMethod === "RealTime") {
                  bestSegmentTimesRT[prevIdx] = segmentDurationSec;
                } else {
                  bestSegmentTimesGT[prevIdx] = segmentDurationSec;
                }

                // Only write to persistent storage immediately if the user opted out of discarding on reset
                const discardOnReset = (localStorage.getItem("livesplit_discard_golds_on_reset") !== "false");
                if (!discardOnReset) {
                  if (currentTimingMethod === "RealTime") {
                    localStorage.setItem("livesplit_golds_rt", JSON.stringify(bestSegmentTimesRT));
                  } else {
                    localStorage.setItem("livesplit_golds_gt", JSON.stringify(bestSegmentTimesGT));
                  }
                }
              }
            }

            // 5. Determine State Classification & Delta Display
            if (isGold) {
              stateClass = "gold";
              if (finalDeltaInfo) {
                displayDelta = finalDeltaInfo;
                previousDeltaSeconds = finalDeltaInfo.signedSeconds;
              } else if (targetSec) {
                const diff = splitTimeSec - targetSec;
                displayDelta = { text: formatDeltaSeconds(diff), isAhead: diff <= 0, signedSeconds: diff };
                previousDeltaSeconds = diff;
              }
            } else if (finalDeltaInfo) {
              displayDelta = finalDeltaInfo;
              const currentDeltaSec = finalDeltaInfo.signedSeconds;
              const deltaChange = currentDeltaSec - previousDeltaSeconds;
              const gainedTime = deltaChange <= 0.001; // Gained time or stayed even vs PB segment

              if (finalDeltaInfo.isAhead) {
                stateClass = gainedTime ? "ahead-gaining" : "ahead-losing";
              } else {
                stateClass = gainedTime ? "behind-gaining" : "behind-losing";
              }
              previousDeltaSeconds = currentDeltaSec;
            } else if (targetSec) {
              const diff = splitTimeSec - targetSec;
              displayDelta = { text: formatDeltaSeconds(diff), isAhead: diff <= 0, signedSeconds: diff };
              const deltaChange = diff - previousDeltaSeconds;
              const gainedTime = deltaChange <= 0.001;

              if (diff <= 0) {
                stateClass = gainedTime ? "ahead-gaining" : "ahead-losing";
              } else {
                stateClass = gainedTime ? "behind-gaining" : "behind-losing";
              }
              previousDeltaSeconds = diff;
            } else {
              // Incomplete data: fresh new splits with no existing data to compare against
              stateClass = "uncoloured";
              displayDelta = { text: "-", isAhead: false, signedSeconds: 0 };
            }

            // Check if final split completed and beats overall Personal Best
            if (prevIdx === splitsList.length - 1 && splitTimeSec !== null && splitTimeSec > 0) {
              const overallPbSec = comparisonTimes[splitsList.length - 1];
              if (overallPbSec === null || overallPbSec === undefined || splitTimeSec < overallPbSec) {
                for (let i = 0; i < splitsList.length; i++) {
                  if (completedSplitTimes[i] != null) {
                    comparisonTimes[i] = completedSplitTimes[i];
                    if (currentTimingMethod === "RealTime") {
                      comparisonTimesRT[i] = completedSplitTimes[i];
                    } else {
                      comparisonTimesGT[i] = completedSplitTimes[i];
                    }
                  }
                }

                // Completed PB run: commit both targets AND newly earned best segments to baseline!
                baselineBestSegmentTimesGT = [...bestSegmentTimesGT];
                baselineBestSegmentTimesRT = [...bestSegmentTimesRT];
                localStorage.setItem("livesplit_baseline_golds_gt", JSON.stringify(baselineBestSegmentTimesGT));
                localStorage.setItem("livesplit_baseline_golds_rt", JSON.stringify(baselineBestSegmentTimesRT));
                localStorage.setItem("livesplit_golds_gt", JSON.stringify(bestSegmentTimesGT));
                localStorage.setItem("livesplit_golds_rt", JSON.stringify(bestSegmentTimesRT));

                if (currentTimingMethod === "RealTime") {
                  localStorage.setItem("livesplit_targets_rt", JSON.stringify(comparisonTimesRT));
                } else {
                  localStorage.setItem("livesplit_targets_gt", JSON.stringify(comparisonTimesGT));
                }
              }
            }
          } // end if (!isSkipped)

          lockedDeltas[prevIdx] = { deltaInfo: displayDelta, stateClass, splitTimeSec };
          setDeltaDisplay(prevIdx, displayDelta, stateClass, splitTimeSec);
          saveInRunState();

          // Trigger leaderboard split flash glow for host
          let flashType = "green";
          if (stateClass === "gold") {
            flashType = "gold";
          } else if (stateClass.includes("losing")) {
            flashType = "red";
          } else if (stateClass.includes("gaining") || displayDelta.isAhead) {
            flashType = "green";
          }
          const completedName = (prevIdx >= 0 && prevIdx < splitsList.length) ? splitsList[prevIdx] : `Split ${prevIdx + 1}`;
          const nextName = (idx < splitsList.length) ? splitsList[idx] : "Finished";
          pendingHostSplitFlash = {
            type: flashType,
            timestamp: Date.now(),
            completedSplitName: completedName,
            newSplitName: nextName
          };

          // Query target comparison time once for the next newly active split
          if (idx < splitsList.length) {
            const rawNextComp = await sendCommand("getcomparisonsplittime");
            const nextCompSec = timeStringToSeconds(rawNextComp);
            if (nextCompSec !== null && nextCompSec > 0) {
              detectTimingMethodFromComp(idx, nextCompSec);
              comparisonTimes[idx] = nextCompSec;
              if (currentTimingMethod === "RealTime") comparisonTimesRT[idx] = nextCompSec;
              else comparisonTimesGT[idx] = nextCompSec;
              const nextTimeSpan = document.getElementById(`time-val-${idx}`);
              if (nextTimeSpan) {
                nextTimeSpan.innerText = formatTargetTime(nextCompSec) || "-";
              }
            }
          }
        } else if (currentIndex >= 0 && idx < currentIndex) {
          // LiveSplit Undo Split triggered
          handleUndoSplit(idx, currentIndex);
        }
        updateTrackStatus(idx);
        if (idx >= 0) {
          saveInRunState();
        }
      }

      if (idx >= 0 && currentTotalSec !== null) {
        const rc = window.LiveSplit && window.LiveSplit.RaceClient ? (window.LiveSplit.RaceClient.instance || window.LiveSplit.RaceClient) : window.LiveSplitRaceClient;
        if (rc && typeof rc.updateHostProgress === "function") {
          const hostSplitName = (currentIndex < 0)
            ? "Start"
            : (currentIndex < splitsList.length ? splitsList[currentIndex] : "Finished");
          const realTimeSec = (rtaSec !== null && rtaSec > 0) ? rtaSec : currentTotalSec;
          const rtComparisons = (comparisonTimesRT && comparisonTimesRT.length > 0) ? comparisonTimesRT : comparisonTimes;
          const rtCompletedSplits = (Object.keys(completedSplitTimesRT).length > 0) ? completedSplitTimesRT : completedSplitTimes;
          const gtCompletedSplits = (Object.keys(completedSplitTimesGT).length > 0) ? completedSplitTimesGT : completedSplitTimes;
          rc.updateHostProgress(
            currentTotalSec,
            currentIndex,
            gtCompletedSplits,
            comparisonTimes,
            hostSplitName,
            splitsList,
            pendingHostSplitFlash,
            true,
            realTimeSec,
            rtComparisons,
            rtCompletedSplits,
            currentTimingMethod
          );
          pendingHostSplitFlash = null;
        }
        updateLiveSegmentProgress(currentTotalSec);
        updateGhostRunner(currentTotalSec);
      }
    }

    } catch (loopErr) {
      console.error("[LiveSplit] Error in pollLoop tick:", loopErr);
    }
    await new Promise((r) => setTimeout(r, 33));
  }
}

// ============================================================
// 13. TRACK DENSITY, AUTO-ANGLED TEXT & DRAG-AND-DROP LOADERS
// ============================================================
const fileInput = document.getElementById("file-input");
if (fileInput) {
  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => parseLSS(evt.target.result, true);
      reader.readAsText(file);
    }
  });
}

const fileDropzone = document.getElementById("file-trigger");
if (fileDropzone) {
  ["dragenter", "dragover"].forEach((evt) => {
    fileDropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      fileDropzone.classList.add("drag-over");
    });
  });
  ["dragleave", "drop"].forEach((evt) => {
    fileDropzone.addEventListener(evt, () => {
      fileDropzone.classList.remove("drag-over");
    });
  });
}

window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file && (file.name.endsWith(".lss") || file.name.endsWith(".xml"))) {
    const reader = new FileReader();
    reader.onload = (evt) => parseLSS(evt.target.result, true);
    reader.readAsText(file);
  } else if (file && (file.name.endsWith(".json") || file.name.endsWith(".lshud"))) {
    if (window.hudLayout && typeof window.hudLayout.importProfileFromFile === "function") {
      window.hudLayout.importProfileFromFile(file).then((name) => {
        console.log(`Imported layout profile: ${name}`);
      }).catch((err) => {
        console.error("Layout profile import failed:", err);
      });
    }
  }
});

let lastKnownOrientation = null;

function updateTrackDensityAndAngle() {
  nodeThresholdCache.clear();
  const viewport = document.getElementById("track-viewport");
  const track = document.getElementById("track");
  if (!viewport || !track) return;

  const isVertical = track.classList.contains("vertical");
  const trackComp = document.getElementById("hud-comp-track");
  const isDockedVertical = isVertical && (trackComp?.classList.contains("docked-left") || trackComp?.classList.contains("docked-right"));
  const isDockedHorizontal = !isVertical && trackComp?.classList.contains("docked-bottom");

  const currentOrient = isVertical ? "vertical" : "horizontal";
  if (lastKnownOrientation !== null && lastKnownOrientation !== currentOrient) {
    trackManualScrollOffset = 0;
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
  }
  lastKnownOrientation = currentOrient;

  const viewportWidth = (isDockedHorizontal && (viewport.clientWidth < 500))
    ? (window.innerWidth || 1920)
    : (viewport.clientWidth || window.innerWidth || 1920);

  const viewportHeight = (isDockedVertical && (viewport.clientHeight < 300))
    ? (window.innerHeight || 1080)
    : (viewport.clientHeight || window.innerHeight || 800);

  const splitPref = localStorage.getItem("livesplit_visible_splits") || "auto";
  const anglePref = localStorage.getItem("livesplit_split_angle") || "auto";

  let spacing = isVertical ? 64 : 220;
  const alwaysShowLast = localStorage.getItem("livesplit_always_show_last_split") !== "false";

  if (isVertical) {
    const pTop = 16;
    const pBottom = 24;
    const availH = Math.max(200, viewportHeight - (pTop + pBottom));
    if (splitPref === "all") {
      const totalCount = Math.max(1, splitsList.length + 1);
      spacing = Math.max(38, Math.floor(availH / totalCount));
    } else if (splitPref !== "auto") {
      const num = parseInt(splitPref, 10);
      if (!isNaN(num) && num > 0) {
        const K = Math.min(num, splitsList.length + 1);
        spacing = Math.max(38, Math.floor(availH / K));
      }
    } else if (alwaysShowLast && splitsList.length > 2) {
      const V = Math.max(4, Math.floor(availH / 64));
      const K = Math.min(V, splitsList.length + 1);
      spacing = Math.max(38, Math.floor(availH / K));
    } else {
      spacing = 64;
    }
  } else {
    const pLeft = 24;
    const pRight = 24;
    const availW = Math.max(300, viewportWidth - (pLeft + pRight));

    if (splitPref === "all") {
      // Fit all splits on screen without scrolling
      const totalCount = Math.max(1, splitsList.length + 1); // +1 for the Start node
      spacing = Math.max(45, Math.floor(availW / totalCount));
    } else if (splitPref !== "auto") {
      const num = parseInt(splitPref, 10);
      if (!isNaN(num) && num > 0) {
        const K = Math.min(num, splitsList.length + 1);
        spacing = Math.max(45, Math.floor(availW / K));
      }
    } else if (alwaysShowLast && splitsList.length > 2) {
      // Auto mode: calculate capacity based on comfortable spacing, fully utilizing real estate
      const V = Math.max(4, Math.floor(availW / 125));
      const K = Math.min(V, splitsList.length + 1);
      spacing = Math.max(45, Math.floor(availW / K));
    } else {
      // Default auto spacing
      spacing = 220;
    }
  }

  // Set the CSS variable dynamically
  document.documentElement.style.setProperty("--node-spacing", `${spacing}px`);

  // Update UI indicators & Spin Box inputs
  const splitBadge = document.getElementById("split-density-badge");
  if (splitBadge) {
    splitBadge.innerText = (splitPref === "all") 
      ? "Splits: All" 
      : (splitPref === "auto" ? "Splits: Auto" : `Splits: ${splitPref}`);
  }

  const numInput = document.getElementById("input-visible-splits");
  const modalNumInput = document.getElementById("modal-input-visible-splits");
  const btnAll = document.getElementById("btn-splits-fit-all");
  const btnAuto = document.getElementById("btn-splits-auto");
  const modalBtnAll = document.getElementById("modal-btn-splits-all");
  const modalBtnAuto = document.getElementById("modal-btn-splits-auto");
  const valBadge = document.getElementById("val-visible-splits");

  const isAll = (splitPref === "all");
  const isAuto = (splitPref === "auto");
  const intVal = parseInt(splitPref, 10);
  const isNum = !isNaN(intVal) && intVal > 0;

  if (btnAll) btnAll.classList.toggle("active", isAll);
  if (modalBtnAll) modalBtnAll.classList.toggle("active", isAll);
  if (btnAuto) btnAuto.classList.toggle("active", isAuto);
  if (modalBtnAuto) modalBtnAuto.classList.toggle("active", isAuto);

  if (isNum) {
    if (numInput) numInput.value = intVal;
    if (modalNumInput) modalNumInput.value = intVal;
    if (valBadge) valBadge.innerText = `${intVal} splits`;
  } else if (isAll) {
    const total = Math.max(1, splitsList.length);
    if (numInput) numInput.value = total;
    if (modalNumInput) modalNumInput.value = total;
    if (valBadge) valBadge.innerText = `Fit All (${total})`;
  } else {
    if (numInput) numInput.value = isVertical ? 10 : 8;
    if (modalNumInput) modalNumInput.value = isVertical ? 10 : 8;
    if (valBadge) valBadge.innerText = "Auto";
  }

  // Determine whether to apply 40° angle strictly to split names (horizontal mode only)
  let shouldAngle = false;
  if (!isVertical) {
    if (anglePref === "angled" || anglePref === "40") {
      shouldAngle = true;
    } else if (anglePref === "horizontal" || anglePref === "flat") {
      shouldAngle = false;
    } else {
      // Intelligent collision detection:
      // If node spacing is under 175px, text is very prone to collision
      if (spacing < 175) {
        shouldAngle = true;
      } else {
        const nameElements = track.querySelectorAll(".split-name");
        for (const el of nameElements) {
          if (el.scrollWidth > (spacing - 24)) {
            shouldAngle = true;
            break;
          }
        }
      }
    }
  }

  if (shouldAngle) {
    track.classList.add("angled-text");
    // Enforce opposing delta positioning when angled mode is active
    if (window.hudLayout) {
      const style = window.hudLayout.getTrackStyle();
      if (style && style.namePos === style.deltaPos) {
        style.deltaPos = style.namePos === "top" ? "bottom" : "top";
        if (window.hudLayout.saveTrackStyle) window.hudLayout.saveTrackStyle();
        if (window.hudLayout.syncTrackModalUI) window.hudLayout.syncTrackModalUI();
      }
    }
  } else {
    track.classList.remove("angled-text");
  }

  const angleBadge = document.getElementById("split-angle-badge");
  if (angleBadge) {
    if (isVertical) {
      angleBadge.innerText = "Angle: Flat";
    } else {
      angleBadge.innerText = (anglePref === "auto")
        ? (shouldAngle ? "Angle: Auto (40°)" : "Angle: Auto (Flat)")
        : (anglePref === "angled" ? "Angle: 40°" : "Angle: Flat");
    }
  }
  const angleSelect = document.getElementById("select-split-angle");
  if (angleSelect) {
    angleSelect.value = isVertical ? "horizontal" : anglePref;
  }

  updateTrackStatus(currentIndex);
}

window.updateTrackDensityAndAngle = updateTrackDensityAndAngle;

function cycleVisibleSplits() {
  const current = localStorage.getItem("livesplit_visible_splits") || "auto";
  const sequence = ["auto", "6", "8", "10", "12", "16", "all"];
  const curIdx = sequence.indexOf(current);
  const nextIdx = (curIdx !== -1) ? ((curIdx + 1) % sequence.length) : 0;
  const nextVal = sequence[nextIdx];
  if (window.setVisibleSplits) {
    window.setVisibleSplits(nextVal);
  } else {
    localStorage.setItem("livesplit_visible_splits", nextVal);
    updateTrackDensityAndAngle();
  }
}

function cycleSplitAngle() {
  const current = localStorage.getItem("livesplit_split_angle") || "auto";
  const sequence = ["auto", "angled", "horizontal"];
  const nextIdx = (sequence.indexOf(current) + 1) % sequence.length;
  const nextVal = sequence[nextIdx];
  localStorage.setItem("livesplit_split_angle", nextVal);
  if (window.hudLayout) {
    if (nextVal === "angled") {
      const style = window.hudLayout.getTrackStyle();
      if (style) {
        style.deltaPos = (style.namePos === "top") ? "bottom" : "top";
        window.hudLayout.saveTrackStyle();
      }
    }
    window.hudLayout.applyTrackStyle();
  }
  updateTrackDensityAndAngle();
}

function setupTrackScrollInteractions() {
  const viewport = document.getElementById("track-viewport");
  if (!viewport) return;

  // 1. Mouse Wheel Scrolling (consistent with LiveSplit)
  // When rolling the scroll wheel over the progress track or window background (and not in Edit Mode),
  // scroll the split track horizontally (or vertically if sidebar).
  window.addEventListener("wheel", (e) => {
    // Only scroll track when NOT in Edit Mode
    const isEdit = document.body.classList.contains("edit-mode") ||
      (window.hudLayout && typeof window.hudLayout.isEditMode === "function" && window.hudLayout.isEditMode());
    if (isEdit) return;

    // Ignore wheel if cursor is over interactive cards/modals/inputs/dropdowns
    if (e.target && typeof e.target.closest === "function" && e.target.closest("#footer-bar, .modal-backdrop, .layout-toolbar, .settings-profile-dropdown-wrap, input, textarea, select")) {
      return;
    }

    const track = document.getElementById("track");
    if (!track) return;
    const isVertical = track.classList.contains("vertical");

    let delta = 0;
    if (isVertical) {
      delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    } else {
      // In horizontal track, both horizontal scroll (deltaX) and vertical mouse wheel (deltaY) scroll left/right
      delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    }

    if (e.deltaMode === 1) { // DOM_DELTA_LINE
      delta *= 32;
    } else if (e.deltaMode === 2) { // DOM_DELTA_PAGE
      delta *= (isVertical ? viewport.clientHeight : viewport.clientWidth);
    }

    if (delta !== 0) {
      if (isTrackWindowed()) {
        shiftTrackWindow(delta > 0 ? 1 : -1);
      } else {
        if (isVertical) {
          viewport.scrollTop += delta;
        } else {
          viewport.scrollLeft += delta;
        }
      }
      e.preventDefault();
    }
  }, { passive: false });

  // 2. Keyboard Arrow Key Scrolling (Left/Right in horizontal, Up/Down in vertical)
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;

    const isEdit = document.body.classList.contains("edit-mode") ||
      (window.hudLayout && typeof window.hudLayout.isEditMode === "function" && window.hudLayout.isEditMode());
    if (isEdit) return;

    const openModal = document.querySelector(".modal-backdrop.is-open");
    if (openModal) return;

    const track = document.getElementById("track");
    if (!track) return;
    const isVertical = track.classList.contains("vertical");
    const isWindowed = isTrackWindowed();

    if (isVertical) {
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        if (isWindowed) {
          shiftTrackWindow(1);
        } else {
          viewport.scrollTop += 80;
        }
        e.preventDefault();
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        if (isWindowed) {
          shiftTrackWindow(-1);
        } else {
          viewport.scrollTop -= 80;
        }
        e.preventDefault();
      }
    } else {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        if (isWindowed) {
          shiftTrackWindow(1);
        } else {
          viewport.scrollLeft += 100;
        }
        e.preventDefault();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        if (isWindowed) {
          shiftTrackWindow(-1);
        } else {
          viewport.scrollLeft -= 100;
        }
        e.preventDefault();
      }
    }
  });
}

// ============================================================
// 14. DRAGGABLE QUICK SETTINGS CONTROLLER & POSITION CLAMP
// ============================================================
function resetSettingsMenuPosition() {
  const panel = document.getElementById("footer-bar");
  if (!panel) return;
  panel.style.left = "";
  panel.style.top = "";
  panel.style.right = "";
  panel.style.bottom = "";
  panel.classList.remove("is-custom-pos");
  panel.classList.remove("is-dragging");
  localStorage.removeItem("livesplit_settings_pos");
}

function restoreSettingsMenuPosition() {
  const panel = document.getElementById("footer-bar");
  const saved = localStorage.getItem("livesplit_settings_pos");
  if (saved && panel) {
    try {
      const pos = JSON.parse(saved);
      if (typeof pos.left === "number" && typeof pos.top === "number") {
        const maxLeft = Math.max(10, window.innerWidth - 480);
        const maxTop = Math.max(10, window.innerHeight - 300);
        const left = Math.max(10, Math.min(maxLeft, pos.left));
        const top = Math.max(10, Math.min(maxTop, pos.top));
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        panel.style.right = "auto";
        panel.style.bottom = "auto";
        panel.classList.add("is-custom-pos");
      }
    } catch (e) {
      console.warn("Failed to parse saved settings position", e);
    }
  }
}

function initSettingsMenuDraggable() {
  const panel = document.getElementById("footer-bar");
  const header = document.querySelector(".settings-menu-header");
  if (!panel || !header) return;

  header.addEventListener("dblclick", (e) => {
    if (e.target.closest("button") || e.target.closest(".connection-status-pill")) return;
    resetSettingsMenuPosition();
  });

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let origLeft = 0;
  let origTop = 0;

  header.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button") || e.target.closest(".connection-status-pill")) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    isDragging = true;
    header.setPointerCapture(e.pointerId);
    header.classList.add("is-dragging");
    panel.classList.add("is-dragging");

    const rect = panel.getBoundingClientRect();
    origLeft = rect.left;
    origTop = rect.top;
    startX = e.clientX;
    startY = e.clientY;

    panel.style.left = `${origLeft}px`;
    panel.style.top = `${origTop}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.classList.add("is-custom-pos");
  });

  header.addEventListener("pointermove", (e) => {
    if (!isDragging) return;
    e.preventDefault();
    e.stopPropagation();

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    const panelRect = panel.getBoundingClientRect();
    const maxLeft = Math.max(10, window.innerWidth - panelRect.width - 10);
    const maxTop = Math.max(10, window.innerHeight - panelRect.height - 10);

    const newLeft = Math.round(Math.max(10, Math.min(maxLeft, origLeft + dx)));
    const newTop = Math.round(Math.max(10, Math.min(maxTop, origTop + dy)));

    panel.style.left = `${newLeft}px`;
    panel.style.top = `${newTop}px`;
  });

  const onPointerUp = (e) => {
    if (!isDragging) return;
    isDragging = false;
    header.releasePointerCapture(e.pointerId);
    header.classList.remove("is-dragging");
    panel.classList.remove("is-dragging");

    const rect = panel.getBoundingClientRect();
    localStorage.setItem("livesplit_settings_pos", JSON.stringify({
      left: Math.round(rect.left),
      top: Math.round(rect.top)
    }));
  };

  header.addEventListener("pointerup", onPointerUp);
  header.addEventListener("pointercancel", onPointerUp);

  window.addEventListener("resize", () => {
    if (panel.classList.contains("is-custom-pos")) {
      const rect = panel.getBoundingClientRect();
      const maxLeft = Math.max(10, window.innerWidth - rect.width - 10);
      const maxTop = Math.max(10, window.innerHeight - rect.height - 10);
      const clampedL = Math.max(10, Math.min(maxLeft, rect.left));
      const clampedT = Math.max(10, Math.min(maxTop, rect.top));
      panel.style.left = `${clampedL}px`;
      panel.style.top = `${clampedT}px`;
    }
  });

  restoreSettingsMenuPosition();
}

function toggleSettingsMenu(forceOpen) {
  const quickWrap = document.getElementById("quick-settings-wrap");
  const triggerPill = document.getElementById("settings-trigger-pill");
  if (!quickWrap || !triggerPill) return;

  const isOpen = (typeof forceOpen === "boolean")
    ? forceOpen
    : !quickWrap.classList.contains("menu-open");

  if (isOpen) {
    quickWrap.classList.add("menu-open");
    triggerPill.classList.add("is-pressed");
    triggerPill.setAttribute("aria-pressed", "true");
    triggerPill.setAttribute("title", "Click to close LiveSplit Settings");
  } else {
    quickWrap.classList.remove("menu-open");
    triggerPill.classList.remove("is-pressed");
    triggerPill.setAttribute("aria-pressed", "false");
    triggerPill.setAttribute("title", "Click to open LiveSplit Settings");
  }
}

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

  // Live Race Controls & Telemetry
  const raceClient = window.LiveSplit && window.LiveSplit.RaceClient ? (window.LiveSplit.RaceClient.instance || window.LiveSplit.RaceClient) : window.LiveSplitRaceClient;
  const raceToggleBtn = document.getElementById("race-toggle-badge");
  const raceSimBtn = document.getElementById("race-sim-badge");
  const therunRaceCodeInp = document.getElementById("input-therun-race-code");
  const therunSaveBtn = document.getElementById("btn-save-therun-username");
  const btnToggleLeaderboard = document.getElementById("btn-toggle-leaderboard");
  const btnToggleRacePins = document.getElementById("btn-toggle-race-pins");

  if (btnToggleLeaderboard) {
    const syncLeaderboardBtn = () => {
      const state = window.hudLayout ? window.hudLayout.getState() : null;
      const isVis = state ? (state.leaderboard?.visible !== false) : true;
      btnToggleLeaderboard.textContent = isVis ? "Standings: ON" : "Standings: OFF";
      btnToggleLeaderboard.style.color = isVis ? "#38bdf8" : "rgba(148, 163, 184, 0.9)";
    };
    syncLeaderboardBtn();

    btnToggleLeaderboard.addEventListener("click", () => {
      if (window.hudLayout) {
        const state = window.hudLayout.getState();
        if (state) {
          if (!state.leaderboard) {
            state.leaderboard = { x: 42, y: 110, scale: 1.0, visible: true, docked: "none" };
          }
          state.leaderboard.visible = !(state.leaderboard.visible !== false);
          if (typeof window.hudLayout.saveLayout === "function") {
            window.hudLayout.saveLayout();
          }
          if (typeof window.hudLayout.applyComponentLayout === "function") {
            window.hudLayout.applyComponentLayout("leaderboard");
          }
          syncLeaderboardBtn();
          refreshLeaderboard();
        }
      }
    });
  }

  if (btnToggleRacePins && raceClient) {
    const syncRacePinsBtn = () => {
      const isVis = typeof raceClient.areRacePinsVisible === "function" ? raceClient.areRacePinsVisible() : true;
      btnToggleRacePins.textContent = isVis ? "Pins: ON" : "Pins: OFF";
      btnToggleRacePins.style.color = isVis ? "#38bdf8" : "rgba(148, 163, 184, 0.9)";
    };
    syncRacePinsBtn();

    btnToggleRacePins.addEventListener("click", () => {
      if (typeof raceClient.toggleRacePinsVisible === "function") {
        raceClient.toggleRacePinsVisible();
      }
      syncRacePinsBtn();
      updateGhostRunner(lastElapsedSec);
    });
  }

  if (raceClient) {
    let connectCooldownInterval = null;

    const clearConnectCooldownUI = () => {
      if (connectCooldownInterval) {
        clearInterval(connectCooldownInterval);
        connectCooldownInterval = null;
      }
    };

    const syncConnectBtnState = () => {
      const isConn = typeof raceClient.isConnected === "function" && raceClient.isConnected();
      const isSim = typeof raceClient.isSimulating === "function" && raceClient.isSimulating();
      const isStb = typeof raceClient.isStandby === "function" && raceClient.isStandby();
      const isSimStb = typeof raceClient.isSimStandby === "function" && raceClient.isSimStandby();

      if (raceSimBtn) {
        if (isSim) {
          raceSimBtn.textContent = "\uD83E\uDDEA Stop Sim";
          raceSimBtn.style.color = "#ef4444";
        } else if (isSimStb) {
          raceSimBtn.textContent = "\u23F3 Sim Standby";
          raceSimBtn.style.color = "#f59e0b";
        } else {
          raceSimBtn.textContent = "\uD83E\uDDEA Test Race";
          raceSimBtn.style.color = "#f59e0b";
        }
      }

      if (raceToggleBtn) {
        if (isSim) {
          raceToggleBtn.textContent = "Race: Sim";
          raceToggleBtn.style.color = "#4ade80";
        } else if (isConn) {
          raceToggleBtn.textContent = `Race: ${raceClient.getRaceId()}`;
          raceToggleBtn.style.color = "#4ade80";
        } else if (isStb) {
          raceToggleBtn.textContent = "Race: Standby";
          raceToggleBtn.style.color = "#f59e0b";
        } else {
          raceToggleBtn.textContent = "Race: Off";
          raceToggleBtn.style.color = "rgba(148, 163, 184, 0.9)";
        }
      }

      if (!therunSaveBtn) return;
      if (isConn || isSim || isStb) {
        clearConnectCooldownUI();
        therunSaveBtn.disabled = false;
        therunSaveBtn.textContent = "Disconnect";
        therunSaveBtn.classList.add("danger");
        therunSaveBtn.style.color = "#ef4444";
      } else if (!connectCooldownInterval) {
        therunSaveBtn.disabled = false;
        therunSaveBtn.textContent = "Connect";
        therunSaveBtn.classList.remove("danger");
        therunSaveBtn.style.color = "";
      }
    };

    const startCooldownCountdownUI = (durationMs = 5000, prefix = "Wait") => {
      if (!therunSaveBtn) return;
      clearConnectCooldownUI();
      const endMs = Date.now() + durationMs;
      therunSaveBtn.disabled = true;
      therunSaveBtn.classList.remove("danger");
      therunSaveBtn.style.color = "";
      syncConnectBtnState();
      const updateTick = () => {
        const remSec = Math.ceil(Math.max(0, endMs - Date.now()) / 1000);
        if (remSec <= 0) {
          clearConnectCooldownUI();
          syncConnectBtnState();
        } else {
          therunSaveBtn.textContent = `${prefix} (${remSec}s)`;
        }
      };
      updateTick();
      connectCooldownInterval = setInterval(updateTick, 250);
    };

    const isValidRaceCodeInput = (v) => {
      if (!v || typeof v !== "string") return false;
      const s = v.trim();
      return s.length >= 2 && s.length <= 24 && /^[a-zA-Z0-9_-]+$/.test(s);
    };

    const handleRaceDisconnect = () => {
      if (!raceClient) return;
      clearConnectCooldownUI();
      if (typeof raceClient.resetConnectCooldown === "function") {
        raceClient.resetConnectCooldown();
      }
      if (typeof raceClient.stopSimulation === "function" && raceClient.isSimulating()) {
        raceClient.stopSimulation();
      }
      if (typeof raceClient.disconnectFromRace === "function") {
        raceClient.disconnectFromRace();
      }
      if (typeof raceClient.setStandby === "function") {
        raceClient.setStandby(false);
      }
      syncConnectBtnState();
      refreshLeaderboard();
      updateGhostRunner(lastElapsedSec);
    };

    const handleManualRaceConnect = async () => {
      if (!raceClient) return;

      const isActiveOrStandby = raceClient.isSimulating() ||
        (typeof raceClient.isConnected === "function" && raceClient.isConnected()) ||
        (typeof raceClient.isStandby === "function" && raceClient.isStandby());

      if (isActiveOrStandby) {
        handleRaceDisconnect();
        return;
      }

      const codeVal = (therunRaceCodeInp ? therunRaceCodeInp.value : "").trim();
      if (!codeVal) {
        if (therunSaveBtn) {
          therunSaveBtn.textContent = "Enter Code";
          therunSaveBtn.style.color = "#f59e0b";
          setTimeout(() => syncConnectBtnState(), 1500);
        }
        refreshLeaderboard();
        return;
      }

      if (!isValidRaceCodeInput(codeVal)) {
        if (therunSaveBtn) {
          therunSaveBtn.textContent = "Invalid Code";
          therunSaveBtn.style.color = "#ef4444";
          setTimeout(() => syncConnectBtnState(), 1500);
        }
        refreshLeaderboard();
        return;
      }

      const remMs = typeof raceClient.getConnectCooldownRemainingMs === "function"
        ? raceClient.getConnectCooldownRemainingMs()
        : 0;
      if (remMs > 0) {
        startCooldownCountdownUI(remMs, "Wait");
        return;
      }

      const ok = typeof raceClient.connectToRace === "function" && raceClient.connectToRace(codeVal);
      if (ok) {
        syncConnectBtnState();
      } else if (therunSaveBtn) {
        therunSaveBtn.textContent = "Invalid Code";
        therunSaveBtn.style.color = "#ef4444";
        setTimeout(() => syncConnectBtnState(), 1500);
      }
      refreshLeaderboard();
    };

    if (therunRaceCodeInp) {
      therunRaceCodeInp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleManualRaceConnect();
        }
      });
    }

    if (therunSaveBtn) {
      therunSaveBtn.addEventListener("click", handleManualRaceConnect);
    }

    if (raceToggleBtn) {
      raceToggleBtn.addEventListener("click", () => {
        const isActiveOrStandby = raceClient.isSimulating() ||
          (typeof raceClient.isConnected === "function" && raceClient.isConnected()) ||
          (typeof raceClient.isStandby === "function" && raceClient.isStandby());
        if (isActiveOrStandby) {
          handleRaceDisconnect();
        } else {
          handleManualRaceConnect();
        }
      });
    }

    if (raceSimBtn) {
      raceSimBtn.addEventListener("click", () => {
        if (raceClient.isSimulating()) {
          handleRaceDisconnect();
        } else {
          const gtComparisons = (comparisonTimesGT && comparisonTimesGT.length > 0) ? comparisonTimesGT : comparisonTimes;
          const rtComparisons = (comparisonTimesRT && comparisonTimesRT.length > 0) ? comparisonTimesRT : gtComparisons;
          const isAlreadyRunning = (currentIndex >= 0 && typeof lastElapsedSec === "number" && lastElapsedSec > 0);
          raceClient.startSimulation(splitsList, gtComparisons, rtComparisons, { withLobby: !isAlreadyRunning, progressive: !isAlreadyRunning });
          syncConnectBtnState();
          refreshLeaderboard();
        }
      });
    }

    syncConnectBtnState();

    let spectatorTickTimer = null;
    const startSpectatorTick = () => {
      if (spectatorTickTimer) return;
      spectatorTickTimer = setInterval(() => {
        const isConn = raceClient && typeof raceClient.isConnected === "function" && raceClient.isConnected();
        if (!isConn) {
          clearInterval(spectatorTickTimer);
          spectatorTickTimer = null;
          return;
        }
        refreshLeaderboard();
      }, 100);
    };
    const stopSpectatorTick = () => {
      if (spectatorTickTimer) {
        clearInterval(spectatorTickTimer);
        spectatorTickTimer = null;
      }
    };

    if (typeof raceClient.isConnected === "function" && raceClient.isConnected()) {
      startSpectatorTick();
    }

    raceClient.subscribe((event, data) => {
      if (event === "race_connected") {
        syncConnectBtnState();
        startSpectatorTick();
        refreshLeaderboard();
      } else if (event === "race_disconnected") {
        syncConnectBtnState();
        stopSpectatorTick();
        refreshLeaderboard();
      } else if (event === "entrants_update" || event === "entrant_updated") {
        refreshLeaderboard();
        updateGhostRunner(lastElapsedSec);
      } else if (event === "entrant_mute_changed") {
        if (data && data.userId) {
          const marker = document.getElementById(`ghost-marker-race-${data.userId}`);
          if (marker) {
            const globalPinsOn = typeof raceClient.areRacePinsVisible === "function" ? raceClient.areRacePinsVisible() : true;
            marker.style.display = (data.isMuted || !globalPinsOn) ? "none" : "flex";
          }
        }
      } else if (event === "race_pins_visibility_changed") {
        updateGhostRunner(lastElapsedSec);
      } else if (event === "race_standby_changed") {
        syncConnectBtnState();
      } else if (event === "ws_log") {
        if (wsLogsModal && wsLogsModal.style.display !== "none" && wsLogsContainer) {
          const emptyMsg = wsLogsContainer.querySelector("div");
          if (emptyMsg && emptyMsg.textContent.includes("No WebSocket signals logged yet")) {
            wsLogsContainer.innerHTML = "";
          }
          if (data) {
            wsLogsContainer.insertBefore(renderWsLogEntry(data), wsLogsContainer.firstChild);
          }
          if (wsLogsCount) {
            const cur = parseInt(wsLogsCount.textContent || "0", 10);
            wsLogsCount.textContent = (cur + 1);
          }
        }
      } else if (event === "ws_logs_cleared") {
        if (wsLogsModal && wsLogsModal.style.display !== "none") {
          renderAllWsLogs();
        }
      }
    });
  }

  // WebSocket Telemetry Logs Modal
  const btnOpenWsLogs = document.getElementById("btn-open-ws-logs");
  const wsLogsModal = document.getElementById("race-ws-logs-modal");
  const btnCloseWsLogs = document.getElementById("btn-close-ws-logs-modal");
  const btnCloseWsLogsFooter = document.getElementById("btn-close-ws-logs-footer");
  const btnClearWsLogs = document.getElementById("btn-clear-ws-logs");
  const btnCopyWsLogs = document.getElementById("btn-copy-ws-logs");
  const wsLogsContainer = document.getElementById("ws-logs-container");
  const wsLogsCount = document.getElementById("ws-logs-count");
  const wsLogsStatus = document.getElementById("ws-logs-status");

  function renderWsLogEntry(entry) {
    const div = document.createElement("div");
    div.className = "ws-log-item";
    div.style.cssText = "border-bottom: 1px solid rgba(148,163,184,0.15); padding: 5px 0; margin-bottom: 4px;";

    let typeColor = "#38bdf8";
    if (entry.direction === "sys") typeColor = "#f59e0b";
    else if (String(entry.type).includes("split") || String(entry.type).includes("start")) typeColor = "#4ade80";
    else if (String(entry.type).includes("dnf") || String(entry.type).includes("error") || String(entry.type).includes("abandon")) typeColor = "#ef4444";
    else if (String(entry.type).includes("ready")) typeColor = "#a855f7";

    const userBadge = entry.user ? `<span style="background: rgba(56,189,248,0.15); color: #38bdf8; padding: 1px 5px; border-radius: 4px; font-size: 10px; margin-left: 6px;">${escapeHtml(entry.user)}</span>` : "";
    const rawData = (typeof entry.data === "object" && entry.data !== null) ? JSON.stringify(entry.data) : String(entry.data || entry.raw || "");

    div.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
        <div>
          <span style="color: #64748b; font-size: 10px;">${escapeHtml(entry.time)}</span>
          <span style="color: ${typeColor}; font-weight: 600; margin-left: 6px;">[${escapeHtml(entry.type)}]</span>
          ${userBadge}
        </div>
        <span style="color: #64748b; font-size: 9px;">#${entry.id}</span>
      </div>
      <div style="color: #94a3b8; font-size: 10px; overflow-x: auto; max-height: 80px; white-space: pre-wrap; word-break: break-all;">${escapeHtml(rawData)}</div>
    `;
    return div;
  }

  function renderAllWsLogs() {
    if (!wsLogsContainer || !raceClient) return;
    const logs = typeof raceClient.getWebSocketLogs === "function" ? raceClient.getWebSocketLogs() : [];
    if (wsLogsCount) wsLogsCount.textContent = logs.length;
    if (wsLogsStatus) {
      const isConn = typeof raceClient.isConnected === "function" && raceClient.isConnected();
      const rId = typeof raceClient.getRaceId === "function" ? raceClient.getRaceId() : null;
      wsLogsStatus.textContent = isConn ? `(Connected: ${rId})` : "(Disconnected)";
      wsLogsStatus.style.color = isConn ? "#4ade80" : "#94a3b8";
    }

    wsLogsContainer.innerHTML = "";
    if (logs.length === 0) {
      wsLogsContainer.innerHTML = '<div style="color: #64748b; font-style: italic; text-align: center; margin-top: 50px;">No WebSocket signals logged yet.<br>Connect to a race room to capture live telemetry.</div>';
      return;
    }

    logs.forEach(entry => {
      wsLogsContainer.appendChild(renderWsLogEntry(entry));
    });
  }

  if (btnOpenWsLogs && wsLogsModal) {
    btnOpenWsLogs.addEventListener("click", () => {
      renderAllWsLogs();
      wsLogsModal.style.display = "flex";
    });

    const closeWsLogs = () => {
      wsLogsModal.style.display = "none";
    };
    btnCloseWsLogs?.addEventListener("click", closeWsLogs);
    btnCloseWsLogsFooter?.addEventListener("click", closeWsLogs);
    wsLogsModal.addEventListener("click", (e) => {
      if (e.target === wsLogsModal) closeWsLogs();
    });

    btnClearWsLogs?.addEventListener("click", () => {
      if (raceClient && typeof raceClient.clearWebSocketLogs === "function") {
        raceClient.clearWebSocketLogs();
      }
      renderAllWsLogs();
    });

    btnCopyWsLogs?.addEventListener("click", () => {
      const logs = typeof raceClient?.getWebSocketLogs === "function" ? raceClient.getWebSocketLogs() : [];
      const jsonStr = JSON.stringify(logs, null, 2);
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        navigator.clipboard.writeText(jsonStr).then(() => {
          btnCopyWsLogs.textContent = "✓ Copied!";
          setTimeout(() => { btnCopyWsLogs.textContent = "📋 Copy JSON"; }, 2000);
        }).catch(() => fallbackCopy(jsonStr));
      } else {
        fallbackCopy(jsonStr);
      }
    });

    function fallbackCopy(text) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        btnCopyWsLogs.textContent = "✓ Copied!";
        setTimeout(() => { btnCopyWsLogs.textContent = "📋 Copy JSON"; }, 2000);
      } catch (_) {}
      document.body.removeChild(ta);
    }
  }

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
    updateTrackStatus(currentIndex);
  });

  initSettingsMenuDraggable();
  setupTrackScrollInteractions();
  loadCachedSplits();
  updateTrackDensityAndAngle();
  updateGhostBadge();

  const verEl = document.getElementById("overlay-version");
  if (verEl) verEl.innerText = APP_VERSION;

  connect();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initOverlay);
} else {
  initOverlay();
}

// Global exports for layout.js and unit tests
window.APP_VERSION = APP_VERSION;
window.applyActiveComparison = applyActiveComparison;
window.getCurrentComparison = () => currentComparison;
window.getComparisonsList = () => comparisonsList;
window.cycleComparison = cycleComparison;
window.timeStringToSeconds = timeStringToSeconds;
window.formatTargetTime = formatTargetTime;
window.formatDeltaSeconds = formatDeltaSeconds;
window.formatDeltaLive = formatDeltaLive;
window.normalizeComparisonName = normalizeComparisonName;
window.getShortComparisonName = getShortComparisonName;
window.getGhostComparison = () => ghostComparison;
window.getActiveGhostComparisons = () => [...activeGhostComparisons];
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
window.getCurrentTimingMethod = () => currentTimingMethod;
window.setTimerDisplayMode = setTimerDisplayMode;
window.setTimingMethodFocus = setTimingMethodFocus;
window.getTimerDisplayMode = () => timerDisplayMode;
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
window.getLockedDeltas = () => lockedDeltas;
window.getCurrentIndex = () => currentIndex;
window.updateTrackStatus = updateTrackStatus;
window.updateGhostBadge = updateGhostBadge;
window.updateGhostRunner = updateGhostRunner;
window.updateTrackWindow = updateTrackWindow;
window.shiftTrackWindow = shiftTrackWindow;
window.isTrackWindowed = isTrackWindowed;
window.getTrackManualScrollOffset = () => trackManualScrollOffset;
window.showComparisonToast = showComparisonToast;
window.initOverlay = initOverlay;
window.getLastElapsedSec = () => lastElapsedSec;
window.LiveSplit = window.LiveSplit || {};
window.LiveSplit.getLastElapsedSec = () => lastElapsedSec;
