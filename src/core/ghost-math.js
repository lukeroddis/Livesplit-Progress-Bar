/**
 * src/core/ghost-math.js - Multi-Ghost Runner Mathematics & Interpolation
 * 
 * Computes ghost runner positions along the track curve, multi-ghost selection logic,
 * distance thresholds, and off-screen edge beacons.
 */

(function () {
  "use strict";

  /**
   * Calculates the ghost runner's current split segment, progress ratio, and completion status.
   * @param {number} currentSec - Elapsed run time in seconds
   * @param {Array<number|null>} times - Cumulative comparison timestamps
   * @returns {Object} { segIdx, ratio, isFinished, targetSec }
   */
  function calculateGhostProgress(currentSec, times) {
    if (!times || !Array.isArray(times) || times.length === 0 || currentSec === null || currentSec <= 0) {
      return { segIdx: 0, ratio: 0, isFinished: false, targetSec: 0 };
    }

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

      // Search backwards for previous positive target time
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

  /**
   * Resolves ghost comparison metadata (icon, color, timestamps) with timescale mismatch defense.
   */
  function getGhostComparisonInfo(targetGhost, timingMethod, compDataGT, compDataRT, compTimesGT, compTimesRT) {
    if (!targetGhost || targetGhost === "off") return null;

    const isRT = (timingMethod === "RealTime");
    const compData = isRT ? compDataRT : compDataGT;
    const altData = isRT ? compDataGT : compDataRT;
    const compKeys = Object.keys(compData || {});
    const altKeys = Object.keys(altData || {});
    const fallbackTimes = isRT ? compTimesRT : compTimesGT;
    const sanitizeUtil = window.LiveSplit?.SplitEngine?.sanitizeComparisonTimes || window.sanitizeComparisonTimes;

    const lowGhost = targetGhost.toLowerCase().trim();

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
            return { id: "wr", name: altWrKey, icon: "🏆", color: "#facc15", times: sanitizeUtil(altTimes, fallbackTimes) };
          }
        }
        return { id: "wr", name: wrKey, icon: "🏆", color: "#facc15", times: sanitizeUtil(candTimes, fallbackTimes) };
      }

      if (altTimes) {
        return { id: "wr", name: altWrKey, icon: "🏆", color: "#facc15", times: sanitizeUtil(altTimes, fallbackTimes) };
      }

      if (compData["Best Segments"] && compData["Best Segments"].some(t => t !== null && t > 0)) {
        return { id: "wr", name: "Best Segments (WR Fallback)", icon: "🏆", color: "#facc15", times: sanitizeUtil(compData["Best Segments"], fallbackTimes) };
      }
      return { id: "wr", name: "Personal Best", icon: "🏆", color: "#facc15", times: sanitizeUtil(compData["Personal Best"] || fallbackTimes, fallbackTimes) };
    }

    // 2. Personal Best (pb)
    if (lowGhost === "pb" || lowGhost === "personal best") {
      return { id: "pb", name: "Personal Best", icon: "🥈", color: "#38bdf8", times: sanitizeUtil(compData["Personal Best"] || fallbackTimes, fallbackTimes) };
    }

    // 3. Best Segments (best)
    if (lowGhost === "best" || lowGhost === "best segments") {
      return { id: "best", name: "Best Segments", icon: "⭐", color: "#eab308", times: sanitizeUtil(compData["Best Segments"] || fallbackTimes, fallbackTimes) };
    }

    // 4. Average Segments (average)
    if (lowGhost === "average" || lowGhost === "average segments") {
      return { id: "average", name: "Average Segments", icon: "📊", color: "#a78bfa", times: sanitizeUtil(compData["Average Segments"] || fallbackTimes, fallbackTimes) };
    }

    // 5. Worst Segments (worst)
    if (lowGhost === "worst" || lowGhost === "worst segments") {
      return { id: "worst", name: "Worst Segments", icon: "🐢", color: "#f87171", times: sanitizeUtil(compData["Worst Segments"] || fallbackTimes, fallbackTimes) };
    }

    // 6. Custom comparison by name
    if (compData[targetGhost] && compData[targetGhost].some(t => t !== null && t > 0)) {
      const cand = compData[targetGhost];
      const alt = altData[targetGhost];
      if (alt && alt.some(t => t !== null && t > 0) && fallbackTimes && fallbackTimes.length > 0 && fallbackTimes[0] > 0) {
        const curRatio = Math.abs(cand[0] - fallbackTimes[0]) / fallbackTimes[0];
        const altRatio = Math.abs(alt[0] - fallbackTimes[0]) / fallbackTimes[0];
        if (curRatio > 1.5 && altRatio < 0.5) {
          return { id: targetGhost, name: targetGhost, icon: "👤", color: "#06b6d4", times: sanitizeUtil(alt, fallbackTimes) };
        }
      }
      return { id: targetGhost, name: targetGhost, icon: "👤", color: "#06b6d4", times: sanitizeUtil(cand, fallbackTimes) };
    }
    if (altData[targetGhost] && altData[targetGhost].some(t => t !== null && t > 0)) {
      return { id: targetGhost, name: targetGhost, icon: "👤", color: "#06b6d4", times: sanitizeUtil(altData[targetGhost], fallbackTimes) };
    }

    return null;
  }

  // Export to namespace and window
  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.GhostMath = {
    calculateGhostProgress,
    getGhostComparisonInfo
  };

  // Backward compatibility exports
  window.calculateGhostProgress = calculateGhostProgress;
})();
