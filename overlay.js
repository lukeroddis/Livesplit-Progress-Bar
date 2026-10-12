const WS_URL = "ws://localhost:16834/livesplit";

// Generic fallback splits used if no .lss is loaded
const DEFAULT_SPLITS = ["Split 1", "Split 2", "Split 3", "Split 4", "Finish"];
const DEFAULT_TARGETS = [60, 120, 180, 240, 300];
const DEFAULT_BESTS = [60, 60, 60, 60, 60];

let splitsList = [];
let comparisonTimes = [];
let bestSegmentTimes = [];
let comparisonTimesGT = [];
let comparisonTimesRT = [];
let bestSegmentTimesGT = [];
let bestSegmentTimesRT = [];
let baselineBestSegmentTimesGT = [];
let baselineBestSegmentTimesRT = [];
let completedSplitTimes = {};
let currentTimingMethod = "GameTime";
let lockedDeltas = {}; 
let ws = null;
let currentIndex = -1;
let isPolling = false;
let inflightResolver = null;
let lastSplitRecordedSec = 0;
let previousDeltaSeconds = 0;

function setGameName(name) {
  const el = document.getElementById("game-name");
  if (el && name) {
    el.innerText = name;
    updatePageTitle();
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

function updateTimerDisplayHierarchy() {
  const rtaEl = document.getElementById("timer-rta");
  const igtEl = document.getElementById("timer-igt");
  const igtBlock = document.getElementById("block-igt");
  if (!rtaEl || !igtEl) return;

  const isRT = currentTimingMethod === "RealTime";
  if (isRT) {
    rtaEl.className = "timer-primary";
    igtEl.className = "timer-secondary";
  } else {
    igtEl.className = "timer-primary";
    rtaEl.className = "timer-secondary";
  }

  // If splits have no GameTime at all (e.g. console speedrun), hide the GameTime timer block
  const hasGameTime = comparisonTimesGT.some(t => t !== null && t > 0) || 
                      bestSegmentTimesGT.some(t => t !== null && t > 0);
  if (igtBlock) {
    igtBlock.style.display = hasGameTime ? "flex" : "none";
  }
}

function applyActiveTimingMethod(method) {
  if (method && (method === "GameTime" || method === "RealTime")) {
    currentTimingMethod = method;
  }
  const badge = document.getElementById("timing-method-badge");
  if (badge) {
    badge.innerText = currentTimingMethod === "RealTime" ? "Real Time" : "Game Time";
  }

  updateTimerDisplayHierarchy();

  const isRT = currentTimingMethod === "RealTime";
  comparisonTimes = splitsList.map((_, i) => {
    return isRT 
      ? (comparisonTimesRT[i] ?? comparisonTimesGT[i] ?? null)
      : (comparisonTimesGT[i] ?? comparisonTimesRT[i] ?? null);
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
}

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
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const sPad = (s < 10 && m > 0) ? `0${s}` : `${s}`;

  if (m > 0) {
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

  let totalSec = 0;
  if (timeUnits.length === 3) totalSec = timeUnits[0] * 3600 + timeUnits[1] * 60 + timeUnits[2];
  else if (timeUnits.length === 2) totalSec = timeUnits[0] * 60 + timeUnits[1];
  else if (timeUnits.length === 1) totalSec = timeUnits[0];

  const signedSeconds = isAhead ? -(totalSec + fracSec) : (totalSec + fracSec);

  if (totalSec === 0 && fracSec === 0 && !isAhead) {
    return { text: "±0.0", isAhead: false, signedSeconds: 0 };
  }

  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const secFormatted = (s < 10 && m > 0) ? `0${s}` : `${s}`;

  let outputText = "";
  if (m > 0) {
    outputText = `${sign}${m}:${secFormatted}`;
  } else {
    outputText = `${sign}${secFormatted}${decPart || ".0"}`;
  }

  return { text: outputText, isAhead, signedSeconds };
}

function parseLSS(xmlText) {
  try {
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

      segments.forEach(seg => {
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

        // LiveSplit calculates Best Segment from the minimum of BestSegmentTime and all attempts in SegmentHistory
        const historyTimes = Array.from(seg.querySelectorAll("SegmentHistory > Time"));
        historyTimes.forEach(tNode => {
          const hgt = timeStringToSeconds(tNode.querySelector("GameTime")?.textContent);
          const hrt = timeStringToSeconds(tNode.querySelector("RealTime")?.textContent);
          if (hgt !== null && hgt > 0) {
            if (bestSecGT === null || hgt < bestSecGT) bestSecGT = hgt;
          }
          if (hrt !== null && hrt > 0) {
            if (bestSecRT === null || hrt < bestSecRT) bestSecRT = hrt;
          }
        });

        splitsList.push(name);
        comparisonTimesGT.push(timeStringToSeconds(pbGT));
        comparisonTimesRT.push(timeStringToSeconds(pbRT));
        bestSegmentTimesGT.push(bestSecGT);
        bestSegmentTimesRT.push(bestSecRT);
      });

      // Auto-detect timing method: if splits have NO GameTime at all (e.g. console speedruns), default to RealTime
      const hasAnyGameTime = comparisonTimesGT.some(t => t !== null && t > 0) || 
                             bestSegmentTimesGT.some(t => t !== null && t > 0);
      if (!hasAnyGameTime) {
        currentTimingMethod = "RealTime";
        localStorage.setItem("livesplit_timing_method", "RealTime");
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

      updateGoldBadge();
      applyActiveTimingMethod(currentTimingMethod);
      renderTrack();
    }
  } catch (e) {
    console.error("Failed to parse .lss XML", e);
  }
}

function updateGoldBadge() {
  const badge = document.getElementById("gold-toggle-badge");
  if (badge) {
    const isEnabled = localStorage.getItem("livesplit_enable_golds") !== "false";
    badge.innerText = isEnabled ? "Golds: ON" : "Golds: OFF";
    badge.style.color = isEnabled ? "#facc15" : "rgba(148, 163, 184, 0.7)";
  }
}

function toggleGoldSegments() {
  const current = localStorage.getItem("livesplit_enable_golds") !== "false";
  localStorage.setItem("livesplit_enable_golds", (!current) ? "true" : "false");
  updateGoldBadge();
}

function toggleTimingMethod() {
  const next = currentTimingMethod === "RealTime" ? "GameTime" : "RealTime";
  localStorage.setItem("livesplit_timing_method", next);
  applyActiveTimingMethod(next);
}

function loadCachedSplits() {
  const savedMethod = localStorage.getItem("livesplit_timing_method");
  if (savedMethod === "RealTime" || savedMethod === "GameTime") {
    currentTimingMethod = savedMethod;
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

      updateGoldBadge();
      applyActiveTimingMethod(currentTimingMethod);
      renderTrack();
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

  updateGoldBadge();
  applyActiveTimingMethod(currentTimingMethod);
  renderTrack();
}

function sendCommand(cmd, timeoutMs = 80) {
  return new Promise((resolve) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      resolve(null);
      return;
    }

    let timer = setTimeout(() => {
      inflightResolver = null;
      resolve(null);
    }, timeoutMs);

    inflightResolver = (res) => {
      clearTimeout(timer);
      resolve(res);
    };

    ws.send(cmd.trim());
  });
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

function renderTrack() {
  const track = document.getElementById("track");
  track.innerHTML = "";

  // 1. Initial Start Node
  const startItem = document.createElement("div");
  startItem.className = "split-item origin-node completed";
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

  updateTrackDensityAndAngle();
  updateTrackStatus(currentIndex);
}

function updateTrackStatus(idx) {
  currentIndex = idx;
  const viewport = document.getElementById("track-viewport");

  if (idx < 0) {
    viewport.scrollTo({ left: 0, behavior: 'smooth' });
  } else {
    const activeItem = document.getElementById(`item-${idx}`);
    if (activeItem) {
      const scrollTarget = activeItem.offsetLeft + (activeItem.offsetWidth / 2) - (viewport.clientWidth / 2);
      viewport.scrollTo({ left: Math.max(0, scrollTarget), behavior: 'smooth' });
    }
  }

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
        }
      } else if (i === idx) {
        item.classList.add("current");
        if (!lockedDeltas[i]) {
          const deltaSpan = document.getElementById(`delta-val-${i}`);
          if (deltaSpan) {
            deltaSpan.innerText = "";
            deltaSpan.className = "split-delta-val";
          }
        }
      } else {
        if (fill) {
          fill.style.width = "0%";
          fill.className = "segment-bar-fill";
        }
        const deltaSpan = document.getElementById(`delta-val-${i}`);
        if (deltaSpan) {
          deltaSpan.innerText = "";
          deltaSpan.className = "split-delta-val";
        }
      }
    } else {
      item.className = "split-item";
      if (fill) {
        fill.style.width = "0%";
        fill.className = "segment-bar-fill";
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
}

function updateLiveSegmentProgress(currentSec) {
  if (currentIndex < 0 || currentIndex >= splitsList.length || currentSec === null) return;

  const fill = document.getElementById(`fill-${currentIndex}`);
  const deltaSpan = document.getElementById(`delta-val-${currentIndex}`);

  const prevTargetSec = (currentIndex > 0 && comparisonTimes[currentIndex - 1] !== null)
    ? comparisonTimes[currentIndex - 1]
    : 0;

  const currentTargetSec = comparisonTimes[currentIndex];
  if (!currentTargetSec || currentTargetSec <= prevTargetSec) return;

  const expectedDuration = currentTargetSec - prevTargetSec;
  const elapsedInSegment = Math.max(0, currentSec - lastSplitRecordedSec);

  if (expectedDuration <= 0) return;

  // 1. Progress Bar Fill
  if (fill) {
    const progressRatio = Math.max(0, elapsedInSegment / expectedDuration);
    const pct = Math.min(100, progressRatio * 100);
    fill.style.width = `${pct.toFixed(1)}%`;

    if (progressRatio > 1.0) {
      fill.classList.add("overdue");
    } else {
      fill.classList.remove("overdue");
    }
  }

  // 2. Live Delta on Current Split:
  // Displays and updates live once the runner begins losing time to the Best Segment
  if (deltaSpan) {
    const isGoldsEnabled = (localStorage.getItem("livesplit_enable_golds") !== "false");
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

      const allDeltaClasses = [
        "delta-ahead-gaining", "delta-ahead-losing", 
        "delta-behind-gaining", "delta-behind-losing", 
        "delta-gold"
      ];
      deltaSpan.classList.remove(...allDeltaClasses);

      if (liveDeltaSec <= 0) {
        deltaSpan.classList.add(gainedTime ? "delta-ahead-gaining" : "delta-ahead-losing");
      } else {
        deltaSpan.classList.add(gainedTime ? "delta-behind-gaining" : "delta-behind-losing");
      }
    } else {
      // While still on pace to gold (within best segment time), keep delta hidden
      deltaSpan.innerText = "";
      deltaSpan.className = "split-delta-val";
    }
  }
}

function setDeltaDisplay(index, deltaInfo, stateClass, splitTimeSec) {
  if (index < 0 || index >= splitsList.length) return;
  const el = document.getElementById(`delta-${index}`);
  const item = document.getElementById(`item-${index}`);
  const fill = document.getElementById(`fill-${index}`);
  if (!el || !item) return;

  const deltaSpan = document.getElementById(`delta-val-${index}`) || el.querySelector(".split-delta-val");
  const timeSpan = document.getElementById(`time-val-${index}`) || el.querySelector(".split-time-val");

  // Clean up previous state classes
  const allStates = [
    "target-time", 
    "ahead-gaining", "ahead-losing", 
    "behind-gaining", "behind-losing", 
    "gold", 
    "delta-ahead-gaining", "delta-ahead-losing", 
    "delta-behind-gaining", "delta-behind-losing", 
    "delta-gold"
  ];
  el.classList.remove(...allStates);
  item.classList.remove(...allStates);

  if (deltaSpan) {
    deltaSpan.classList.remove(...allStates);
    if (deltaInfo && deltaInfo.text) {
      deltaSpan.innerText = deltaInfo.text;
      deltaSpan.classList.add(`delta-${stateClass}`);
    } else {
      deltaSpan.innerText = "";
    }
  }

  if (timeSpan) {
    timeSpan.classList.remove(...allStates);
    if (splitTimeSec !== null && splitTimeSec !== undefined && !isNaN(splitTimeSec)) {
      timeSpan.innerText = formatTargetTime(splitTimeSec);
      timeSpan.className = "split-time-val";
    } else {
      const targetVal = formatTargetTime(comparisonTimes[index]);
      timeSpan.innerText = targetVal || "-";
      timeSpan.className = "split-time-val target-time";
    }
  }

  if (fill) {
    fill.style.width = "100%";
    fill.className = `segment-bar-fill ${stateClass}`;
  }

  item.classList.add(stateClass);
}

function connect() {
  ws = new WebSocket(WS_URL);

  ws.onopen = async () => {
    const status = document.getElementById("connection-status");
    status.innerText = "CONNECTED";
    status.style.color = "#4ade80";

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
    inflightResolver = null;
    const status = document.getElementById("connection-status");
    status.innerText = "DISCONNECTED";
    status.style.color = "#ef4444";
    setTimeout(connect, 1500);
  };

  ws.onerror = () => ws.close();
}

async function pollLoop() {
  while (ws && ws.readyState === WebSocket.OPEN) {
    // 1. Game Time
    const igt = await sendCommand("getcurrentgametime");
    let igtSec = null;
    if (igt && igt !== "-") {
      const parts = igt.split(".");
      document.getElementById("timer-igt").innerText = parts.length > 1 
        ? `${parts[0]}.${parts[1].slice(0, 2)}` 
        : parts[0];
      igtSec = timeStringToSeconds(igt);
    }

    // 2. Real Time
    const rta = await sendCommand("getcurrentrealtime");
    let rtaSec = null;
    if (rta && rta !== "-") {
      const parts = rta.split(".");
      document.getElementById("timer-rta").innerText = parts.length > 1 
        ? `${parts[0]}.${parts[1].slice(0, 2)}` 
        : parts[0];
      rtaSec = timeStringToSeconds(rta);
    }

    // Total elapsed seconds for the active timing method (with fallback)
    let currentTotalSec = (currentTimingMethod === "RealTime")
      ? (rtaSec ?? igtSec)
      : (igtSec ?? rtaSec);

    // 3. Split Index
    const splitIdxStr = await sendCommand("getsplitindex");
    const idx = parseInt(splitIdxStr, 10);

    if (!isNaN(idx)) {
      // Reset
      if (idx === -1 || (idx === 0 && currentIndex > 0)) {
        lockedDeltas = {};
        completedSplitTimes = {};
        lastSplitRecordedSec = 0;
        previousDeltaSeconds = 0;

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
            fill.style.width = "0%";
            fill.className = "segment-bar-fill";
          }
          if (item) {
            item.className = "split-item";
          }
        }
        updateTrackStatus(idx);
        await syncLiveSplitMetadata();
      } 
      // Completed Split
      else if (idx !== currentIndex) {
        if (currentIndex === -1 && idx === 0) {
          // Timer just started
          lockedDeltas = {};
          completedSplitTimes = {};
          lastSplitRecordedSec = 0;
          previousDeltaSeconds = 0;

          // Fetch target time for the first split from LiveSplit
          if (splitsList.length > 0) {
            const rawCompTime = await sendCommand("getcomparisonsplittime");
            const compSec = timeStringToSeconds(rawCompTime);
            if (compSec !== null && compSec > 0) {
              comparisonTimes[0] = compSec;
              if (currentTimingMethod === "RealTime") comparisonTimesRT[0] = compSec;
              else comparisonTimesGT[0] = compSec;
            }
          }
        } else if (currentIndex >= 0 && idx > currentIndex) {
          const prevIdx = currentIndex;

          // 1. Get exact cumulative split time from LiveSplit for the completed split
          const rawLastSplit = await sendCommand("getlastsplittime");
          let splitTimeSec = timeStringToSeconds(rawLastSplit);
          if (splitTimeSec === null || splitTimeSec <= 0) {
            splitTimeSec = currentTotalSec;
          }

          // 2. Compute segment duration
          const prevSplitSec = (prevIdx > 0 && completedSplitTimes[prevIdx - 1] != null)
            ? completedSplitTimes[prevIdx - 1]
            : 0;

          let segmentDurationSec = (splitTimeSec !== null && splitTimeSec >= prevSplitSec)
            ? (splitTimeSec - prevSplitSec)
            : ((currentTotalSec !== null && currentTotalSec >= lastSplitRecordedSec)
                ? (currentTotalSec - lastSplitRecordedSec)
                : null);

          if (splitTimeSec !== null) {
            completedSplitTimes[prevIdx] = splitTimeSec;
            lastSplitRecordedSec = splitTimeSec;
          }

          // 3. Get delta from LiveSplit
          const rawFinalDelta = await sendCommand("getdelta");
          const finalDeltaInfo = formatDeltaLive(rawFinalDelta);

          // 4. Evaluate Gold Split (Personal Best Segment)
          let isGold = false;
          const isGoldsEnabled = (localStorage.getItem("livesplit_enable_golds") !== "false");
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

          // 5. Determine State Classification (LiveSplit Standard 4-State)
          let stateClass = "behind-losing";
          if (isGold) {
            stateClass = "gold";
          } else if (finalDeltaInfo) {
            const currentDeltaSec = finalDeltaInfo.signedSeconds;
            const deltaChange = currentDeltaSec - previousDeltaSeconds;
            const gainedTime = deltaChange <= 0.001; // Gained time or stayed even vs PB segment

            if (finalDeltaInfo.isAhead) {
              stateClass = gainedTime ? "ahead-gaining" : "ahead-losing";
            } else {
              stateClass = gainedTime ? "behind-gaining" : "behind-losing";
            }
          } else {
            const targetSec = comparisonTimes[prevIdx];
            if (targetSec && splitTimeSec) {
              stateClass = (splitTimeSec <= targetSec) ? "ahead-gaining" : "behind-losing";
            }
          }

          if (finalDeltaInfo) {
            previousDeltaSeconds = finalDeltaInfo.signedSeconds;
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

          const displayDelta = finalDeltaInfo || { text: "-", isAhead: false, signedSeconds: 0 };
          lockedDeltas[prevIdx] = { deltaInfo: displayDelta, stateClass, splitTimeSec };
          setDeltaDisplay(prevIdx, displayDelta, stateClass, splitTimeSec);

          // Query target comparison time once for the next newly active split
          if (idx < splitsList.length) {
            const rawNextComp = await sendCommand("getcomparisonsplittime");
            const nextCompSec = timeStringToSeconds(rawNextComp);
            if (nextCompSec !== null && nextCompSec > 0) {
              comparisonTimes[idx] = nextCompSec;
              if (currentTimingMethod === "RealTime") comparisonTimesRT[idx] = nextCompSec;
              else comparisonTimesGT[idx] = nextCompSec;
              const nextTimeSpan = document.getElementById(`time-val-${idx}`);
              if (nextTimeSpan) {
                nextTimeSpan.innerText = formatTargetTime(nextCompSec) || "-";
              }
            }
          }
        }
        updateTrackStatus(idx);
      } else {
        if (currentTotalSec !== null) {
          updateLiveSegmentProgress(currentTotalSec);
        }
      }
    }

    await new Promise((r) => setTimeout(r, 33));
  }
}

const fileInput = document.getElementById("file-input");
fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (evt) => parseLSS(evt.target.result);
    reader.readAsText(file);
  }
});

