/**
 * src/core/time-utils.js - Time Parsing & Formatting Engine
 * 
 * Provides parsing for LiveSplit time formats (days, hours, minutes, seconds, milliseconds)
 * and formats times for live timer HUD displays, split targets, and deltas.
 */

(function () {
  "use strict";

  /**
   * Converts a time string (e.g. "1.02:03:04.56", "01:23.45", "45.2", or "-") into total seconds.
   * @param {string} tStr - LiveSplit formatted time string
   * @returns {number|null} Seconds as float, or null if empty/invalid/dash
   */
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

  /**
   * Formats a raw time string or number into standard LiveSplit timer display (e.g. "1:23.45", "12.34").
   * @param {number|string} rawTime - Seconds number or string
   * @returns {string} Formatted timer string
   */
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

  /**
   * Formats split target seconds into milestone string (e.g. "1:23", "45", "1:02:03").
   * @param {number} sec - Seconds
   * @returns {string} Formatted target
   */
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

  /**
   * Formats a delta in signed seconds into "+1.2", "-0.5", "±0.0", "+1:23", "+1:10:00".
   * @param {number} signedSec - Delta in seconds (negative is ahead, positive is behind)
   * @returns {string} Formatted delta string
   */
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

  /**
   * Parses live delta string from LiveSplit into structured object.
   * @param {string} raw - Raw delta string
   * @returns {Object|null} { text, isAhead, signedSeconds }
   */
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

  /**
   * Formats a duration in seconds into a gap or interval string ("27.4s", "1:05", "1:10:00").
   * @param {number} sec - Seconds
   * @returns {string} Formatted gap string
   */
  function formatGapTime(sec) {
    if (sec === null || sec === undefined || isNaN(sec)) return "--";
    const clamped = Math.max(0, sec);
    const totalSec = Math.floor(clamped);
    if (totalSec < 60) {
      const subMin = Math.min(59.9, Math.round(clamped * 10) / 10);
      return `${subMin.toFixed(1)}s`;
    }
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

  // Export to namespace and window
  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.Time = {
    timeStringToSeconds,
    formatTimerDisplay,
    formatTargetTime,
    formatDeltaSeconds,
    formatDeltaLive,
    formatGapTime
  };

  // Backward compatibility exports
  window.timeStringToSeconds = timeStringToSeconds;
  window.formatTimerDisplay = formatTimerDisplay;
  window.formatTargetTime = formatTargetTime;
  window.formatDeltaSeconds = formatDeltaSeconds;
  window.formatDeltaLive = formatDeltaLive;
  window.formatGapTime = formatGapTime;
})();
