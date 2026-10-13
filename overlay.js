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
let timerDisplayMode = "both"; // 'gametime' | 'realtime' | 'both'
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
    badge.innerText = "Time: Both";
    badge.style.color = "#facc15";
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
      applyActiveComparison(currentComparison, false);
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

function setTimerDisplayMode(mode) {
  if (mode !== "gametime" && mode !== "realtime" && mode !== "both") {
    mode = "both";
  }
  timerDisplayMode = mode;
  localStorage.setItem("livesplit_timer_display_mode", mode);
  localStorage.setItem("livesplit_timing_method_manual", "true");

  if (mode === "gametime") {
    currentTimingMethod = "GameTime";
    localStorage.setItem("livesplit_timing_method", "GameTime");
  } else if (mode === "realtime") {
    currentTimingMethod = "RealTime";
    localStorage.setItem("livesplit_timing_method", "RealTime");
  }

  applyActiveTimingMethod(currentTimingMethod);
  updateTimerDisplayHierarchy();
  updateTimingMethodBadge();

  // Sync modal segmented control if open
  document.querySelectorAll("#ctrl-timer-display .seg-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-val") === mode);
  });

  if (ws && ws.readyState === WebSocket.OPEN) {
    if (mode === "gametime") ws.send("switchto gametime");
    else if (mode === "realtime") ws.send("switchto realtime");
  }
}

function toggleTimingMethod() {
  const sequence = ["gametime", "realtime", "both"];
  const curIdx = sequence.indexOf(timerDisplayMode);
  const nextIdx = (curIdx >= 0 ? curIdx + 1 : 0) % sequence.length;
  setTimerDisplayMode(sequence[nextIdx]);
}