window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file && (file.name.endsWith(".lss") || file.name.endsWith(".xml"))) {
    const reader = new FileReader();
    reader.onload = (evt) => parseLSS(evt.target.result);
    reader.readAsText(file);
  }
});

function updateTrackDensityAndAngle() {
  const viewport = document.getElementById("track-viewport");
  const track = document.getElementById("track");
  if (!viewport || !track) return;

  const viewportWidth = viewport.clientWidth || window.innerWidth || 1920;
  const splitPref = localStorage.getItem("livesplit_visible_splits") || "auto";
  const anglePref = localStorage.getItem("livesplit_split_angle") || "auto";

  let spacing = 220;

  if (splitPref === "all") {
    // Fit all splits on screen without scrolling
    const totalCount = Math.max(1, splitsList.length + 1); // +1 for the Start node
    spacing = Math.max(45, Math.floor((viewportWidth - 50) / totalCount));
  } else if (splitPref !== "auto") {
    const num = parseInt(splitPref, 10);
    if (!isNaN(num) && num > 0) {
      spacing = Math.max(45, Math.floor(viewportWidth / num));
    }
  } else {
    // Default auto spacing
    spacing = 220;
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
    if (numInput) numInput.value = 8;
    if (modalNumInput) modalNumInput.value = 8;
    if (valBadge) valBadge.innerText = "Auto";
  }

  // Determine whether to apply 40° angle strictly to split names
  let shouldAngle = false;
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
    angleBadge.innerText = (anglePref === "auto")
      ? (shouldAngle ? "Angle: Auto (40°)" : "Angle: Auto (Flat)")
      : (anglePref === "angled" ? "Angle: 40°" : "Angle: Flat");
  }
  const angleSelect = document.getElementById("select-split-angle");
  if (angleSelect) {
    angleSelect.value = anglePref;
  }

  if (currentIndex >= 0) {
    updateTrackStatus(currentIndex);
  }
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

window.onload = () => {
  document.getElementById("gold-toggle-badge")?.addEventListener("click", toggleGoldSegments);
  document.getElementById("timing-method-badge")?.addEventListener("click", toggleTimingMethod);
  document.getElementById("split-density-badge")?.addEventListener("click", cycleVisibleSplits);
  document.getElementById("split-angle-badge")?.addEventListener("click", cycleSplitAngle);
  loadCachedSplits();
  updateTrackDensityAndAngle();
  connect();
};
