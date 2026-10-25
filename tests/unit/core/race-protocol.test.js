/**
 * tests/unit/core/race-protocol.test.js
 * Unit tests for LiveSplit.RaceProtocol message and telemetry parser
 */

(function () {
  "use strict";

  describe("Race Telemetry Protocol: LiveSplit.RaceProtocol", () => {
    function createMockContext() {
      const entrants = new Map();
      const events = [];
      const notifications = [];
      let raceStatus = "open";
      let countdownTargetMs = null;
      let countdownSeconds = null;

      return {
        entrants,
        hostState: { userId: "you", username: "You" },
        hostUsername: "You",
        activeSplitsList: ["Stage 1", "Stage 2", "Stage 3", "Final"],
        isLiveRoom: true,
        getRaceStatus: () => raceStatus,
        setRaceStatus: (s) => { raceStatus = s; },
        getCountdownTargetMs: () => countdownTargetMs,
        setCountdownTargetMs: (ms) => { countdownTargetMs = ms; },
        getCountdownSeconds: () => countdownSeconds,
        setCountdownSeconds: (s) => { countdownSeconds = s; },
        lastKnownRanks: new Map(),
        checkpointRankHistory: new Map(),
        pushRaceEvent: (evt) => events.push(evt),
        notifyListeners: (type, payload) => notifications.push({ type, payload }),
        events,
        notifications
      };
    }

    it("exports complete public API on window.LiveSplit.RaceProtocol", () => {
      const rp = window.LiveSplit && window.LiveSplit.RaceProtocol;
      assert(rp !== undefined && rp !== null, "RaceProtocol is exposed on window.LiveSplit");
      assert(Array.isArray(rp.DEFAULT_RACER_PALETTE), "DEFAULT_RACER_PALETTE is an array");
      assertEqual(typeof rp.updateEntrantFromTelemetry, "function", "updateEntrantFromTelemetry is a function");
      assertEqual(typeof rp.parseRaceMessage, "function", "parseRaceMessage is a function");
    });

    it("parseRaceMessage ignores pure chat messages on race websocket", () => {
      const rp = window.LiveSplit.RaceProtocol;
      const ctx = createMockContext();

      rp.parseRaceMessage({ type: "chat", message: "gl hf!" }, ctx);
      assertEqual(ctx.entrants.size, 0, "No entrants created from chat");
      assertEqual(ctx.events.length, 0, "No events created from chat");

      rp.parseRaceMessage({ type: "message", message: "just chatting" }, ctx);
      assertEqual(ctx.entrants.size, 0);
    });

    it("parseRaceMessage unwraps nested envelopes and updates race status and countdowns", () => {
      const rp = window.LiveSplit.RaceProtocol;
      const ctx = createMockContext();

      // Nested envelope with countdown
      const msg = {
        result: {
          data: {
            raceStatus: "starting",
            countdown: 5
          }
        }
      };

      rp.parseRaceMessage(msg, ctx);
      assertEqual(ctx.getRaceStatus(), "starting");
      assertEqual(ctx.getCountdownSeconds(), 5);
      assert(ctx.events.some(e => e.type === "countdown"), "Pushes countdown event");

      // Race start message
      rp.parseRaceMessage({ type: "race-started" }, ctx);
      assertEqual(ctx.getRaceStatus(), "in_progress");
      assertEqual(ctx.getCountdownSeconds(), 0);
      assert(ctx.events.some(e => e.type === "started"), "Pushes started event");
    });

    it("updateEntrantFromTelemetry parses newcomer entrant with palette colors", () => {
      const rp = window.LiveSplit.RaceProtocol;
      const ctx = createMockContext();

      rp.updateEntrantFromTelemetry({
        userId: "competitor_1",
        username: "Speedy",
        status: "joined"
      }, ctx);

      assert(ctx.entrants.has("competitor_1"), "Entrant registered in Map");
      const entrant = ctx.entrants.get("competitor_1");
      assertEqual(entrant.username, "Speedy");
      assertEqual(entrant.isHost, false);
      assert(entrant.color.startsWith("#"), "Assigned a hex color from palette");
      assert(ctx.events.some(e => e.type === "join"), "Emits join event");
    });

    it("updateEntrantFromTelemetry converts millisecond telemetry and calculates split completions", () => {
      const rp = window.LiveSplit.RaceProtocol;
      const ctx = createMockContext();

      // Initial registration
      rp.updateEntrantFromTelemetry({
        user: "RacerX",
        status: "ready"
      }, ctx);

      const entrant = ctx.entrants.get("RacerX");
      assertEqual(entrant.currentSplitIndex, 0);

      // Advances to Split 2 (index 1) with 35,000ms elapsed time and gold flag
      rp.updateEntrantFromTelemetry({
        user: "RacerX",
        currentTime: 35000,
        currentSplitIndex: 1,
        currentSplitName: "Stage 2",
        isGold: true
      }, ctx);

      assertEqual(entrant.currentSplitIndex, 1);
      assertEqual(entrant.currentTimeSec, 35.0, "Converts 35000ms to 35.0s");
      assertEqual(entrant.lastSplitEffect.type, "gold", "Identifies gold split effect");
      assertEqual(entrant.splitTimes[0], 35.0, "Records checkpoint time for split 1");
    });

    it("updateEntrantFromTelemetry resolves finished and DNF states cleanly", () => {
      const rp = window.LiveSplit.RaceProtocol;
      const ctx = createMockContext();

      // Finish state
      rp.updateEntrantFromTelemetry({
        user: "Finisher",
        status: "finished",
        finalTime: 72500
      }, ctx);

      const finRunner = ctx.entrants.get("Finisher");
      assertEqual(finRunner.isFinished, true);
      assertEqual(finRunner.finalTimeSec, 72.5);
      assertEqual(finRunner.currentSplitName, "Finished");

      // DNF state
      rp.updateEntrantFromTelemetry({
        user: "Quitter",
        status: "forfeited",
        currentTime: 42000
      }, ctx);

      const dnfRunner = ctx.entrants.get("Quitter");
      assertEqual(dnfRunner.isDNF, true);
      assertEqual(dnfRunner.isFinished, false);
      assertEqual(dnfRunner.currentSplitName, "DNF");
    });

    it("parseRaceMessage prunes participants who left the room on authoritative snapshot", () => {
      const rp = window.LiveSplit.RaceProtocol;
      const ctx = createMockContext();

      // Add two competitors
      rp.updateEntrantFromTelemetry({ user: "Alice" }, ctx);
      rp.updateEntrantFromTelemetry({ user: "Bob" }, ctx);
      assertEqual(ctx.entrants.size, 2);

      // Authoritative snapshot contains only Alice: Bob has left the room
      rp.parseRaceMessage({
        participants: [{ user: "Alice", status: "ready" }]
      }, ctx);

      assert(ctx.entrants.has("Alice"), "Alice remains in room");
      assert(!ctx.entrants.has("Bob"), "Bob was pruned from entrants Map");
    });
  });
})();
