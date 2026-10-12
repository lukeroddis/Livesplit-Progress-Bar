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
let comparisonsList = ["Personal Best", "Best Segments", "Average Segments", "Worst Segments"];
let currentComparison = "Personal Best";
let comparisonsDataGT = {};
let comparisonsDataRT = {};
let completedSplitTimes = {};
let currentTimingMethod = "GameTime";
let lockedDeltas = {}; 
let ws = null;
let currentIndex = -1;
let isPolling = false;
let inflightResolver = null;
let lastSplitRecordedSec = 0;
let previousDeltaSeconds = 0;
let lastElapsedSec = 0;

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
  const badge = document.getElementById("timing-method-badge");
  if (badge) {
    badge.innerText = currentTimingMethod === "RealTime" ? "Real Time" : "Game Time";
  }

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
}

function applyActiveComparison(compName, updateLiveSplit = false) {
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

  for (let i = 0; i < splitsList.length; i++) {
    if (!lockedDeltas[i]) {
      const timeSpan = document.getElementById(`time-val-${i}`);
      if (timeSpan) {
        const targetVal = formatTargetTime(comparisonTimes[i]);
        timeSpan.innerText = targetVal || "-";
      }
    }
  }

  if (updateLiveSplit && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(`setcomparison ${currentComparison}`);
  }
}

function cycleComparison() {
  if (comparisonsList.length === 0) return;
  const currentIdx = comparisonsList.indexOf(currentComparison);
  const nextIdx = (currentIdx + 1) % comparisonsList.length;
  const nextComp = comparisonsList[nextIdx];
  applyActiveComparison(nextComp, true);
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

function sanitizeComparisonTimes(times, fallbackTimes) {
  if (!times || !Array.isArray(times) || times.length === 0) {
    return fallbackTimes && Array.isArray(fallbackTimes) ? [...fallbackTimes] : [];
  }
  const len = splitsList.length > 0 ? splitsList.length : times.length;
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
      localStorage.setItem("livesplit_comparisons_list", JSON.stringify(comparisonsList));
      localStorage.setItem("livesplit_comparisons_gt", JSON.stringify(comparisonsDataGT));
      localStorage.setItem("livesplit_comparisons_rt", JSON.stringify(comparisonsDataRT));

      updateGoldBadge();
      applyActiveComparison(currentComparison, false);
      renderTrack();
      if (window.hudLayout && window.hudLayout.syncTrackModalUI) {
        window.hudLayout.syncTrackModalUI();
      }
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
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(next === "RealTime" ? "switchto realtime" : "switchto gametime");
  }
}

