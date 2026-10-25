/**
 * LiveSplit Progress Bar - Race WebSocket Diagnostics & Telemetry Logger
 *
 * Encapsulates:
 * - Circular ring buffer for WebSocket telemetry packets & system events (capped at 150 entries)
 * - Formatted colored console output with browser CSS styling guards
 * - Event dispatching for live UI telemetry inspector modals
 * - JSON serialization for debugging exports
 */
(function () {
  "use strict";

  const MAX_WS_DEBUG_LOGS = 150;

  function createRaceLogger(options = {}) {
    const maxLogs = typeof options.maxLogs === "number" ? Math.max(1, options.maxLogs) : MAX_WS_DEBUG_LOGS;
    const notifyListeners = typeof options.notifyListeners === "function" ? options.notifyListeners : () => {};
    const enableConsole = options.enableConsole !== false;

    const wsDebugLogs = [];
    let wsLogCounter = 0;

    function recordLog(direction, type, data, raw) {
      const entry = {
        id: ++wsLogCounter,
        time: new Date().toLocaleTimeString(),
        timestamp: Date.now(),
        direction: direction || "in",
        type: type || "message",
        user: (data && (data.user || data.username || (data.data && (data.data.user || data.data.username)))) || "",
        data: data,
        raw: raw || (typeof data === "string" ? data : JSON.stringify(data))
      };

      wsDebugLogs.unshift(entry);
      if (wsDebugLogs.length > maxLogs) {
        wsDebugLogs.pop();
      }

      if (enableConsole && typeof console !== "undefined" && typeof console.log === "function") {
        try {
          console.log(
            `%c[TheRun WS ${entry.direction.toUpperCase()}] %c${entry.time} %c[${entry.type}]`,
            entry.direction === "in" ? "color: #38bdf8; font-weight: bold;" : "color: #4ade80; font-weight: bold;",
            "color: #94a3b8;",
            "color: #c084fc; font-weight: 600;",
            data
          );
        } catch (_) {}
      }

      notifyListeners("ws_log", entry);
      return entry;
    }

    function getLogs() {
      return wsDebugLogs.slice();
    }

    function clearLogs() {
      wsDebugLogs.length = 0;
      notifyListeners("ws_logs_cleared", null);
    }

    function getLogCount() {
      return wsDebugLogs.length;
    }

    function exportJson(pretty = true) {
      return JSON.stringify(wsDebugLogs, null, pretty ? 2 : 0);
    }

    return {
      recordLog,
      recordWsLog: recordLog,
      getLogs,
      getWebSocketLogs: getLogs,
      clearLogs,
      clearWebSocketLogs: clearLogs,
      getLogCount,
      exportJson,
      MAX_WS_DEBUG_LOGS: maxLogs
    };
  }

  // Export to namespace
  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.RaceLogger = {
    MAX_WS_DEBUG_LOGS,
    createRaceLogger
  };
})();