function loadCachedSplits() {
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
      applyActiveComparison(currentComparison, false);
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

function updateTrackStatus(idx) {
  currentIndex = idx;
  const viewport = document.getElementById("track-viewport");
  const isVertical = document.getElementById("track")?.classList.contains("vertical");

  if (idx < 0) {
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

  const nodeStart = document.getElementById("node-start");
  if (nodeStart) {
    nodeStart.classList.toggle("active", idx >= 0);
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
          fill.style.width = isVertical ? "100%" : "0%";
          fill.style.height = isVertical ? "0%" : "100%";
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
        fill.style.width = isVertical ? "100%" : "0%";
        fill.style.height = isVertical ? "0%" : "100%";
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

  // 1. Progress Bar Fill (universal for horizontal and vertical)
  if (fill) {
    const isVertical = document.getElementById("track")?.classList.contains("vertical");
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
  const track = document.getElementById("track");
  const isAngled = track && track.classList.contains("angled-text");
  const nameEl = nodeEl.querySelector(".split-name");
  const deltaEl = nodeEl.querySelector(".split-delta");
  const nameW = nameEl ? nameEl.offsetWidth : 60;
  const deltaW = deltaEl ? deltaEl.offsetWidth : 50;

  if (isAngled) {
    if (!isNext) {
      return Math.max(45, (nameW * 0.76) + 12);
    } else {
      return Math.max(45, (deltaW / 2) + 15);
    }
  }

  const maxW = Math.max(nameW, deltaW, 50);
  return (maxW / 2) + 14;
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
      <div class="ghost-icon-wrap"><span class="ghost-icon">${ghostInfo.icon}</span></div>
      <div class="ghost-needle"></div>
    `;
    track.appendChild(marker);
  } else {
    if (!track.contains(marker)) {
      track.appendChild(marker);
    }
    marker.className = `ghost-marker ghost-theme-${ghostInfo.id}`;
    const iconSpan = marker.querySelector(".ghost-icon");
    if (iconSpan) iconSpan.innerText = ghostInfo.icon;
  }
  return marker;
}

function hideAllGhostMarkers() {
  const staticMarker = document.getElementById("ghost-marker");
  if (staticMarker) staticMarker.style.display = "none";
  const dynamicMarkers = document.querySelectorAll(".ghost-marker");
  dynamicMarkers.forEach(m => {
    m.style.display = "none";
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
  if (activeList.length === 0 || currentSec === null || currentSec <= 0 || splitsList.length === 0) {
    hideAllGhostMarkers();
    if (edgeLeft) edgeLeft.style.display = "none";
    if (edgeRight) edgeRight.style.display = "none";
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
  const clientSpan = isVertical ? viewport.clientHeight : viewport.clientWidth;
  const visibleMin = scrollOffset + 25;
  const visibleMax = scrollOffset + clientSpan - 25;

  const nodeStart = document.getElementById("node-start");
  if (!nodeStart) return;

  const leftOffscreenGhosts = [];
  const rightOffscreenGhosts = [];
  const renderedMarkerIds = new Set();

  activeList.forEach((gId) => {
    const ghostInfo = getGhostComparisonInfo(gId);
    if (!ghostInfo) return;

    const marker = getOrCreateGhostMarker(ghostInfo);
    if (!marker) return;
    renderedMarkerIds.add(marker.id);

    const { segIdx, ratio } = calculateGhostProgress(currentSec, ghostInfo.times);

    // Calculate physical track coordinates (Y in vertical mode, X in horizontal mode)
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
          prevNode = prevItem;
          nextNode = currentItem;
          startCoord = prevItem.offsetTop + (prevItem.offsetHeight / 2);
          endCoord = currentItem.offsetTop + (currentItem.offsetHeight / 2);
        } else {
          marker.style.display = "none";
          return;
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
          prevNode = prevItem;
          nextNode = currentItem;
          startCoord = prevItem.offsetLeft + (prevItem.offsetWidth / 2);
          endCoord = currentItem.offsetLeft + (currentItem.offsetWidth / 2);
        } else {
          marker.style.display = "none";
          return;
        }
      }
    }

    const ghostCoord = startCoord + ratio * (endCoord - startCoord);

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
      // Off-screen to the left (or top in vertical mode)
      marker.style.display = "none";
      leftOffscreenGhosts.push({ ghostInfo, deltaStr, isAhead });
    } else if (ghostCoord > visibleMax) {
      // Off-screen to the right (or bottom in vertical mode)
      marker.style.display = "none";
      rightOffscreenGhosts.push({ ghostInfo, deltaStr, isAhead });
    } else {
      // On-screen!
      marker.style.display = "flex";
      if (isVertical) {
        marker.style.transform = `translateY(${ghostCoord}px) translateY(-50%) translateX(-50%)`;
      } else {
        marker.style.transform = `translateX(${ghostCoord}px) translateX(-50%)`;

        // Dynamically shrink pin when hovering over split text, extend longer in open track
        const distPrev = Math.abs(ghostCoord - startCoord);
        const distNext = Math.abs(endCoord - ghostCoord);
        const prevThreshold = getNodeTextThreshold(prevNode, false);
        const nextThreshold = getNodeTextThreshold(nextNode, true);
        const isHoveringText = (distPrev < prevThreshold || distNext < nextThreshold);
        marker.classList.toggle("compact", isHoveringText);
      }
    }
  });

  // Hide static template marker and any marker not in active list
  const staticMarker = document.getElementById("ghost-marker");
  if (staticMarker) staticMarker.style.display = "none";
  document.querySelectorAll(".ghost-marker").forEach((m) => {
    if (!renderedMarkerIds.has(m.id)) {
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
      edgeLeft.innerHTML = `<span>${prevArrow}</span> <span id="ghost-edge-left-icon">${g.ghostInfo.icon}</span> <span id="ghost-edge-left-val" style="color:${g.isAhead ? "#22c55e" : "#ef4444"};">${g.deltaStr}</span>`;
    } else {
      let html = `<span style="opacity:0.7;">${prevArrow}</span> `;
      html += leftOffscreenGhosts.map(g => {
        const col = g.isAhead ? "#22c55e" : "#ef4444";
        return `<span>${g.ghostInfo.icon}</span> <span style="color:${col}; font-weight:700;">${g.deltaStr}</span>`;
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
      edgeRight.innerHTML = `<span id="ghost-edge-right-val" style="color:${g.isAhead ? "#22c55e" : "#ef4444"};">${g.deltaStr}</span> <span id="ghost-edge-right-icon">${g.ghostInfo.icon}</span> <span>${nextArrow}</span>`;
    } else {
      let html = rightOffscreenGhosts.map(g => {
        const col = g.isAhead ? "#22c55e" : "#ef4444";
        return `<span>${g.ghostInfo.icon}</span> <span style="color:${col}; font-weight:700;">${g.deltaStr}</span>`;
      }).join(" &nbsp;");
      html += ` <span style="opacity:0.7;">${nextArrow}</span>`;
      edgeRight.innerHTML = html;
    }
  } else if (edgeRight) {
    edgeRight.style.display = "none";
  }
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
    fill.style.height = "100%";
    fill.className = `segment-bar-fill ${stateClass}`;
  }

  item.classList.add(stateClass);
}

function detectTimingMethodFromComp(splitIdx, compSec) {
  if (splitIdx < 0 || compSec === null || compSec <= 0) return null;
  const gtSec = (comparisonTimesGT && splitIdx < comparisonTimesGT.length) ? comparisonTimesGT[splitIdx] : null;
  const rtSec = (comparisonTimesRT && splitIdx < comparisonTimesRT.length) ? comparisonTimesRT[splitIdx] : null;
  if (gtSec !== null && rtSec !== null && Math.abs(gtSec - rtSec) > 1.0) {
    const diffGT = Math.abs(compSec - gtSec);
    const diffRT = Math.abs(compSec - rtSec);
    const detected = (diffGT <= diffRT) ? "GameTime" : "RealTime";
    if (detected !== currentTimingMethod) {
      applyActiveTimingMethod(detected);
      localStorage.setItem("livesplit_timing_method", detected);
    }
    return detected;
  }
  return null;
}

let canQueryComparison = true;

function connect() {
  ws = new WebSocket(WS_URL);

  ws.onopen = async () => {
    const status = document.getElementById("connection-status");
    if (status) {
      status.innerText = "CONNECTED";
      status.style.color = "#4ade80";
      status.closest(".connection-status-pill")?.classList.add("connected");
    }

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

async function pollLoop() {
  while (ws && ws.readyState === WebSocket.OPEN) {
    // 0. Periodic Auto-Sync with LiveSplit hotkeys (every ~500ms)
    pollTick = (pollTick + 1) % 15;
    if (pollTick === 0) {
      const isSyncEnabled = (localStorage.getItem("livesplit_sync_hotkeys") !== "false");
      if (isSyncEnabled) {
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
            const isVert = document.getElementById("track")?.classList.contains("vertical");
            fill.style.width = isVert ? "100%" : "0%";
            fill.style.height = isVert ? "0%" : "100%";
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
              detectTimingMethodFromComp(0, compSec);
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
if (fileInput) {
  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => parseLSS(evt.target.result);
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
    reader.onload = (evt) => parseLSS(evt.target.result);
    reader.readAsText(file);
  }
});

function updateTrackDensityAndAngle() {
  const viewport = document.getElementById("track-viewport");
  const track = document.getElementById("track");
  if (!viewport || !track) return;

  const isVertical = track.classList.contains("vertical");
  const viewportWidth = viewport.clientWidth || window.innerWidth || 1920;
  const viewportHeight = viewport.clientHeight || window.innerHeight || 800;
  const splitPref = localStorage.getItem("livesplit_visible_splits") || "auto";
  const anglePref = localStorage.getItem("livesplit_split_angle") || "auto";

  let spacing = isVertical ? 64 : 220;

  if (isVertical) {
    if (splitPref === "all") {
      const totalCount = Math.max(1, splitsList.length + 1);
      spacing = Math.max(38, Math.floor((viewportHeight - 40) / totalCount));
    } else if (splitPref !== "auto") {
      const num = parseInt(splitPref, 10);
      if (!isNaN(num) && num > 0) {
        spacing = Math.max(38, Math.floor(viewportHeight / num));
      }
    } else {
      spacing = 64;
    }
  } else {
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

function resetSettingsMenuPosition() {
  const panel = document.getElementById("footer-bar");
  if (!panel) return;
  panel.style.left = "";
  panel.style.top = "";
  panel.style.right = "";
  panel.style.bottom = "";
  panel.classList.remove("is-custom-pos");
  localStorage.removeItem("livesplit_settings_pos");
}

function restoreSettingsMenuPosition() {
  const panel = document.getElementById("footer-bar");
  const quickWrap = document.getElementById("quick-settings-wrap");
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
        quickWrap?.classList.add("pinned");
      }
    } catch (e) {
      console.warn("Failed to parse saved settings position", e);
    }
  }
}

function initSettingsMenuDraggable() {
  const panel = document.getElementById("footer-bar");
  const header = document.querySelector(".settings-menu-header");
  const quickWrap = document.getElementById("quick-settings-wrap");
  const resetBtn = document.getElementById("btn-reset-settings-pos");
  if (!panel || !header) return;

  if (resetBtn) {
    resetBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      resetSettingsMenuPosition();
    });
  }

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
    quickWrap?.classList.add("pinned");

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

window.onload = () => {
  document.getElementById("gold-toggle-badge")?.addEventListener("click", toggleGoldSegments);
  document.getElementById("timing-method-badge")?.addEventListener("click", toggleTimingMethod);
  document.getElementById("comparison-badge")?.addEventListener("click", cycleComparison);
  document.getElementById("ghost-badge")?.addEventListener("click", cycleGhostComparison);
  document.getElementById("split-density-badge")?.addEventListener("click", cycleVisibleSplits);
  document.getElementById("split-angle-badge")?.addEventListener("click", cycleSplitAngle);

  // Quick settings panel pin and trigger toggle
  const quickWrap = document.getElementById("quick-settings-wrap");
  document.getElementById("btn-pin-settings")?.addEventListener("click", () => {
    quickWrap?.classList.toggle("pinned");
  });
  document.getElementById("settings-trigger-pill")?.addEventListener("click", () => {
    quickWrap?.classList.toggle("pinned");
  });

  initSettingsMenuDraggable();
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
window.getActiveGhostComparisons = () => [...activeGhostComparisons];
window.setGhostComparison = setGhostComparison;
window.toggleGhostComparison = toggleGhostComparison;
window.cycleGhostComparison = cycleGhostComparison;
window.getGhostComparisonInfo = getGhostComparisonInfo;
window.calculateGhostProgress = calculateGhostProgress;
window.getNodeTextThreshold = getNodeTextThreshold;
window.setGhostOpacity = setGhostOpacity;
window.sanitizeComparisonTimes = sanitizeComparisonTimes;
window.detectTimingMethodFromComp = detectTimingMethodFromComp;
window.applyActiveTimingMethod = applyActiveTimingMethod;
window.getCurrentTimingMethod = () => currentTimingMethod;
window.setTimerDisplayMode = setTimerDisplayMode;
window.getTimerDisplayMode = () => timerDisplayMode;
window.toggleTimingMethod = toggleTimingMethod;
window.resetSettingsMenuPosition = resetSettingsMenuPosition;