function loadCachedSplits() {
  const savedMethod = localStorage.getItem("livesplit_timing_method");
  if (savedMethod === "RealTime" || savedMethod === "GameTime") {
    currentTimingMethod = savedMethod;
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

      updateGoldBadge();
      applyActiveComparison(currentComparison, false);
      renderTrack();
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
  applyActiveComparison(currentComparison, false);
  renderTrack();
  if (window.hudLayout && window.hudLayout.syncTrackModalUI) {
    window.hudLayout.syncTrackModalUI();
  }
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

  // Inject or preserve live ghost marker inside #track
  let ghostMarker = document.getElementById("ghost-marker");
  if (!ghostMarker) {
    ghostMarker = document.createElement("div");
    ghostMarker.className = "ghost-marker";
    ghostMarker.id = "ghost-marker";
    ghostMarker.style.display = "none";
    ghostMarker.innerHTML = `
      <div class="ghost-icon-wrap"><span id="ghost-icon">🏆</span></div>
      <div class="ghost-needle"></div>
      <div class="ghost-delta" id="ghost-delta">+0.0s</div>
    `;
  }
  track.appendChild(ghostMarker);
  track.style.setProperty("--ghost-opacity", ghostOpacity);

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

// ============================================================
// LIVE GHOST RUNNER COMPARISON ENGINE
// ============================================================
let ghostComparison = localStorage.getItem("livesplit_ghost_comparison") || "off";
let ghostOpacity = parseFloat(localStorage.getItem("livesplit_ghost_opacity") || "85") / 100;

function getGhostComparisonInfo() {
  if (!ghostComparison || ghostComparison === "off") return null;

  const isRT = (currentTimingMethod === "RealTime");
  const compData = isRT ? comparisonsDataRT : comparisonsDataGT;
  const altData = isRT ? comparisonsDataGT : comparisonsDataRT;
  const compKeys = Object.keys(compData);
  const altKeys = Object.keys(altData);
  const fallbackTimes = isRT ? comparisonTimesRT : comparisonTimesGT;

  const lowGhost = ghostComparison.toLowerCase().trim();

  // 1. World Record match (wr / world record)
  const isWRMatch = (lowGhost === "wr" || lowGhost.includes("world record"));
  if (isWRMatch) {
    // Check active compData first
    const wrKey = compKeys.find(k => k.toLowerCase().includes("world record") || k.toLowerCase() === "wr");
    if (wrKey && compData[wrKey] && compData[wrKey].some(t => t !== null && t > 0)) {
      return { id: "wr", name: wrKey, icon: "🏆", times: sanitizeComparisonTimes(compData[wrKey], fallbackTimes) };
    }
    // Check alternate timing method compData if active timing method lacks WR entries
    const altWrKey = altKeys.find(k => k.toLowerCase().includes("world record") || k.toLowerCase() === "wr");
    if (altWrKey && altData[altWrKey] && altData[altWrKey].some(t => t !== null && t > 0)) {
      return { id: "wr", name: altWrKey, icon: "🏆", times: sanitizeComparisonTimes(altData[altWrKey], fallbackTimes) };
    }
    // Fallback if no explicit WR track in .lss: use Best Segments / Sum of Best pace
    if (compData["Best Segments"] && compData["Best Segments"].some(t => t !== null && t > 0)) {
      return { id: "wr", name: "Best Segments (WR Fallback)", icon: "🏆", times: sanitizeComparisonTimes(compData["Best Segments"], fallbackTimes) };
    }
    return { id: "wr", name: "Personal Best", icon: "🏆", times: sanitizeComparisonTimes(compData["Personal Best"] || fallbackTimes, fallbackTimes) };
  }

  // 2. Personal Best (pb)
  if (lowGhost === "pb" || lowGhost === "personal best") {
    return { id: "pb", name: "Personal Best", icon: "🥈", times: sanitizeComparisonTimes(compData["Personal Best"] || fallbackTimes, fallbackTimes) };
  }

  // 3. Best Segments (best)
  if (lowGhost === "best" || lowGhost === "best segments") {
    return { id: "best", name: "Best Segments", icon: "⭐", times: sanitizeComparisonTimes(compData["Best Segments"] || fallbackTimes, fallbackTimes) };
  }

  // 4. Average Segments (average)
  if (lowGhost === "average" || lowGhost === "average segments") {
    return { id: "average", name: "Average Segments", icon: "📊", times: sanitizeComparisonTimes(compData["Average Segments"] || fallbackTimes, fallbackTimes) };
  }

  // 5. Worst Segments (worst)
  if (lowGhost === "worst" || lowGhost === "worst segments") {
    return { id: "worst", name: "Worst Segments", icon: "🐢", times: sanitizeComparisonTimes(compData["Worst Segments"] || fallbackTimes, fallbackTimes) };
  }

  // 6. Direct match with any custom comparison by name
  if (compData[ghostComparison] && compData[ghostComparison].some(t => t !== null && t > 0)) {
    return { id: ghostComparison, name: ghostComparison, icon: "👤", times: sanitizeComparisonTimes(compData[ghostComparison], fallbackTimes) };
  }
  if (altData[ghostComparison] && altData[ghostComparison].some(t => t !== null && t > 0)) {
    return { id: ghostComparison, name: ghostComparison, icon: "👤", times: sanitizeComparisonTimes(altData[ghostComparison], fallbackTimes) };
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

function updateGhostRunner(currentSec) {
  const marker = document.getElementById("ghost-marker");
  const edgeLeft = document.getElementById("ghost-edge-left");
  const edgeRight = document.getElementById("ghost-edge-right");
  const viewport = document.getElementById("track-viewport");

  if (!viewport) return;

  const ghostInfo = getGhostComparisonInfo();
  if (!ghostInfo || currentSec === null || currentSec <= 0 || splitsList.length === 0) {
    if (marker) marker.style.display = "none";
    if (edgeLeft) edgeLeft.style.display = "none";
    if (edgeRight) edgeRight.style.display = "none";
    return;
  }

  const { segIdx, ratio } = calculateGhostProgress(currentSec, ghostInfo.times);

  // Calculate physical track X coordinates
  const nodeStart = document.getElementById("node-start");
  if (!nodeStart) return;

  let startX = 0;
  let endX = 0;

  if (segIdx === 0) {
    startX = nodeStart.offsetLeft + (nodeStart.offsetWidth / 2);
    const item0 = document.getElementById("item-0");
    endX = item0 ? (item0.offsetLeft + (item0.offsetWidth / 2)) : startX + 220;
  } else {
    const prevItem = document.getElementById(`item-${segIdx - 1}`);
    const currentItem = document.getElementById(`item-${segIdx}`);
    if (prevItem && currentItem) {
      startX = prevItem.offsetLeft + (prevItem.offsetWidth / 2);
      endX = currentItem.offsetLeft + (currentItem.offsetWidth / 2);
    } else {
      if (marker) marker.style.display = "none";
      return;
    }
  }

  const ghostX = startX + ratio * (endX - startX);

  // Compute live delta vs ghost at runner's current progress
  let runnerSegProgress = 0;
  if (currentIndex >= 0 && currentIndex < splitsList.length) {
    const curTarget = comparisonTimes[currentIndex];
    const prevTarget = (currentIndex > 0) ? (comparisonTimes[currentIndex - 1] || 0) : 0;
    const dur = curTarget ? (curTarget - prevTarget) : 0;
    const elapsedInSeg = Math.max(0, currentSec - lastSplitRecordedSec);
    runnerSegProgress = (dur > 0) ? Math.min(1.0, elapsedInSeg / dur) : 0;
  }

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

  // Check viewport bounds for off-screen pills
  const scrollLeft = viewport.scrollLeft;
  const clientWidth = viewport.clientWidth;
  const visibleMin = scrollLeft + 25;
  const visibleMax = scrollLeft + clientWidth - 25;

  if (ghostX < visibleMin) {
    // Off-screen to the left (behind camera)
    if (marker) marker.style.display = "none";
    if (edgeRight) edgeRight.style.display = "none";
    if (edgeLeft) {
      edgeLeft.style.display = "flex";
      const iconEl = document.getElementById("ghost-edge-left-icon");
      const valEl = document.getElementById("ghost-edge-left-val");
      if (iconEl) iconEl.innerText = ghostInfo.icon;
      if (valEl) {
        valEl.innerText = deltaStr;
        valEl.style.color = isAhead ? "#22c55e" : "#ef4444";
      }
    }
  } else if (ghostX > visibleMax) {
    // Off-screen to the right (ahead of camera)
    if (marker) marker.style.display = "none";
    if (edgeLeft) edgeLeft.style.display = "none";
    if (edgeRight) {
      edgeRight.style.display = "flex";
      const iconEl = document.getElementById("ghost-edge-right-icon");
      const valEl = document.getElementById("ghost-edge-right-val");
      if (iconEl) iconEl.innerText = ghostInfo.icon;
      if (valEl) {
        valEl.innerText = deltaStr;
        valEl.style.color = isAhead ? "#22c55e" : "#ef4444";
      }
    }
  } else {
    // On-screen!
    if (edgeLeft) edgeLeft.style.display = "none";
    if (edgeRight) edgeRight.style.display = "none";
    if (marker) {
      marker.style.display = "flex";
      marker.style.transform = `translateX(${ghostX}px) translate(-50%, -50%)`;

      const iconEl = document.getElementById("ghost-icon");
      const deltaEl = document.getElementById("ghost-delta");
      if (iconEl) iconEl.innerText = ghostInfo.icon;
      if (deltaEl) {
        deltaEl.innerText = deltaStr;
        deltaEl.className = `ghost-delta ${isAhead ? "delta-ahead" : "delta-behind"}`;
      }
    }
  }
}

function updateGhostBadge() {
  const badge = document.getElementById("ghost-badge");
  if (!badge) return;
  const low = (ghostComparison || "").toLowerCase().trim();
  if (!ghostComparison || ghostComparison === "off") {
    badge.innerText = "Ghost: Off";
    badge.style.color = "rgba(148, 163, 184, 0.9)";
  } else if (ghostComparison === "wr" || low.includes("world record")) {
    badge.innerText = "Ghost: 🏆 WR";
    badge.style.color = "#facc15";
  } else if (ghostComparison === "pb" || low === "personal best") {
    badge.innerText = "Ghost: 🥈 PB";
    badge.style.color = "#38bdf8";
  } else if (ghostComparison === "best" || low === "best segments") {
    badge.innerText = "Ghost: ⭐ Best";
    badge.style.color = "#facc15";
  } else if (ghostComparison === "average" || low === "average segments") {
    badge.innerText = "Ghost: 📊 Avg";
    badge.style.color = "#a78bfa";
  } else if (ghostComparison === "worst" || low === "worst segments") {
    badge.innerText = "Ghost: 🐢 Worst";
    badge.style.color = "#f87171";
  } else {
    badge.innerText = `Ghost: 👤 ${ghostComparison.slice(0, 8)}`;
    badge.style.color = "#38bdf8";
  }
}

function cycleGhostComparison() {
  const options = ["off", "wr", "pb", "best", "average", "worst"];
  if (comparisonsList && comparisonsList.length > 0) {
    comparisonsList.forEach(c => {
      const low = c.toLowerCase();
      if (!["personal best", "best segments", "average segments", "worst segments"].includes(low) &&
          !low.includes("world record") && low !== "wr") {
        if (!options.includes(c)) options.push(c);
      }
    });
  }
  const curIdx = options.indexOf(ghostComparison);
  const next = (curIdx !== -1) ? options[(curIdx + 1) % options.length] : "off";
  setGhostComparison(next);
}

function setGhostComparison(val) {
  ghostComparison = val || "off";
  localStorage.setItem("livesplit_ghost_comparison", ghostComparison);
  updateGhostBadge();
  const marker = document.getElementById("ghost-marker");
  const edgeLeft = document.getElementById("ghost-edge-left");
  const edgeRight = document.getElementById("ghost-edge-right");
  if (ghostComparison === "off") {
    if (marker) marker.style.display = "none";
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

let canQueryTimingMethod = true;
let canQueryComparison = true;

function connect() {
  ws = new WebSocket(WS_URL);

  ws.onopen = async () => {
    const status = document.getElementById("connection-status");
    status.innerText = "CONNECTED";
    status.style.color = "#4ade80";

    canQueryTimingMethod = true;
    canQueryComparison = true;

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

let pollTick = 0;

async function pollLoop() {
  while (ws && ws.readyState === WebSocket.OPEN) {
    // 0. Periodic Auto-Sync with LiveSplit hotkeys (every ~500ms)
    pollTick = (pollTick + 1) % 15;
    if (pollTick === 0) {
      const isSyncEnabled = (localStorage.getItem("livesplit_sync_hotkeys") !== "false");
      if (isSyncEnabled) {
        // Query active timing method (with fallback if unsupported)
        if (canQueryTimingMethod) {
          const lsMethod = await sendCommand("gettimingmethod", 40);
          if (lsMethod && (lsMethod === "RealTime" || lsMethod === "GameTime")) {
            if (lsMethod !== currentTimingMethod) {
              applyActiveTimingMethod(lsMethod);
              localStorage.setItem("livesplit_timing_method", lsMethod);
            }
          } else if (lsMethod === null) {
            canQueryTimingMethod = false;
          }
        }

        // Query active comparison (with fallback if unsupported)
        if (canQueryComparison) {
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
    }

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
    if (currentTotalSec !== null) {
      lastElapsedSec = currentTotalSec;
    }

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
        lastElapsedSec = 0;

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
          updateGhostRunner(currentTotalSec);
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
  document.getElementById("comparison-badge")?.addEventListener("click", cycleComparison);
  document.getElementById("ghost-badge")?.addEventListener("click", cycleGhostComparison);
  document.getElementById("split-density-badge")?.addEventListener("click", cycleVisibleSplits);
  document.getElementById("split-angle-badge")?.addEventListener("click", cycleSplitAngle);
  loadCachedSplits();
  updateTrackDensityAndAngle();
  updateGhostBadge();
  connect();
};

// Global exports for layout.js and unit tests
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
window.setGhostComparison = setGhostComparison;
window.cycleGhostComparison = cycleGhostComparison;
window.getGhostComparisonInfo = getGhostComparisonInfo;
window.calculateGhostProgress = calculateGhostProgress;
window.setGhostOpacity = setGhostOpacity;
window.sanitizeComparisonTimes = sanitizeComparisonTimes;
