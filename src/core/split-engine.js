/**
 * src/core/split-engine.js - Splits Parsing, Comparisons & Curves Engine
 * 
 * Handles .lss XML parsing, statistical comparison curve generation (Best, Average, Worst),
 * normalization of comparison names, and timing method detection.
 */

(function () {
  "use strict";

  // Built-in LiveSplit comparisons, in display order (overlay state and controllers copy this list)
  const DEFAULT_COMPARISONS = Object.freeze(["Personal Best", "Best Segments", "Average Segments", "Worst Segments"]);

  /**
   * Returns a compact badge label for common comparison types.
   * @param {string} name - Full comparison name
   * @returns {string} Compact label
   */
  function getShortComparisonName(name) {
    if (name === "Personal Best") return "PB";
    if (name === "Best Segments") return "Best Segs";
    if (name === "Average Segments") return "Average";
    if (name === "Worst Segments") return "Worst";
    return name && name.length > 10 ? name.slice(0, 9) + "…" : (name || "");
  }

  /**
   * Normalizes comparison names received from LiveSplit Server or user inputs to canonical casing.
   * @param {string} raw - Raw comparison string
   * @param {Array<string>} [knownList] - Optional list of custom comparisons
   * @returns {string|null} Canonical name
   */
  function normalizeComparisonName(raw, knownList = []) {
    if (!raw || raw === "-" || raw.trim() === "") return null;
    const str = raw.trim();
    const lower = str.toLowerCase();
    if (lower === "personal best" || lower === "pb") return "Personal Best";
    if (lower === "best segments" || lower === "best splits" || lower === "sum of best") return "Best Segments";
    if (lower === "average segments" || lower === "average") return "Average Segments";
    if (lower === "worst segments" || lower === "worst") return "Worst Segments";

    const searchList = (knownList && knownList.length > 0) ? knownList : DEFAULT_COMPARISONS;
    for (const c of searchList) {
      if (c && c.toLowerCase() === lower) return c;
    }
    return str;
  }

  /**
   * Sanitizes comparison arrays by forward-filling valid values and bridging missing holes from fallbacks.
   * @param {Array<number|null>} times - Comparison timestamps
   * @param {Array<number|null>} [fallbackTimes] - Fallback timestamps (e.g. PB)
   * @param {number} [targetLen] - Target array length
   * @returns {Array<number|null>} Sanitized timestamps
   */
  function sanitizeComparisonTimes(times, fallbackTimes = null, targetLen = null) {
    if (!times || !Array.isArray(times) || times.length === 0) {
      return fallbackTimes && Array.isArray(fallbackTimes) ? [...fallbackTimes] : [];
    }
    // Default length pads to the fallback curve so every split keeps a target.
    const len = targetLen !== null
      ? targetLen
      : (fallbackTimes && fallbackTimes.length > times.length ? fallbackTimes.length : times.length);
    const result = new Array(len);
    let lastVal = 0;

    for (let i = 0; i < len; i++) {
      const raw = i < times.length ? times[i] : null;
      if (raw !== null && raw !== undefined && !isNaN(raw) && raw > 0) {
        lastVal = raw;
        result[i] = raw;
      } else if (fallbackTimes && i < fallbackTimes.length && fallbackTimes[i] !== null && fallbackTimes[i] !== undefined && !isNaN(fallbackTimes[i]) && fallbackTimes[i] > 0) {
        const fb = fallbackTimes[i];
        lastVal = Math.max(lastVal, fb);
        result[i] = lastVal;
      } else {
        result[i] = lastVal > 0 ? lastVal : null;
      }
    }
    return result;
  }

  /**
   * Computes statistical comparison curves: Best Segments, Average Segments, and Worst Segments.
   * Enforces mathematical ordering: Best Segments <= Average Segments <= Worst Segments.
   */
  function computeHistoricalCurves(count, bestSegGT, bestSegRT, histGT, histRT, pbGT, pbRT) {
    const curves = {
      bestGT: [],
      bestRT: [],
      avgGT: [],
      avgRT: [],
      worstGT: [],
      worstRT: []
    };

    let cumBestGT = 0;
    let cumBestRT = 0;
    curves.bestGT = bestSegGT.map(s => {
      if (s !== null && s > 0) cumBestGT += s;
      return cumBestGT > 0 ? cumBestGT : null;
    });
    curves.bestRT = bestSegRT.map(s => {
      if (s !== null && s > 0) cumBestRT += s;
      return cumBestRT > 0 ? cumBestRT : null;
    });

    let cumAvgGT = 0;
    let cumAvgRT = 0;
    let cumWorstGT = 0;
    let cumWorstRT = 0;

    for (let i = 0; i < count; i++) {
      // Game Time Average & Worst
      const hgt = histGT[i] || [];
      let pbDurGT = (pbGT[i] != null && (i === 0 ? pbGT[i] : (pbGT[i] - (pbGT[i - 1] || 0)))) || null;
      if (pbDurGT !== null && pbDurGT <= 0) pbDurGT = bestSegGT[i];
      const avgGT = hgt.length > 0 ? (hgt.reduce((a, b) => a + b, 0) / hgt.length) : (pbDurGT ?? bestSegGT[i]);
      if (avgGT != null && avgGT > 0) cumAvgGT += avgGT;
      curves.avgGT.push(cumAvgGT > 0 ? cumAvgGT : null);

      const worstGT = hgt.length > 0 ? Math.max(...hgt) : (pbDurGT ?? bestSegGT[i]);
      if (worstGT != null && worstGT > 0) cumWorstGT += worstGT;
      curves.worstGT.push(cumWorstGT > 0 ? cumWorstGT : null);

      // Real Time Average & Worst
      const hrt = histRT[i] || [];
      let pbDurRT = (pbRT[i] != null && (i === 0 ? pbRT[i] : (pbRT[i] - (pbRT[i - 1] || 0)))) || null;
      if (pbDurRT !== null && pbDurRT <= 0) pbDurRT = bestSegRT[i];
      const avgRT = hrt.length > 0 ? (hrt.reduce((a, b) => a + b, 0) / hrt.length) : (pbDurRT ?? bestSegRT[i]);
      if (avgRT != null && avgRT > 0) cumAvgRT += avgRT;
      curves.avgRT.push(cumAvgRT > 0 ? cumAvgRT : null);

      const worstRT = hrt.length > 0 ? Math.max(...hrt) : (pbDurRT ?? bestSegRT[i]);
      if (worstRT != null && worstRT > 0) cumWorstRT += worstRT;
      curves.worstRT.push(cumWorstRT > 0 ? cumWorstRT : null);
    }

    return curves;
  }

  /**
   * Parses .lss XML string into full splits, curves, and custom comparisons data.
   * @param {string} xmlText - Raw XML string
   * @returns {Object|null} Parsed speedrun splits dataset
   */
  function parseLssXml(xmlText) {
    if (!xmlText) return null;
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlText, "text/xml");

    const game = xml.querySelector("GameName")?.textContent?.trim() || "";
    const category = xml.querySelector("CategoryName")?.textContent?.trim() || "";
    const segments = Array.from(xml.querySelectorAll("Segment"));
    if (segments.length === 0) return null;

    const timeUtil = window.LiveSplit.Time.timeStringToSeconds;

    const splitsList = [];
    const comparisonTimesGT = [];
    const comparisonTimesRT = [];
    const bestSegmentTimesGT = [];
    const bestSegmentTimesRT = [];
    const segmentHistoriesGT = [];
    const segmentHistoriesRT = [];
    const comparisonsList = [...DEFAULT_COMPARISONS];

    // Collect custom comparisons from header
    const declaredComps = Array.from(xml.querySelectorAll("Comparisons > Comparison"));
    declaredComps.forEach(c => {
      const cName = c.textContent.trim();
      if (cName && !comparisonsList.includes(cName)) {
        comparisonsList.push(cName);
      }
    });

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

      let bestSecGT = timeUtil(bestGT);
      let bestSecRT = timeUtil(bestRT);

      const segHistGT = [];
      const segHistRT = [];
      const historyTimes = Array.from(seg.querySelectorAll("SegmentHistory > Time"));
      historyTimes.forEach(tNode => {
        const hgt = timeUtil(tNode.querySelector("GameTime")?.textContent);
        const hrt = timeUtil(tNode.querySelector("RealTime")?.textContent);
        if (hgt !== null && hgt > 0) {
          segHistGT.push(hgt);
          if (bestSecGT === null || hgt < bestSecGT) bestSecGT = hgt;
        }
        if (hrt !== null && hrt > 0) {
          segHistRT.push(hrt);
          if (bestSecRT === null || hrt < bestSecRT) bestSecRT = hrt;
        }
      });

      const splitTimeNodes = Array.from(seg.querySelectorAll("SplitTimes > SplitTime"));
      splitTimeNodes.forEach(st => {
        const stName = st.getAttribute("name");
        if (stName && stName !== "Personal Best") {
          if (!customSplitTimesGT[stName]) customSplitTimesGT[stName] = [];
          if (!customSplitTimesRT[stName]) customSplitTimesRT[stName] = [];
          const sgt = timeUtil(st.querySelector("GameTime")?.textContent);
          const srt = timeUtil(st.querySelector("RealTime")?.textContent);
          customSplitTimesGT[stName][segIdx] = sgt;
          customSplitTimesRT[stName][segIdx] = srt;
          if (!comparisonsList.includes(stName)) comparisonsList.push(stName);
        }
      });

      splitsList.push(name);
      comparisonTimesGT.push(timeUtil(pbGT));
      comparisonTimesRT.push(timeUtil(pbRT));
      bestSegmentTimesGT.push(bestSecGT);
      bestSegmentTimesRT.push(bestSecRT);
      segmentHistoriesGT.push(segHistGT);
      segmentHistoriesRT.push(segHistRT);
    });

    // Compute Curves
    const curves = computeHistoricalCurves(
      segments.length,
      bestSegmentTimesGT,
      bestSegmentTimesRT,
      segmentHistoriesGT,
      segmentHistoriesRT,
      comparisonTimesGT,
      comparisonTimesRT
    );

    const comparisonsDataGT = {
      "Personal Best": [...comparisonTimesGT],
      "Best Segments": curves.bestGT,
      "Average Segments": curves.avgGT,
      "Worst Segments": curves.worstGT
    };

    const comparisonsDataRT = {
      "Personal Best": [...comparisonTimesRT],
      "Best Segments": curves.bestRT,
      "Average Segments": curves.avgRT,
      "Worst Segments": curves.worstRT
    };

    // Sanitize custom comparisons
    const allCustomKeys = new Set([...Object.keys(customSplitTimesGT), ...Object.keys(customSplitTimesRT)]);
    allCustomKeys.forEach(cName => {
      const rawGT = customSplitTimesGT[cName] || [];
      const rawRT = customSplitTimesRT[cName] || [];
      const hasGT = rawGT.some(t => t !== null && t > 0);
      const hasRT = rawRT.some(t => t !== null && t > 0);

      const sanGT = sanitizeComparisonTimes(hasGT ? rawGT : (hasRT ? rawRT : []), comparisonTimesGT, segments.length);
      const sanRT = sanitizeComparisonTimes(hasRT ? rawRT : (hasGT ? rawGT : []), comparisonTimesRT, segments.length);

      comparisonsDataGT[cName] = sanGT;
      comparisonsDataRT[cName] = sanRT;
      if (!comparisonsList.includes(cName)) comparisonsList.push(cName);
    });

    const timingMethod = detectTimingMethodFromSplits(comparisonTimesGT, comparisonTimesRT, bestSegmentTimesGT, bestSegmentTimesRT);

    return {
      game,
      category,
      splitsList,
      comparisonTimesGT,
      comparisonTimesRT,
      bestSegmentTimesGT,
      bestSegmentTimesRT,
      comparisonsDataGT,
      comparisonsDataRT,
      comparisonsList,
      timingMethod,
      rawXml: xmlText
    };
  }

  /**
   * Picks the timing method a splits file was run with: the method its Personal Best was
   * recorded in (GameTime when the PB has both), else whichever its best segments have.
   * Best segments alone can mislead: old load-removed attempts leave GameTime golds on a
   * RealTime PB. Arrays hold seconds or null.
   * @returns {"GameTime"|"RealTime"}
   */
  function detectTimingMethodFromSplits(pbGT, pbRT, bestGT, bestRT) {
    const hasTimes = (arr) => Array.isArray(arr) && arr.some(t => t !== null && t > 0);
    if (hasTimes(pbGT)) return "GameTime";
    if (hasTimes(pbRT)) return "RealTime";
    return hasTimes(bestGT) ? "GameTime" : "RealTime";
  }

  /**
   * Infers whether the current comparison targets reflect GameTime or RealTime.
   */
  function detectTimingMethodFromComp(splitIdx, compSec, comparisonTimesGT, comparisonTimesRT) {
    if (splitIdx < 0 || compSec === null || compSec <= 0) return null;
    const gtSec = (comparisonTimesGT && splitIdx < comparisonTimesGT.length) ? comparisonTimesGT[splitIdx] : null;
    const rtSec = (comparisonTimesRT && splitIdx < comparisonTimesRT.length) ? comparisonTimesRT[splitIdx] : null;
    if (gtSec !== null && rtSec !== null && Math.abs(gtSec - rtSec) > 1.0) {
      const diffGT = Math.abs(compSec - gtSec);
      const diffRT = Math.abs(compSec - rtSec);
      return (diffGT <= diffRT) ? "GameTime" : "RealTime";
    }
    return null;
  }

  // Export to namespace and window
  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.SplitEngine = {
    DEFAULT_COMPARISONS,
    getShortComparisonName,
    normalizeComparisonName,
    sanitizeComparisonTimes,
    computeHistoricalCurves,
    parseLssXml,
    detectTimingMethodFromSplits,
    detectTimingMethodFromComp
  };

  // Backward compatibility exports
  window.normalizeComparisonName = normalizeComparisonName;
  window.sanitizeComparisonTimes = sanitizeComparisonTimes;
  window.computeHistoricalCurves = computeHistoricalCurves;
  window.parseLssXml = parseLssXml;
})();
