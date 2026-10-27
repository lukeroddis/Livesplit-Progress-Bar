/**
 * Speedrun Overlay - Race Logger & WebSocket Diagnostics Spec
 */
(function () {
  "use strict";

  describe("LiveSplit.RaceLogger", () => {
    it("exports RaceLogger namespace and createRaceLogger factory", () => {
      assert(window.LiveSplit.RaceLogger !== null, "LiveSplit.RaceLogger exists");
      assertEqual(typeof window.LiveSplit.RaceLogger.createRaceLogger, "function", "createRaceLogger is a function");
      assertEqual(window.LiveSplit.RaceLogger.MAX_WS_DEBUG_LOGS, 150, "MAX_WS_DEBUG_LOGS is 150");
    });

    it("initializes with an empty buffer and zero count", () => {
      const logger = window.LiveSplit.RaceLogger.createRaceLogger({ enableConsole: false });
      assertEqual(logger.getLogCount(), 0, "Log count is initially 0");
      assertEqual(logger.getLogs().length, 0, "Logs array is initially empty");
      assertEqual(logger.exportJson(), "[]", "exportJson returns empty array JSON");
    });

    it("records log entries with standard metadata, timestamps, and usernames", () => {
      const events = [];
      const logger = window.LiveSplit.RaceLogger.createRaceLogger({
        enableConsole: false,
        notifyListeners: (type, payload) => events.push({ type, payload })
      });

      const entry = logger.recordLog("in", "participant_split", { user: "Speedy", split: "Zone 1" });
      assertEqual(entry.id, 1, "First entry gets id 1");
      assertEqual(entry.direction, "in", "Direction is preserved");
      assertEqual(entry.type, "participant_split", "Type is preserved");
      assertEqual(entry.user, "Speedy", "User is extracted from data");
      assertEqual(typeof entry.timestamp, "number", "Timestamp is numeric");
      assertEqual(typeof entry.time, "string", "Time is formatted string");

      assertEqual(events.length, 1, "notifyListeners was called with ws_log event");
      assertEqual(events[0].type, "ws_log", "Event type is ws_log");
      assertEqual(events[0].payload.id, 1, "Event payload contains entry");
    });

    it("enforces circular ring buffer limit and unshifts newest entries to the top", () => {
      const logger = window.LiveSplit.RaceLogger.createRaceLogger({
        maxLogs: 3,
        enableConsole: false
      });

      logger.recordLog("in", "msg_1", { n: 1 });
      logger.recordLog("in", "msg_2", { n: 2 });
      logger.recordLog("in", "msg_3", { n: 3 });
      logger.recordLog("in", "msg_4", { n: 4 });

      const logs = logger.getLogs();
      assertEqual(logs.length, 3, "Buffer capped at maxLogs 3");
      assertEqual(logs[0].type, "msg_4", "Newest entry msg_4 is at index 0");
      assertEqual(logs[1].type, "msg_3", "Second newest entry msg_3 is at index 1");
      assertEqual(logs[2].type, "msg_2", "Third newest entry msg_2 is at index 2");
    });

    it("clears logs and notifies listeners with ws_logs_cleared", () => {
      const events = [];
      const logger = window.LiveSplit.RaceLogger.createRaceLogger({
        enableConsole: false,
        notifyListeners: (type, payload) => events.push({ type, payload })
      });

      logger.recordLog("sys", "ws_connected", { raceId: "test-race" });
      assertEqual(logger.getLogCount(), 1, "Log count is 1 before clear");

      logger.clearLogs();
      assertEqual(logger.getLogCount(), 0, "Log count is 0 after clear");
      assertEqual(logger.getLogs().length, 0, "Logs array is empty after clear");

      const clearEvent = events.find(e => e.type === "ws_logs_cleared");
      assert(clearEvent !== undefined, "ws_logs_cleared event was dispatched");
    });

    it("protects internal ring buffer with defensive copies and exports JSON", () => {
      const logger = window.LiveSplit.RaceLogger.createRaceLogger({ enableConsole: false });
      logger.recordLog("out", "ping", {});

      const logsCopy = logger.getLogs();
      logsCopy.pop();
      assertEqual(logger.getLogCount(), 1, "Mutating getLogs() return array does not affect internal ring buffer");

      const jsonStr = logger.exportJson();
      const parsed = JSON.parse(jsonStr);
      assertEqual(Array.isArray(parsed), true, "exportJson returns valid JSON array");
      assertEqual(parsed.length, 1, "exportJson contains logged entry");
    });
  });
})();
